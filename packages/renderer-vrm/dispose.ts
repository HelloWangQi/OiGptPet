import type { Material, Object3D, ShaderMaterial, Texture } from 'three';
import { VRMUtils } from '@pixiv/three-vrm';

// Each GLTFLoader parse in VrmStage owns its decoded images (global THREE.Cache
// is disabled). Texture.dispose() does not release ImageBitmap CPU resources.
// This must only be used when the whole model is no longer rendered.
export function disposeVrmScene(scene: Object3D) {
  const images = new Set<ImageBitmap>();
  const collectImage = (image: unknown) => {
    if (Array.isArray(image)) image.forEach(collectImage);
    else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) images.add(image);
  };
  const collectTexture = (value: unknown) => {
    if (value && typeof value === 'object' && (value as Texture).isTexture) collectImage((value as Texture).source.data);
  };
  const collectMaterial = (material: Material) => {
    Object.values(material).forEach(collectTexture);
    if ((material as ShaderMaterial).isShaderMaterial) Object.values((material as ShaderMaterial).uniforms).forEach(uniform => collectTexture(uniform.value));
  };
  scene.traverse(object => {
    const material = (object as Object3D & { material?: Material | Material[] }).material;
    if (Array.isArray(material)) material.forEach(collectMaterial);
    else if (material) collectMaterial(material);
  });
  try { VRMUtils.deepDispose(scene); }
  finally { for (const image of images) image.close(); }
}
