import { VrmStage } from '../renderer-vrm';
import { sampleLook } from '../character-core';
import {
  ANIMATION_ROWS, ATLAS_COLUMNS, CELL_HEIGHT, CELL_WIDTH, MAX_ENCODED_BYTES,
  atlasDimensions, type AnimationState, type AtlasProfile,
} from '../target-chatgpt/contract';

export interface ExportResult { blob: Blob; width: number; height: number; frames: number; profile: AtlasProfile }
export interface ExternalMotionExport { buffer: ArrayBuffer; clipIndex: number; state: AnimationState }

// Each frame restarts from the captured rest state, so a fixed 60 Hz warm-up
// removes the dependence on the previously sampled row without unbounded waiting.
const PHYSICS_STEPS = 30;

/** Produce deterministic model-rendered frames; final platform validation remains separate. */
export async function exportAtlas(
  source: ArrayBuffer,
  profile: AtlasProfile,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
  externalMotion?: ExternalMotionExport | readonly ExternalMotionExport[],
): Promise<ExportResult> {
  signal?.throwIfAborted();
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
    const externalMotions: readonly ExternalMotionExport[] = externalMotion === undefined ? []
      : 'clipIndex' in externalMotion ? [externalMotion] : externalMotion;
    const externalByState = new Map<AnimationState, { clipIndex: number; duration: number }>();
    if (externalMotions.length) {
      const motionBuffer = externalMotions[0].buffer;
      if (externalMotions.some(motion => motion.buffer !== motionBuffer)) throw new Error('同一图集导出的多个动作行必须来自同一份 VRMA。');
      for (const motion of externalMotions) {
        if (!ANIMATION_ROWS.some(row => row.state === motion.state) || externalByState.has(motion.state)) {
          throw new Error('VRMA 替换行无效或重复，请检查动作行清单。');
        }
      }
      const clips = await stage.loadMotion(motionBuffer);
      for (const motion of externalMotions) {
        const clip = clips.find(item => item.index === motion.clipIndex);
        if (!clip) throw new Error('所选 VRMA 动作片段不存在，已取消图集导出。');
        externalByState.set(motion.state, { clipIndex: motion.clipIndex, duration: clip.duration });
      }
    }
    // Physics is settled consistently for each pose rather than inheriting the previous row.
    for (const [row, definition] of ANIMATION_ROWS.entries()) {
      for (let col = 0; col < definition.frames; col++) {
        signal?.throwIfAborted();
        const phase = definition.state === 'jumping' ? col / (definition.frames - 1) : col / definition.frames;
        const replacement = externalByState.get(definition.state);
        if (replacement) {
          stage.renderMotionSettled(replacement.clipIndex, replacement.duration * col / definition.frames, PHYSICS_STEPS);
        } else stage.renderSettled(definition.state, phase, undefined, PHYSICS_STEPS);
        context.drawImage(frame, col * CELL_WIDTH, row * CELL_HEIGHT);
        progress(++done, total);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if (profile === 'v2') {
      for (let i = 0; i < 16; i++) {
        signal?.throwIfAborted();
        stage.renderSettled('idle', 0, sampleLook(i * 22.5), PHYSICS_STEPS);
        context.drawImage(frame, (i % ATLAS_COLUMNS) * CELL_WIDTH, (9 + Math.floor(i / 8)) * CELL_HEIGHT);
        progress(++done, total);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    signal?.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => atlas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('PNG 编码失败。')), 'image/png',
    ));
    signal?.throwIfAborted();
    if (blob.size > MAX_ENCODED_BYTES) throw new Error('图集超过 20 MiB，请先简化模型纹理。');
    return { blob, width, height, frames: total, profile };
  } finally { stage.dispose(); }
}
