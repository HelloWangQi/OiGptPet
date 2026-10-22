import { VrmStage } from '../renderer-vrm';
import {
  ANIMATION_ROWS, ATLAS_COLUMNS, CELL_HEIGHT, CELL_WIDTH, MAX_ENCODED_BYTES,
  atlasDimensions, type AtlasProfile,
} from '../target-chatgpt/contract';

export interface ExportResult { blob: Blob; width: number; height: number; frames: number; profile: AtlasProfile }

/** Produce deterministic model-rendered frames; final platform validation remains separate. */
export async function exportAtlas(
  source: ArrayBuffer,
  profile: AtlasProfile,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const { width, height } = atlasDimensions(profile);
  const atlas = document.createElement('canvas');
  atlas.width = width; atlas.height = height;
  const context = atlas.getContext('2d');
  if (!context) throw new Error('无法创建图集画布。');
  const frame = document.createElement('canvas');
  const stage = new VrmStage(frame, true);
  const total = profile === 'v2' ? 73 : 57;
  let done = 0;
  try {
    await stage.load(source);
    stage.resize(CELL_WIDTH, CELL_HEIGHT, 1);
    // Physics is settled consistently for each pose rather than inheriting the previous row.
    for (const [row, definition] of ANIMATION_ROWS.entries()) {
      for (let col = 0; col < definition.frames; col++) {
        signal?.throwIfAborted();
        const phase = definition.state === 'jumping' ? col / (definition.frames - 1) : col / definition.frames;
        for (let i = 0; i < 12; i++) stage.render(definition.state, phase, 1 / 60);
        context.drawImage(frame, col * CELL_WIDTH, row * CELL_HEIGHT);
        progress(++done, total);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if (profile === 'v2') {
      for (let i = 0; i < 16; i++) {
        signal?.throwIfAborted();
        stage.renderLook(i * 22.5);
        context.drawImage(frame, (i % ATLAS_COLUMNS) * CELL_WIDTH, (9 + Math.floor(i / 8)) * CELL_HEIGHT);
        progress(++done, total);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    const blob = await new Promise<Blob>((resolve, reject) => atlas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('PNG 编码失败。')), 'image/png',
    ));
    if (blob.size > MAX_ENCODED_BYTES) throw new Error('图集超过 20 MiB，请先简化模型纹理。');
    return { blob, width, height, frames: total, profile };
  } finally { stage.dispose(); }
}
