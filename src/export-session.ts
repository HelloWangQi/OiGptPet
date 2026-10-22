import { atlasDimensions, type AtlasInspection, type AtlasProfile } from '../packages/target-chatgpt/contract';
import type { ModelInfo } from '../packages/character-core/vrm-file';

/** Structural contract shared with the independently developed preview component. */
export interface CheckedAtlas {
  blob: Blob;
  profile: AtlasProfile;
  inspection: AtlasInspection;
  sha256: string;
  encodedBytes: number;
}
export interface PreviewController {
  load(blob: Blob, profile: AtlasProfile, signal?: AbortSignal): Promise<CheckedAtlas>;
  dispose(): void;
}
export interface ModelProvenance { model: ModelInfo; source: 'local-import' | 'official-demo'; sourceUrl?: string }

function webLink(value?: string) {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export function createExportReport(result: CheckedAtlas, provenance: ModelProvenance, checkedAt = new Date().toISOString()) {
  if (!/^[a-f0-9]{64}$/.test(result.sha256) || result.encodedBytes !== result.blob.size || result.profile !== result.inspection.profile) {
    throw new Error('检查结果与导出文件不一致，请重新导出。');
  }
  return {
    schemaVersion: 1,
    application: 'OiGptPet', checkedAt,
    file: { profile: result.profile, ...atlasDimensions(result.profile), encodedBytes: result.encodedBytes, sha256: result.sha256, mime: result.blob.type },
    model: {
      name: provenance.model.name, authors: [...provenance.model.authors], vrmVersion: provenance.model.version,
      source: provenance.source, sourceUrl: webLink(provenance.sourceUrl), licenseUrl: webLink(provenance.model.licenseUrl),
    },
    localInspection: structuredClone(result.inspection),
    platformPreflight: { status: 'not-run' },
    platformInstallation: { status: 'not-run' },
    note: '本报告仅记录本地结构检查，不判断动作语义或角色许可，不代表目标平台已接受或安装。',
  };
}

export interface ExportRecord { checked: CheckedAtlas; report: ReturnType<typeof createExportReport> }

/** One export owns one preview and one immutable encoded Blob until reset. */
export class ExportSession {
  private revision = 0;
  private abort?: AbortController;
  private preview?: PreviewController;
  private completed?: ExportRecord;
  private pending = false;

  get record() { return this.completed; }
  get busy() { return this.pending; }
  get canSave() { return !this.pending && this.completed?.checked.inspection.valid === true; }

  reset() {
    ++this.revision;
    this.abort?.abort();
    this.abort = undefined;
    this.preview?.dispose();
    this.preview = undefined;
    this.completed = undefined;
    this.pending = false;
  }

  async run(
    profile: AtlasProfile,
    provenance: ModelProvenance,
    render: (signal: AbortSignal) => Promise<Blob>,
    mount: () => PreviewController,
  ): Promise<ExportRecord> {
    this.reset();
    const revision = this.revision;
    const abort = new AbortController();
    this.abort = abort;
    this.pending = true;
    // Snapshot metadata before any asynchronous operation or a later model change.
    const model = structuredClone(provenance);
    const assertCurrent = () => {
      if (revision !== this.revision || abort.signal.aborted) throw new DOMException('导出已取消。', 'AbortError');
    };
    try {
      const blob = await render(abort.signal);
      assertCurrent();
      this.preview = mount();
      const checked = await this.preview.load(blob, profile, abort.signal);
      assertCurrent();
      if (checked.blob !== blob || checked.profile !== profile) throw new Error('预览结果与当前导出文件不一致。');
      const record = { checked, report: createExportReport(checked, model) };
      this.completed = record;
      return record;
    } catch (error) {
      if (revision === this.revision) {
        this.preview?.dispose(); this.preview = undefined;
        this.completed = undefined;
      }
      throw error;
    } finally {
      if (revision === this.revision) { this.abort = undefined; this.pending = false; }
    }
  }
}
