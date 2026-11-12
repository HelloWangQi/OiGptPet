import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { disposeVrmScene } from './dispose';
import { inspectMotionCapabilities } from '../character-core/motion-capabilities';
import { applyBlink } from '../character-core/blink';
import { adaptFaceArms } from './arm-reach';
import { sampleMotion, sampleLook } from '../character-core';
import { inspectVrmFile, type ModelInfo } from '../character-core/vrm-file';
import type { AnimationState } from '../target-chatgpt/contract';
import type { MusicDanceSignal } from '../character-core/music-dance';
import { sampleMusicDancePose, type MusicDanceStyle } from '../character-core/music-choreography';
import { actionTimeToPoseTime, poseTimeToActionTime, type VrmMotionLoopMode } from './motion-time';

export type { VrmMotionLoopMode } from './motion-time';

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

const MUSIC_DANCE_BONES: VRMHumanBoneName[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
];

export class VrmStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  readonly root = new THREE.Group();
  private vrm?: VRM;
  private lookAtProxy?: VRMLookAtQuaternionProxy;
  private generation = 0;
  private motionGeneration = 0;
  private motionMixer?: THREE.AnimationMixer;
  private motionActions: THREE.AnimationAction[] = [];
  private activeMotion?: number;
  private motionPlaybackRate = 1;
  private motionLoopMode: VrmMotionLoopMode = 'repeat';
  private disposed = false;
  private lookTarget = new THREE.Object3D();
  private readonly hitRaycaster = new THREE.Raycaster();
  private readonly hitNdc = new THREE.Vector2();
  private lastState?: AnimationState;
  private lastStateRevision?: number;
  private speechMouthTarget = 0;
  private speechMouthCurrent = 0;
  private musicDanceSignal?: MusicDanceSignal;
  private musicDanceStyle: MusicDanceStyle = 'groove';
  private musicDancePoseActive = false;
  private musicDancePreviousLookAtAutoUpdate?: boolean;
  private musicDanceRestPose = new Map<VRMHumanBoneName, THREE.Quaternion>();
  private petGroundShadow?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly petBounds = new THREE.Vector3(0.95, 1.85, 0.2);
  private petCenterY = 0.925;
  private musicDanceEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  private musicDanceTarget = new THREE.Quaternion();
  private musicDanceScratch = new THREE.Quaternion();
  private musicDanceMotionMode = false;
  private musicDanceMotionPlaying = false;
  private poseTransition?: {
    elapsed: number;
    bones: Array<{ node: THREE.Object3D; from: THREE.Quaternion; to: THREE.Quaternion }>;
    rootPosition: THREE.Vector3;
    rootQuaternion: THREE.Quaternion;
    lookPosition: THREE.Vector3;
    expressions: Array<{ name: string; from: number }>;
  };

  constructor(readonly canvas: HTMLCanvasElement, preserveDrawingBuffer = false, private readonly petPresentation = false) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer });
    this.renderer.setClearColor(0, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (petPresentation) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
    }
    this.camera = petPresentation
      ? new THREE.PerspectiveCamera(28, 1, 0.05, 100)
      : new THREE.OrthographicCamera(-1.4, 1.4, 2.45, -0.25, 0.1, 30);
    this.camera.position.set(0, petPresentation ? 1.4 : 1.1, petPresentation ? 4.6 : 5);
    this.camera.lookAt(0, petPresentation ? 1 : 1.1, 0);
    if (this.camera instanceof THREE.OrthographicCamera) {
      // Orthographic bounds are relative to the camera center.
      this.camera.top = 1.35;
      this.camera.bottom = -1.35;
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc6c4d6, 2.2));
    const key = new THREE.DirectionalLight(0xfff5ec, 2.2);
    key.position.set(-2, 4, 5);
    this.scene.add(key, this.root, this.lookTarget);
    if (petPresentation) {
      const fill = new THREE.DirectionalLight(0xbcd8ff, 0.62);
      fill.position.set(2, 2.4, -2.2);
      const rim = new THREE.DirectionalLight(0xd6b7ff, 0.34);
      rim.position.set(0, 2.8, -3.2);
      this.scene.add(fill, rim);
      this.createPetGroundShadow();
    }
  }

  private createPetGroundShadow() {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 256; textureCanvas.height = 256;
    const context = textureCanvas.getContext('2d');
    if (!context) return;
    const gradient = context.createRadialGradient(128, 128, 3, 128, 128, 124);
    gradient.addColorStop(0, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.13)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      color: 0x1c1236, map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.82,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.42), material);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.006, 0.04);
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    this.petGroundShadow = shadow;
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
    VRMUtils.rotateVRM0(candidate);
    this.root.add(candidate.scene);
    this.root.scale.setScalar(1);
    this.root.position.set(0, 0, 0);
    this.captureMusicDanceRestPose();
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
    if (this.petPresentation) {
      const fitted = new THREE.Box3().setFromObject(candidate.scene);
      fitted.getSize(this.petBounds);
      this.petCenterY = fitted.getCenter(new THREE.Vector3()).y;
      if (this.petGroundShadow) {
        const width = Math.max(this.petBounds.x * 1.9, this.petBounds.y * 0.55);
        this.petGroundShadow.scale.set(width, 1, 1);
      }
    }
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
    if (this.camera instanceof THREE.PerspectiveCamera) {
      // Projection must match the canvas: inflating aspect squeezes the avatar
      // horizontally. Camera distance supplies the required action room.
      const fitAspect = aspect;
      this.camera.aspect = fitAspect;
      if (this.petPresentation) {
        const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
        const tanX = tanY * fitAspect;
        const heightDistance = this.petBounds.y * 1.04 / (2 * tanY * 0.9);
        const widthDistance = this.petBounds.x * 1.25 / (2 * tanX * 0.83);
        const distance = Math.max(heightDistance, widthDistance, 3.4);
        this.camera.position.set(0, this.petCenterY + 0.3, distance);
        this.camera.lookAt(0, this.petCenterY, 0);
      }
      this.camera.updateProjectionMatrix();
    } else {
      const halfWidth = 1.35 * aspect;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
      this.camera.top = 1.35;
      this.camera.bottom = -1.35;
      this.camera.updateProjectionMatrix();
    }
  }

  setSpeechMouthOpen(amount: number) {
    this.speechMouthTarget = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  }

  setMusicDanceSignal(signal: MusicDanceSignal | undefined) {
    this.musicDanceSignal = signal;
  }

  setMusicDanceStyle(style: MusicDanceStyle) {
    this.musicDanceStyle = style;
  }

  setMusicDanceMotionMode(enabled: boolean) {
    this.musicDanceMotionMode = enabled;
  }

  setMusicDanceMotionPlaying(playing: boolean) {
    this.musicDanceMotionPlaying = playing;
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
    action.timeScale = this.motionPlaybackRate;
    action.clampWhenFinished = this.motionLoopMode === 'once';
    action.setLoop(this.motionLoopMode === 'once' ? THREE.LoopOnce : this.motionLoopMode === 'pingpong' ? THREE.LoopPingPong : THREE.LoopRepeat, this.motionLoopMode === 'once' ? 1 : Infinity);
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
    if (this.motionLoopMode === 'once' && action.paused && action.time >= action.getClip().duration) {
      this.playMotion(this.activeMotion);
      return true;
    }
    action.paused = !action.paused;
    return !action.paused;
  }

  motionIsPlaying(): boolean {
    return this.activeMotion === undefined ? false : this.motionActions[this.activeMotion]?.isRunning() ?? false;
  }

  setMotionPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 2) throw new RangeError('动作速度必须在 0.25 到 2 倍之间。');
    this.motionPlaybackRate = rate;
    for (const action of this.motionActions) action.timeScale = rate;
  }

  setMotionLoopMode(mode: VrmMotionLoopMode): void {
    if (mode !== 'repeat' && mode !== 'once' && mode !== 'pingpong') throw new RangeError('请选择有效的动作循环模式。');
    const action = this.activeMotion === undefined ? undefined : this.motionActions[this.activeMotion];
    const loopCount = action ? this.getMotionLoopCount(action) : -1;
    const duration = action?.getClip().duration ?? 0;
    const poseTime = action ? actionTimeToPoseTime(action.time, duration, this.motionLoopMode, loopCount) : 0;
    this.motionLoopMode = mode;
    if (!action) return;
    action.clampWhenFinished = mode === 'once';
    action.setLoop(mode === 'once' ? THREE.LoopOnce : mode === 'pingpong' ? THREE.LoopPingPong : THREE.LoopRepeat, mode === 'once' ? 1 : Infinity);
    action.time = poseTimeToActionTime(poseTime, duration, mode, loopCount);
    this.motionMixer?.update(0);
  }

  seekMotion(index: number, seconds: number): void {
    const action = this.motionActions[index];
    const mixer = this.motionMixer;
    if (!action || !mixer) throw new RangeError('请选择已加载的 VRM Animation 动作。');
    const duration = action.getClip().duration;
    if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) throw new RangeError('动作预览时间无效。');
    action.paused = true;
    const poseTime = THREE.MathUtils.clamp(seconds, 0, Math.max(0, duration - 1e-5));
    action.time = poseTimeToActionTime(poseTime, duration, this.motionLoopMode, this.getMotionLoopCount(action));
    this.activeMotion = index;
    mixer.update(0);
  }

  motionTime(index: number): number | undefined {
    const action = this.motionActions[index];
    return action ? actionTimeToPoseTime(action.time, action.getClip().duration, this.motionLoopMode, this.getMotionLoopCount(action)) : undefined;
  }

  private getMotionLoopCount(action: THREE.AnimationAction): number {
    // Three.js keeps ping-pong direction in this internal counter; `action.time` is the raw leg time.
    return (action as THREE.AnimationAction & { _loopCount: number })._loopCount;
  }

  clearMotion(): void {
    ++this.motionGeneration;
    this.releaseMotion();
    this.musicDanceMotionMode = false;
    this.musicDanceMotionPlaying = false;
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

  private applyPose(state: AnimationState, phase: number, look?: { yaw: number; pitch: number }, mouthOpen = 0, preserveSkeleton = false) {
    if (!this.vrm) return;
    const vrm = this.vrm;
    if (!preserveSkeleton) vrm.humanoid.resetNormalizedPose();
    const p = sampleMotion(state, phase);
    const rotate = (name: Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0], x: number, y = 0, z = 0) => {
      const axis = vrm.meta.metaVersion === '0' ? -1 : 1;
      vrm.humanoid.getNormalizedBoneNode(name)?.rotation.set(x * axis, y, z * axis);
    };
    if (!preserveSkeleton) {
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
    }
    const expressions = vrm.expressionManager;
    this.resetExpressions();
    applyBlink(expressions ?? undefined, p.blink);
    expressions?.setValue('happy', p.happy);
    expressions?.setValue('sad', p.sad);
    expressions?.setValue('aa', mouthOpen);
    if (look) this.lookTarget.position.set(Math.sin(look.yaw) * 3, 1.65 - Math.sin(look.pitch) * 3, 4);
    else this.lookTarget.position.set(0, 1.65, 5);
  }

  private applyMusicDancePose(signal: MusicDanceSignal, phase: number, delta: number) {
    if (!this.vrm) return;
    const vrm = this.vrm;
    const strength = signal.level;
    const beatPosition = Number.isFinite(signal.phase)
      ? THREE.MathUtils.clamp(signal.phase!, 0, 1)
      : (phase * signal.bpm / 60) % 1;
    if (this.musicDanceStyle !== 'groove') {
      const pose = sampleMusicDancePose(this.musicDanceStyle, {
        ...signal,
        phase: beatPosition,
        beatIndex: signal.beatIndex ?? Math.floor(phase * signal.bpm / 60),
      });
      const energy = THREE.MathUtils.clamp(signal.level * 1.35, 0, 1);
      const torsoStrength = 0.85 + energy * 0.35;
      const armStrength = 1 + (torsoStrength - 1) * 0.25;
      const legStrength = 1 + (torsoStrength - 1) * 0.35;
      const smooth = 1 - Math.exp(-Math.min(Math.max(delta, 0), 1 / 15) * 21);
      const set = (name: VRMHumanBoneName, x = 0, y = 0, z = 0, strength = torsoStrength) => {
        const bone = vrm.humanoid.getNormalizedBoneNode(name);
        const rest = this.musicDanceRestPose.get(name);
        if (!bone || !rest) return;
        const axis = vrm.meta.metaVersion === '0' ? -1 : 1;
        this.musicDanceEuler.set(x * strength * axis, y * strength, z * strength * axis, 'XYZ');
        this.musicDanceTarget.setFromEuler(this.musicDanceEuler);
        this.musicDanceScratch.copy(rest).multiply(this.musicDanceTarget);
        bone.quaternion.slerp(this.musicDanceScratch, smooth);
      };
      set('hips', pose.hipPitch, pose.hipYaw, pose.hipRoll);
      set('spine', pose.bodyPitch, pose.bodyYaw, pose.bodyRoll);
      set('chest', pose.chestPitch, pose.chestYaw, pose.chestRoll);
      set('upperChest', pose.upperChestPitch, pose.upperChestYaw, pose.upperChestRoll);
      set('neck', pose.neckPitch, pose.neckYaw, pose.neckRoll);
      set('head', pose.headPitch, pose.headYaw, pose.headRoll);
      set('leftShoulder', 0, 0, pose.leftShoulderJoint, armStrength);
      set('rightShoulder', 0, 0, pose.rightShoulderJoint, armStrength);
      // Keep the reference axis convention: upper-arm Y folds forward, Z lifts;
      // elbows bend on Y, while wrist X/Y/Z each contribute to the hand flourish.
      set('leftUpperArm', 0, pose.leftArmAcross, pose.leftShoulder, armStrength);
      set('rightUpperArm', 0, pose.rightArmAcross, pose.rightShoulder, armStrength);
      set('leftLowerArm', 0, pose.leftElbow, 0, armStrength);
      set('rightLowerArm', 0, pose.rightElbow, 0, armStrength);
      set('leftHand', pose.leftWrist, pose.leftWristYaw, pose.leftWristRoll, armStrength);
      set('rightHand', pose.rightWrist, pose.rightWristYaw, pose.rightWristRoll, armStrength);
      set('leftUpperLeg', pose.leftStep, 0, pose.leftLegSide, legStrength);
      set('rightUpperLeg', pose.rightStep, 0, pose.rightLegSide, legStrength);
      set('leftLowerLeg', pose.leftKnee, 0, 0, legStrength);
      set('rightLowerLeg', pose.rightKnee, 0, 0, legStrength);
      set('leftFoot', pose.leftFootPitch, 0, pose.leftFootRoll, legStrength);
      set('rightFoot', pose.rightFootPitch, 0, pose.rightFootRoll, legStrength);
      const happy = vrm.expressionManager?.getExpression('happy');
      if (happy) vrm.expressionManager?.setValue('happy', 0.35 + energy * 0.4);
      const sizeScale = 1.85 / 1.6;
      const hitPulse = -0.012 * Math.abs(Math.sin(beatPosition * Math.PI)) * (0.4 + energy);
      const x = pose.bodySway * sizeScale;
      const y = (pose.bounce + hitPulse) * sizeScale;
      this.root.position.set(
        THREE.MathUtils.lerp(this.root.position.x, x, smooth),
        THREE.MathUtils.lerp(this.root.position.y, y, smooth),
        0,
      );
      this.root.rotation.set(
        0,
        pose.rootYaw,
        pose.bodyTilt - pose.bodySway * 1.8,
      );
      if (this.petGroundShadow) {
        const hit = THREE.MathUtils.clamp(signal.hit ?? signal.beat, 0, 1);
        this.petGroundShadow.position.x = this.root.position.x;
        this.petGroundShadow.material.opacity = 0.82 - hit * 0.22;
      }
      return;
    }
    const beatPhase = beatPosition * Math.PI * 2;
    const sway = Math.sin(beatPhase);
    const opposite = Math.sin(beatPhase + Math.PI);
    const add = (name: VRMHumanBoneName, x = 0, y = 0, z = 0) => {
      const bone = vrm.humanoid.getNormalizedBoneNode(name);
      if (!bone) return;
      bone.rotation.x += x * strength;
      bone.rotation.y += y * strength;
      bone.rotation.z += z * strength;
    };
    add('spine', 0, sway * 0.12, sway * 0.08);
    add('chest', 0, sway * 0.16, -sway * 0.06);
    add('leftUpperArm', -0.16, 0, 0.4 + sway * 0.28);
    add('rightUpperArm', -0.16, 0, -0.4 + opposite * 0.28);
    add('leftLowerArm', -0.2 + opposite * 0.12, 0, 0.1);
    add('rightLowerArm', -0.2 + sway * 0.12, 0, -0.1);
    add('leftUpperLeg', sway * 0.2, 0, 0);
    add('rightUpperLeg', opposite * 0.2, 0, 0);
    add('head', -Math.abs(sway) * 0.05, -sway * 0.05, -sway * 0.04);
    this.root.position.y += signal.beat * 0.075 * strength;
    this.root.rotation.y += sway * 0.08 * strength;
  }

  private setMusicDanceLookAtPaused(paused: boolean) {
    const lookAt = this.vrm?.lookAt;
    if (!lookAt) return;
    if (paused && this.musicDancePreviousLookAtAutoUpdate === undefined) {
      this.musicDancePreviousLookAtAutoUpdate = lookAt.autoUpdate;
      lookAt.autoUpdate = false;
    } else if (!paused && this.musicDancePreviousLookAtAutoUpdate !== undefined) {
      lookAt.autoUpdate = this.musicDancePreviousLookAtAutoUpdate;
      this.musicDancePreviousLookAtAutoUpdate = undefined;
    }
  }

  render(state: AnimationState, phase: number, delta: number, look?: { yaw: number; pitch: number }, stateRevision?: number) {
    const externalMotion = this.motionMixer !== undefined && this.activeMotion !== undefined
      && (!this.musicDanceMotionMode || this.musicDanceMotionPlaying);
    // The application sends a zero step while paused. Reapplying normalized
    // poses/look-at at zero time can still change raw bones and spring state.
    // Keep the displayed pose, and defer action transitions until resuming.
    // Explicit sampling helpers omit stateRevision and retain zero-step seeks.
    if (delta <= 0 && stateRevision !== undefined && this.lastState !== undefined && !externalMotion) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const dancing = state === 'idle' ? this.musicDanceSignal : undefined;
    const authoredDance = !externalMotion && Boolean(dancing) && this.musicDanceStyle !== 'groove';
    const danceModeChanged = authoredDance !== this.musicDancePoseActive;
    const enteringAuthoredDance = authoredDance && !this.musicDancePoseActive;
    this.setMusicDanceLookAtPaused(authoredDance);
    const restarted = stateRevision !== undefined && this.lastStateRevision !== undefined && stateRevision !== this.lastStateRevision;
    if (this.lastState !== undefined && (this.lastState !== state || restarted || danceModeChanged) && this.vrm && !enteringAuthoredDance) {
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
    } else if (enteringAuthoredDance) {
      // The dance bones already slerp toward the authored pose at 21/s; a
      // second whole-body fade on entry makes the first beat look delayed.
      this.poseTransition = undefined;
    }
    this.lastState = state;
    this.lastStateRevision = stateRevision;
    this.musicDancePoseActive = authoredDance;
    const boundedDelta = Math.min(Math.max(delta, 0), 1 / 15);
    this.speechMouthCurrent = THREE.MathUtils.lerp(this.speechMouthCurrent, this.speechMouthTarget, 1 - Math.exp(-boundedDelta * 14));
    if (externalMotion) {
      this.vrm?.humanoid.resetNormalizedPose();
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
      this.resetExpressions();
      this.motionMixer?.update(boundedDelta);
    } else {
      const preserveSkeleton = Boolean(dancing && this.musicDanceStyle !== 'groove');
      this.applyPose(dancing ? 'idle' : state, phase, look, this.speechMouthCurrent, preserveSkeleton);
      if (dancing) this.applyMusicDancePose(dancing, phase, boundedDelta);
    }
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
    this.hitNdc.set((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1);
    this.hitRaycaster.setFromCamera(this.hitNdc, this.camera);
    return this.hitRaycaster.intersectObject(this.root, true).length > 0;
  }
  get loaded() { return Boolean(this.vrm); }
  private releaseModel() {
    ++this.motionGeneration;
    this.releaseMotion();
    this.setMusicDanceLookAtPaused(false);
    this.musicDancePoseActive = false;
    this.musicDanceRestPose.clear();
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

  private captureMusicDanceRestPose() {
    this.musicDanceRestPose.clear();
    this.musicDancePoseActive = false;
    this.vrm?.humanoid.resetNormalizedPose();
    for (const name of MUSIC_DANCE_BONES) {
      const node = this.vrm?.humanoid.getNormalizedBoneNode(name);
      if (node) this.musicDanceRestPose.set(name, node.quaternion.clone());
    }
  }
  private releaseMotion() {
    this.motionMixer?.stopAllAction();
    if (this.vrm && this.motionMixer) this.motionMixer.uncacheRoot(this.vrm.scene);
    this.motionMixer = undefined;
    this.motionActions = [];
    this.activeMotion = undefined;
    this.motionPlaybackRate = 1;
    this.motionLoopMode = 'repeat';
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.releaseModel();
    if (this.petGroundShadow) {
      this.scene.remove(this.petGroundShadow);
      this.petGroundShadow.geometry.dispose();
      this.petGroundShadow.material.map?.dispose();
      this.petGroundShadow.material.dispose();
      this.petGroundShadow = undefined;
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
