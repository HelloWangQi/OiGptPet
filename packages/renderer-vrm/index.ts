import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { sampleMotion, sampleLook } from '../character-core';
import { inspectVrmFile, type ModelInfo } from '../character-core/vrm-file';
import type { AnimationState } from '../target-chatgpt/contract';

export class VrmStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1.4, 1.4, 2.45, -0.25, 0.1, 30);
  readonly root = new THREE.Group();
  private vrm?: VRM;
  private generation = 0;
  private disposed = false;
  private lookTarget = new THREE.Object3D();

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
    if (!candidate) { VRMUtils.deepDispose(gltf.scene); throw new Error('文件没有可用的 VRM 人形角色。'); }
    if (this.disposed || generation !== this.generation) {
      VRMUtils.deepDispose(candidate.scene);
      throw new Error('角色加载已取消。');
    }
    this.releaseModel();
    this.vrm = candidate;
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
    return info;
  }

  resize(width: number, height: number, pixelRatio?: number) {
    if (pixelRatio !== undefined) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    this.camera.left = -1.35 * aspect;
    this.camera.right = 1.35 * aspect;
    this.camera.updateProjectionMatrix();
  }

  private applyPose(state: AnimationState, phase: number, look?: { yaw: number; pitch: number }) {
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
    this.root.position.y = p.rootY;
    this.root.rotation.y = p.rootYaw;
    const expressions = vrm.expressionManager;
    for (const name of ['blink', 'happy', 'sad', 'relaxed']) expressions?.setValue(name, 0);
    expressions?.setValue('blink', p.blink);
    expressions?.setValue('happy', p.happy);
    expressions?.setValue('sad', p.sad);
    if (look) this.lookTarget.position.set(-Math.sin(look.yaw) * 3, 1.65 - Math.sin(look.pitch) * 3, 4);
    else this.lookTarget.position.set(0, 1.65, 5);
  }

  render(state: AnimationState, phase: number, delta: number, look?: { yaw: number; pitch: number }) {
    this.applyPose(state, phase, look);
    this.vrm?.update(Math.min(Math.max(delta, 0), 1 / 15));
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
    if (this.vrm) {
      this.root.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = undefined;
    }
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.releaseModel();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
