import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { disposeVrmScene } from './dispose';
import { inspectMotionCapabilities } from '../character-core/motion-capabilities';
import { applyBlink } from '../character-core/blink';
import { adaptFaceArms } from './arm-reach';
import { sampleMotion, sampleLook } from '../character-core';
import { inspectVrmFile, type ModelInfo } from '../character-core/vrm-file';
import type { AnimationState } from '../target-chatgpt/contract';

export interface VrmMotionClipCompatibility {
  totalBones: number;
  missingBones: string[];
  totalExpressions: number;
  missingExpressions: string[];
  lookAt: 'unused' | 'available' | 'missing';
}

export interface VrmMotionClipInfo {
  index: number;
  name: string;
  duration: number;
  compatibility: VrmMotionClipCompatibility;
}

export class VrmStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1.4, 1.4, 2.45, -0.25, 0.1, 30);
  readonly root = new THREE.Group();
  private vrm?: VRM;
  private lookAtProxy?: VRMLookAtQuaternionProxy;
  private generation = 0;
  private motionGeneration = 0;
  private motionMixer?: THREE.AnimationMixer;
  private motionActions: THREE.AnimationAction[] = [];
  private activeMotion?: number;
  private disposed = false;
  private lookTarget = new THREE.Object3D();
  private lastState?: AnimationState;
  private lastStateRevision?: number;
  private speechMouthTarget = 0;
  private speechMouthCurrent = 0;
  private poseTransition?: {
    elapsed: number;
    bones: Array<{ node: THREE.Object3D; from: THREE.Quaternion; to: THREE.Quaternion }>;
    rootPosition: THREE.Vector3;
    rootQuaternion: THREE.Quaternion;
    lookPosition: THREE.Vector3;
    expressions: Array<{ name: string; from: number }>;
  };

  constructor(readonly canvas: HTMLCanvasElement, preserveDrawingBuffer = false) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer });
    this.renderer.setClearColor(0, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 1.1, 5);
    this.camera.lookAt(0, 1.1, 0);
    // Orthographic bounds are relative to the camera center.
    this.camera.top = 1.35;
    this.camera.bottom = -1.35;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc6c4d6, 2.2));
    const key = new THREE.DirectionalLight(0xfff5ec, 2.2);
    key.position.set(-2, 4, 5);
    this.scene.add(key, this.root, this.lookTarget);
  }

  async load(buffer: ArrayBuffer): Promise<ModelInfo> {
    const info = inspectVrmFile(buffer);
    const generation = ++this.generation;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('已阻止模型的外部资源请求。');
      return url;
    });
    const loader = new GLTFLoader(manager);
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(buffer, '');
    const candidate = gltf.userData.vrm as VRM | undefined;
    if (!candidate) { disposeVrmScene(gltf.scene); throw new Error('文件没有可用的 VRM 人形角色。'); }
    if (this.disposed || generation !== this.generation) {
      disposeVrmScene(candidate.scene);
      throw new Error('角色加载已取消。');
    }
    this.releaseModel();
    this.vrm = candidate;
    if (candidate.lookAt) {
      this.lookAtProxy = new VRMLookAtQuaternionProxy(candidate.lookAt);
      this.lookAtProxy.name = 'lookAtQuaternionProxy';
      candidate.scene.add(this.lookAtProxy);
    }
    this.lastState = undefined;
    this.lastStateRevision = undefined;
    this.poseTransition = undefined;
    candidate.scene.position.set(0, 0, 0);
    candidate.scene.rotation.set(0, 0, 0);
    this.root.add(candidate.scene);
    this.root.scale.setScalar(1);
    this.root.position.set(0, 0, 0);
    candidate.lookAt && (candidate.lookAt.target = this.lookTarget);
    this.lookTarget.position.set(0, 1.65, 5);
    this.applyPose('idle', 0);
    candidate.update(0);
    const bounds = new THREE.Box3().setFromObject(candidate.scene);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.1) {
      this.releaseModel(); throw new Error('模型尺寸异常。');
    }
    const scale = 1.85 / size.y;
    candidate.scene.scale.setScalar(scale);
    candidate.scene.position.set(-(bounds.min.x + bounds.max.x) / 2 * scale, -bounds.min.y * scale, 0);
    candidate.scene.updateMatrixWorld(true);
    this.applyPose('idle', 0);
    candidate.update(0);
    // The loader initialized springs before our final scale and neutral pose.
    // Re-capture the rest state in world space so the first atlas frame starts settled.
    candidate.springBoneManager?.reset();
    candidate.springBoneManager?.setInitState();
    return { ...info, motionCapabilities: inspectMotionCapabilities({
      hasBone: name => Boolean(candidate.humanoid.getNormalizedBoneNode(name)),
      hasExpression: name => Boolean(candidate.expressionManager?.getExpression(name)),
      lookAtController: Boolean(candidate.lookAt),
    }) };
  }

  resize(width: number, height: number, pixelRatio?: number) {
    if (pixelRatio !== undefined) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    this.camera.left = -1.35 * aspect;
    this.camera.right = 1.35 * aspect;
    this.camera.updateProjectionMatrix();
  }

  setSpeechMouthOpen(amount: number) {
    this.speechMouthTarget = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  }

  async loadMotion(buffer: ArrayBuffer): Promise<VrmMotionClipInfo[]> {
    const vrm = this.vrm;
    if (!vrm) throw new Error('请先加载 VRM 角色。');
    const generation = this.generation;
    const motionGeneration = ++this.motionGeneration;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('已阻止动作文件的外部资源请求。');
      return url;
    });
    const loader = new GLTFLoader(manager);
    loader.register(parser => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.parseAsync(buffer, '');
    try {
      const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
      if (!animations?.length) throw new Error('文件中没有受支持的 VRM Animation 动作。');
      const clips = animations.map((animation, index) => {
        const clip = createVRMAnimationClip(animation, vrm);
        clip.name = gltf.animations[index]?.name?.trim().slice(0, 120) || `动作 ${index + 1}`;
        const bones = new Set<VRMHumanBoneName>(animation.humanoidTracks.rotation.keys());
        if (animation.humanoidTracks.translation.has('hips')) bones.add('hips');
        const expressions = new Set<string>([
          ...animation.expressionTracks.preset.keys(),
          ...animation.expressionTracks.custom.keys(),
        ]);
        const compatibility: VrmMotionClipCompatibility = {
          totalBones: bones.size,
          missingBones: [...bones].filter(name => !vrm.humanoid.getNormalizedBoneNode(name)),
          totalExpressions: expressions.size,
          missingExpressions: [...expressions].filter(name => !vrm.expressionManager?.getExpression(name)),
          lookAt: !animation.lookAtTrack ? 'unused' : vrm.lookAt ? 'available' : 'missing',
        };
        return { clip, compatibility };
      });
      if (clips.some(({ clip }) => !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.tracks.length === 0)) throw new Error('动作时长无效或没有可播放的骨骼、表情或视线轨道。');
      if (this.disposed || this.vrm !== vrm || this.generation !== generation || this.motionGeneration !== motionGeneration) {
        throw new DOMException('动作加载已取消。', 'AbortError');
      }
      const mixer = new THREE.AnimationMixer(vrm.scene);
      const actions = clips.map(({ clip }) => mixer.clipAction(clip));
      this.releaseMotion();
      this.motionMixer = mixer;
      this.motionActions = actions;
      this.playMotion(0);
      return clips.map(({ clip, compatibility }, index) => ({
        index, name: clip.name.trim() || `动作 ${index + 1}`, duration: clip.duration, compatibility,
      }));
    } finally {
      disposeVrmScene(gltf.scene);
    }
  }

  playMotion(index: number): void {
    const action = this.motionActions[index];
    if (!action) throw new RangeError('请选择有效的 VRM Animation 动作。');
    this.motionMixer?.stopAllAction();
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    this.activeMotion = index;
    this.poseTransition = undefined;
    this.lastState = undefined;
    this.lastStateRevision = undefined;
  }

  toggleMotion(): boolean {
    if (this.activeMotion === undefined) return false;
    const action = this.motionActions[this.activeMotion];
    if (!action) return false;
    action.paused = !action.paused;
    return !action.paused;
  }

  clearMotion(): void {
    ++this.motionGeneration;
    this.releaseMotion();
    this.poseTransition = undefined;
    this.lastState = undefined;
    this.lastStateRevision = undefined;
  }

  renderMotionSettled(index: number, seconds: number, steps = 30): void {
    const vrm = this.vrm;
    const mixer = this.motionMixer;
    const action = this.motionActions[index];
    if (!vrm || !mixer || !action) throw new RangeError('请选择已加载的 VRM Animation 动作。');
    const duration = action.getClip().duration;
    if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) throw new RangeError('动作采样时间无效。');
    const time = ((seconds % duration) + duration) % duration;
    mixer.stopAllAction();
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.time = time;
    action.play();
    vrm.humanoid.resetNormalizedPose();
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.lookTarget.position.set(0, 1.65, 5);
    this.resetExpressions();
    mixer.update(0);
    action.paused = true;
    vrm.update(0);
    const springs = vrm.springBoneManager;
    springs?.reset();
    springs?.setInitState();
    for (let step = 0; step < Math.max(0, Math.floor(steps)); step++) springs?.update(1 / 60);
    this.renderer.render(this.scene, this.camera);
  }

  private resetExpressions() {
    const expressions = this.vrm?.expressionManager;
    for (const name of Object.keys(expressions?.expressionMap ?? {})) expressions?.setValue(name, 0);
  }

  private applyPose(state: AnimationState, phase: number, look?: { yaw: number; pitch: number }, mouthOpen = 0) {
    if (!this.vrm) return;
    const vrm = this.vrm;
    vrm.humanoid.resetNormalizedPose();
    const p = sampleMotion(state, phase);
    const rotate = (name: Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0], x: number, y = 0, z = 0) => {
      vrm.humanoid.getNormalizedBoneNode(name)?.rotation.set(x, y, z);
    };
    rotate('leftUpperArm', ...p.leftArm);
    rotate('rightUpperArm', ...p.rightArm);
    rotate('leftLowerArm', ...p.leftForearm);
    rotate('rightLowerArm', ...p.rightForearm);
    rotate('leftUpperLeg', p.leftLeg);
    rotate('rightUpperLeg', p.rightLeg);
    if (p.spine) rotate('spine', ...p.spine);
    if (p.chest) rotate('chest', ...p.chest);
    if (p.neck) rotate('neck', ...p.neck);
    rotate('head', look?.pitch ?? p.headPitch, look?.yaw ?? p.headYaw, p.headRoll);
    this.root.position.set(0, p.rootY, 0);
    this.root.rotation.set(0, p.rootYaw, 0);
    adaptFaceArms(name => vrm.humanoid.getNormalizedBoneNode(name), state);
    const expressions = vrm.expressionManager;
    this.resetExpressions();
    applyBlink(expressions ?? undefined, p.blink);
    expressions?.setValue('happy', p.happy);
    expressions?.setValue('sad', p.sad);
    expressions?.setValue('aa', mouthOpen);
    if (look) this.lookTarget.position.set(Math.sin(look.yaw) * 3, 1.65 - Math.sin(look.pitch) * 3, 4);
    else this.lookTarget.position.set(0, 1.65, 5);
  }

  render(state: AnimationState, phase: number, delta: number, look?: { yaw: number; pitch: number }, stateRevision?: number) {
    const restarted = stateRevision !== undefined && this.lastStateRevision !== undefined && stateRevision !== this.lastStateRevision;
    if (this.lastState !== undefined && (this.lastState !== state || restarted) && this.vrm) {
      const nodes = new Set(Object.values(this.vrm.humanoid.normalizedHumanBones).map(bone => bone.node));
      const bones = [...nodes].map(node => ({ node, from: node.quaternion.clone(), to: new THREE.Quaternion() }));
      const expressions = ['blink', 'blinkLeft', 'blinkRight', 'happy', 'sad', 'relaxed']
        .map(name => ({ name, from: this.vrm!.expressionManager?.getValue(name) }))
        .filter((entry): entry is { name: string; from: number } => entry.from !== null && entry.from !== undefined);
      this.poseTransition = {
        elapsed: 0,
        bones,
        rootPosition: this.root.position.clone(),
        rootQuaternion: this.root.quaternion.clone(),
        lookPosition: this.lookTarget.position.clone(),
        expressions,
      };
    }
    this.lastState = state;
    this.lastStateRevision = stateRevision;
    const boundedDelta = Math.min(Math.max(delta, 0), 1 / 15);
    this.speechMouthCurrent = THREE.MathUtils.lerp(this.speechMouthCurrent, this.speechMouthTarget, 1 - Math.exp(-boundedDelta * 14));
    const externalMotion = this.motionMixer !== undefined && this.activeMotion !== undefined;
    if (externalMotion) {
      this.vrm?.humanoid.resetNormalizedPose();
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
      this.resetExpressions();
      this.motionMixer?.update(boundedDelta);
    } else this.applyPose(state, phase, look, this.speechMouthCurrent);
    if (this.poseTransition && !externalMotion) {
      const transition = this.poseTransition;
      transition.elapsed += Math.min(Math.max(delta, 0), 1 / 15);
      const progress = Math.min(1, transition.elapsed / 0.2);
      const eased = progress * progress * (3 - 2 * progress);
      for (const bone of transition.bones) {
        bone.to.copy(bone.node.quaternion);
        bone.node.quaternion.slerpQuaternions(bone.from, bone.to, eased);
      }
      this.root.position.lerpVectors(transition.rootPosition, this.root.position, eased);
      this.root.quaternion.slerpQuaternions(transition.rootQuaternion, this.root.quaternion, eased);
      this.lookTarget.position.lerpVectors(transition.lookPosition, this.lookTarget.position, eased);
      const expressions = this.vrm?.expressionManager;
      for (const expression of transition.expressions) {
        const target = expressions?.getValue(expression.name);
        if (target !== null && target !== undefined) {
          expressions?.setValue(expression.name, THREE.MathUtils.lerp(expression.from, target, eased));
        }
      }
      if (progress >= 1) this.poseTransition = undefined;
    }
    this.vrm?.update(boundedDelta);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Export-only helper: reset the springs to the model rest state, advance a
   * fixed number of 60 Hz steps, then draw once. The result is independent of
   * the previously sampled row/frame, so row transitions and the first frame
   * cannot inherit an uninitialized hair state.
   */
  renderSettled(
    state: AnimationState,
    phase: number,
    look?: { yaw: number; pitch: number },
    steps = 30,
  ) {
    if (!this.vrm) return;
    this.speechMouthCurrent = 0;
    this.applyPose(state, phase, look);
    this.vrm.update(0);
    const springs = this.vrm.springBoneManager;
    springs?.reset();
    // The pose and constraints are constant during warm-up, so advancing only
    // the springs is equivalent to a full VRM update and avoids redundant work.
    const count = Math.max(0, Math.floor(steps));
    for (let step = 0; step < count; step += 1) springs?.update(1 / 60);
    this.renderer.render(this.scene, this.camera);
  }

  renderLook(angle: number) { this.render('idle', 0, 0, sampleLook(angle)); }
  hitTest(x: number, y: number) {
    const bounds = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1), this.camera);
    return ray.intersectObject(this.root, true).length > 0;
  }
  get loaded() { return Boolean(this.vrm); }
  private releaseModel() {
    ++this.motionGeneration;
    this.releaseMotion();
    if (this.vrm) {
      this.lastState = undefined;
      this.lastStateRevision = undefined;
      this.poseTransition = undefined;
      if (this.lookAtProxy) this.vrm.scene.remove(this.lookAtProxy);
      this.lookAtProxy = undefined;
      this.root.remove(this.vrm.scene);
      disposeVrmScene(this.vrm.scene);
      this.vrm = undefined;
    }
  }
  private releaseMotion() {
    this.motionMixer?.stopAllAction();
    if (this.vrm && this.motionMixer) this.motionMixer.uncacheRoot(this.vrm.scene);
    this.motionMixer = undefined;
    this.motionActions = [];
    this.activeMotion = undefined;
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.releaseModel();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
