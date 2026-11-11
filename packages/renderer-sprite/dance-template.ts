export const SPRITE_DANCE_TEMPLATE_MIN_FRAMES = 2;
export const SPRITE_DANCE_TEMPLATE_MAX_FRAMES = 21;
export const SPRITE_DANCE_TEMPLATE_CELL_WIDTH = 192;
export const SPRITE_DANCE_TEMPLATE_CELL_HEIGHT = 208;

/** Build an editable transparent SVG guide; template guides must be hidden before PNG export. */
export function createSpriteDanceTemplateSvg(frameCount: number): string {
  if (!Number.isInteger(frameCount)
    || frameCount < SPRITE_DANCE_TEMPLATE_MIN_FRAMES
    || frameCount > SPRITE_DANCE_TEMPLATE_MAX_FRAMES) {
    throw new RangeError(`舞蹈帧数必须是 ${SPRITE_DANCE_TEMPLATE_MIN_FRAMES} 到 ${SPRITE_DANCE_TEMPLATE_MAX_FRAMES} 之间的整数。`);
  }

  const width = frameCount * SPRITE_DANCE_TEMPLATE_CELL_WIDTH;
  const height = SPRITE_DANCE_TEMPLATE_CELL_HEIGHT;
  const cellGuides = Array.from({ length: frameCount }, (_, index) => {
    const x = index * SPRITE_DANCE_TEMPLATE_CELL_WIDTH;
    const number = String(index + 1).padStart(2, '0');
    return `<g transform="translate(${x} 0)"><rect x="1" y="1" width="190" height="206"/><path d="M96 18v170M32 104h128M24 190h144"/><text x="8" y="14" fill="#47764f" fill-opacity="0.8" stroke="none" font-family="monospace" font-size="10">${number}</text></g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- OiGptPet sprite dance guide. Draw inside drawing-layer; hide template-guides before exporting transparent PNG. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <metadata>Each frame is 192x208 pixels. Keep the character inside the frame. Hide or delete the template-guides group before exporting a transparent PNG.</metadata>
  <g id="drawing-layer"></g>
  <g id="template-guides" fill="none" stroke="#5b8f64" stroke-opacity="0.55" stroke-width="1" vector-effect="non-scaling-stroke">${cellGuides}</g>
</svg>`;
}
