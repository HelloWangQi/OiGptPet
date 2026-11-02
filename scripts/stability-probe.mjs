// Serialized by Playwright before the page loads. No application APIs are added.
export function installStabilityProbe() {
  const probe = { contexts: 0, lost: 0, bitmaps: 0, closed: 0, glDraws: 0, spriteDraws: 0 };
  window.__stabilityProbe = probe;
  const seen = new WeakSet();
  const context = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const result = context.apply(this, args);
    if (!result || seen.has(result)) return result;
    seen.add(result);
    if (args[0] === 'webgl2' || args[0] === 'webgl') {
      probe.contexts++;
      const get = result.getExtension.bind(result); const extensions = new WeakSet();
      result.getExtension = name => {
        const extension = get(name);
        if (name === 'WEBGL_lose_context' && extension && !extensions.has(extension)) {
          extensions.add(extension); const lose = extension.loseContext.bind(extension); let lost = false;
          extension.loseContext = () => { if (!lost) { lost = true; probe.lost++; } return lose(); };
        }
        return extension;
      };
      for (const method of ['drawArrays', 'drawElements']) {
        const original = result[method].bind(result);
        result[method] = (...values) => { probe.glDraws++; return original(...values); };
      }
    } else if (args[0] === '2d') {
      const draw = result.drawImage.bind(result);
      result.drawImage = (...values) => { probe.spriteDraws++; return draw(...values); };
    }
    return result;
  };
  const bitmap = window.createImageBitmap;
  window.createImageBitmap = async (...args) => {
    const result = await bitmap(...args);
    if (result.width === 1536 && [1872, 2288].includes(result.height)) {
      probe.bitmaps++; const close = result.close.bind(result); let closed = false;
      result.close = () => { if (!closed) { closed = true; probe.closed++; } close(); };
    }
    return result;
  };
}
