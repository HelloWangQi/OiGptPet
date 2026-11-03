import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, ShaderMaterial, Texture } from 'three';
import { disposeVrmScene } from '../packages/renderer-vrm/dispose';

class Bitmap { close = vi.fn(); }
afterEach(() => vi.unstubAllGlobals());

describe('whole-model texture image ownership', () => {
  it('closes a shared bitmap once after GPU texture disposal, without touching another model', () => {
    vi.stubGlobal('ImageBitmap', Bitmap);
    const image = new Bitmap(); const other = new Bitmap();
    const texture = new Texture(image); const otherTexture = new Texture(other);
    const scene = new Group(); const next = new Group();
    scene.add(new Mesh(new BoxGeometry(), [new MeshBasicMaterial({ map: texture }), new MeshBasicMaterial({ alphaMap: texture })]));
    next.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: otherTexture })));
    let closedAtDispose = -1; texture.addEventListener('dispose', () => { closedAtDispose = image.close.mock.calls.length; });
    disposeVrmScene(scene);
    expect(closedAtDispose).toBe(0); expect(image.close).toHaveBeenCalledTimes(1); expect(other.close).not.toHaveBeenCalled();
    disposeVrmScene(next); expect(other.close).toHaveBeenCalledTimes(1);
  });
  it('releases shader uniform image sources and texture image arrays', () => {
    vi.stubGlobal('ImageBitmap', Bitmap);
    const images = [new Bitmap(), new Bitmap()];
    const scene = new Group(); scene.add(new Mesh(new BoxGeometry(), new ShaderMaterial({ uniforms: { source: { value: new Texture(images) } } })));
    disposeVrmScene(scene); for (const image of images) expect(image.close).toHaveBeenCalledTimes(1);
  });
  it('does not close unrelated canvas/video-like sources by duck typing', () => {
    vi.stubGlobal('ImageBitmap', Bitmap);
    const image = { close: vi.fn() }; const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: new Texture(image) })));
    disposeVrmScene(scene); expect(image.close).not.toHaveBeenCalled();
  });
  it('still releases decoded images if a GPU dispose listener throws', () => {
    vi.stubGlobal('ImageBitmap', Bitmap);
    const image = new Bitmap(); const texture = new Texture(image); const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: texture })));
    texture.addEventListener('dispose', () => { throw new Error('dispose failed'); });
    expect(() => disposeVrmScene(scene)).toThrow('dispose failed'); expect(image.close).toHaveBeenCalledTimes(1);
  });
});
