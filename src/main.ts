import './style.css';
import { CompanionStage, type CompanionInput, type PreparedCompanion } from './companion-stage';
import { createCharacterLibrary, type CharacterAsset, type CharacterSummary } from '../packages/character-library';
import { MAX_MODEL_BYTES, type ModelInfo } from '../packages/character-core/vrm-file';
import { ANIMATION_ROWS, type AnimationState, type AtlasProfile } from '../packages/target-chatgpt/contract';
import { exportAtlas } from '../packages/pet-exporter';
import { ExportSession, type PreviewController } from './export-session';
import { getSavedModel } from './model-store';
import { DEFAULT_PREFERENCES, IDLE_AFTER_MS, PERFORMANCE_POLICIES, normalizePreferences, readPreferences, savePreferences, type DesktopPreferences } from './desktop-preferences';
import { FramePacer } from './frame-pacer';
import { sha256Hex } from '../packages/atlas-preview/sha256';

const app = document.querySelector<HTMLDivElement>('#app')!;
const desktop = window.petDesktop;
const petMode = new URLSearchParams(location.search).get('mode') === 'pet' && Boolean(desktop);
document.body.classList.toggle('pet-mode', petMode);
document.documentElement.classList.toggle('pet-mode', petMode);

const icon = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v8M7 5.8l10 5.4"/></svg>',
};

app.innerHTML = petMode ? `
  <main class="pet-shell">
    <div id="drag-handle" data-interactive>⠿ 拖动我</div>
    <canvas id="character-canvas" aria-label="桌宠角色"></canvas>
    <div id="pet-message" role="status"></div>
    <div id="pet-controls" data-interactive>
      <button id="workshop-button" title="角色工坊">工坊</button>
      <button id="pet-wave" title="挥手">挥手</button>
      <button id="click-through" title="Ctrl+Alt+P 或托盘恢复互动">穿透</button>
      <button id="hide-pet" title="从托盘重新显示">隐藏</button>
    </div>
  </main>` : `
  <aside class="rail">
    <a class="brand" href="#" aria-label="OiGptPet 首页">oi<span>·</span></a>
    <div class="rail-mark selected" title="角色工坊">${icon.box}</div>
    <div class="rail-line"></div>
    <span class="rail-bottom">0.3</span>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <div><span class="eyebrow">YOUR LITTLE COMPANION</span><h1>角色工坊<span> / Studio</span></h1></div>
      <div class="top-actions"><span class="local-badge"><i></i> 本地运行</span><button class="button dark" id="open-pet">放到桌面 ${icon.arrow}</button></div>
    </header>
    <main class="workshop-grid">
      <section class="preview-column">
        <div class="section-heading"><div><span class="section-number">01</span><h2>遇见你的新搭档</h2></div><span class="muted small">让喜欢的角色，陪在身边。</span></div>
        <div class="preview-stage" id="drop-zone">
          <div class="stage-label"><span class="live-dot"></span> LIVE PREVIEW <span id="format-badge">VRM 1.0</span></div>
          <div class="stage-grid"></div><div class="stage-halo"></div><div class="ground-shadow"></div>
          <canvas id="character-canvas" aria-label="VRM 角色实时预览"></canvas>
          <div class="stage-empty" id="stage-empty"><span>初次见面，请多关照。</span><p>导入 VRM 或精灵图，开启陪伴。</p></div>
          <div class="stage-caption"><div><span class="eyebrow">CURRENT COMPANION</span><h3 id="character-name">等待角色</h3><span id="character-author">仅在本机处理你的模型</span></div><button class="round-button" id="wave-button" title="向你挥手">✧</button></div>
          <span class="stage-tip">移动鼠标，和 TA 对视 · 支持拖入 VRM / PNG / WebP</span>
        </div>
        <div class="motion-panel"><div class="motion-heading"><h2>今天是什么心情？</h2><button id="pause-button" class="text-button">暂停动画</button></div><div class="motion-list">${ANIMATION_ROWS.map((row, i) => `<button class="motion-button ${i === 0 ? 'active' : ''}" data-state="${row.state}"><span class="motion-index">${String(i + 1).padStart(2, '0')}</span>${row.label}</button>`).join('')}</div></div>
        <p class="status-line" id="status" role="status" aria-live="polite">正在准备角色工坊…</p>
      </section>
      <aside class="detail-column">
        <section class="detail-section"><div class="section-heading"><div><span class="section-number">02</span><h2>你的角色</h2></div><span class="tag">VRM</span></div>
          <button class="character-card" id="load-demo" ${__WITH_DEMO__ ? '' : 'hidden'}><div class="avatar-monogram">S<span>✦</span></div><div><strong>官方示例角色</strong><span>pixiv · VRM 1.0</span></div><span class="card-arrow">↗</span></button>
          <button class="import-zone" id="import-button" disabled>${icon.plus}<strong>导入我的角色</strong><span>VRM 1.0 ≤64 MiB · PNG / WebP ≤20 MiB</span></button>
          <input type="file" id="model-file" accept=".vrm,.png,.webp,image/png,image/webp" hidden />
          <label class="field-label" for="sprite-profile">导入精灵图规格</label>
          <select id="sprite-profile"><option value="v2">v2 · 含 16 方向视线</option><option value="v1">v1 · 仅动作</option></select>
          <button class="text-button" id="cancel-load" hidden>取消加载</button>
          <div id="character-list" class="character-list" aria-label="本地角色库"></div>
          <div id="character-editor" hidden><label class="field-label" for="character-alias">当前角色名称</label><input id="character-alias" maxlength="80" /><button class="text-button" id="rename-character">保存名称</button></div>
          <p class="helper">角色保存在本机，最多 12 个、合计 256 MiB。删除库内副本不会删除原文件。请确认作者允许使用。</p>
        </section>
        <section class="detail-section export-section"><div class="section-heading"><div><span class="section-number">03</span><h2>同一个 TA，两种陪伴</h2></div></div>
          <div class="destination-card"><span class="destination-icon">↗</span><div><strong>独立桌面</strong><p>随时互动，自由换装换角色</p></div><span class="status-pill">实时</span></div>
          <div class="destination-card"><span class="destination-icon">✳</span><div><strong>ChatGPT 宠物</strong><p>将角色动作导出为透明精灵图</p></div><span class="status-pill warm">导出</span></div>
          <label class="field-label" for="export-profile">导出格式</label>
          <select id="export-profile"><option value="v2">v2 · 73 帧 / 含 16 方向视线</option><option value="v1">v1 · 57 帧 / 网页文档规格</option></select>
          <button class="button export-button" id="export-button" disabled>${icon.download} 导出宠物动画</button>
          <p class="helper">试验性导出。安装前需通过目标应用校验，并确认模型允许导出和上传。</p>
        </section>
        <section class="detail-section desktop-settings"><div class="section-heading"><div><span class="section-number">04</span><h2>陪伴设置</h2></div></div>
          <label class="field-label" for="pet-scale">桌宠大小</label>
          <select id="pet-scale" disabled><option value="0.8">小 · 80%</option><option value="1" selected>标准 · 100%</option><option value="1.2">大 · 120%</option></select>
          <label class="field-label" for="performance-mode">动画性能</label>
          <select id="performance-mode" disabled><option value="quality">画质优先 · 最高 60 帧</option><option value="balanced" selected>均衡 · 最高 30 帧</option><option value="battery">省电 · 最高 15 帧</option></select>
          <p class="helper">闲置 10 秒自动降低绘制频率，隐藏时停止绘制。设置在本机保存。</p>
          <p class="helper" id="settings-status" role="status" aria-live="polite"></p>
        </section>
        <section class="note-card"><span class="note-star">✦</span><div><strong>从一个喜欢的角色开始。</strong><p>角色和动作共用一套源资产。桌面实时互动，ChatGPT 播放导出的动画。</p></div></section>
        <details class="model-details"><summary>角色信息与使用说明</summary><div id="model-info">导入后显示角色元数据。</div><p>导出不代表已安装为 ChatGPT 宠物。不同入口可能支持不同规格；安装和预检在目标应用内完成。</p></details>
      </aside>
    </main>
    <footer><span>OiGptPet <span class="footer-dot">·</span> 为日常，添一点陪伴。</span><span>WINDOWS DESKTOP / VRM / SPRITE EXPORT</span></footer>
  </div>
  <dialog id="export-dialog">
    <div class="dialog-heading"><div><span class="eyebrow">REVIEW YOUR COMPANION</span><h2>检查导出动画</h2></div><button id="close-export" class="round-button" aria-label="关闭">×</button></div>
    <div class="verification-status"><span>本地结构 <strong id="local-check-status">尚未检查</strong></span><span>平台预检 <strong>未执行</strong></span><span>平台安装 <strong>未执行</strong></span></div>
    <progress id="export-progress" max="73" value="0" hidden aria-label="动画导出进度"></progress>
    <div id="check-messages" role="status" aria-live="polite"></div>
    <div id="atlas-preview-host"></div>
    <p id="export-description"></p><code id="export-sha256"></code>
    <details id="atlas-overview"><summary>查看完整图集</summary><div class="atlas-preview"><img id="atlas-image" alt="实际导出文件的完整图集" /></div></details>
    <p class="helper">本地检查只确认文件结构。请检查每个动作和视线，之后在目标入口完成正式预检与安装。</p>
    <div class="export-save-actions"><button id="save-atlas" class="button dark" disabled>保存 PNG 图集 ${icon.download}</button><button id="save-report" class="button" disabled>保存检查报告</button><button class="button" id="cancel-export" hidden>取消导出</button></div>
  </dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvasHost = $<HTMLCanvasElement>('#character-canvas').parentElement!;
let stage: CompanionStage;
const library = createCharacterLibrary();
const libraryChannel = new BroadcastChannel('oigptpet-library-changed');
let currentCharacter: CharacterSummary | null = null;
let loadController: AbortController | null = null;
let committing = false;
let syncRequested = false;
let source: ArrayBuffer | null = null;
let state: AnimationState = 'idle';
let info: ModelInfo | null = null;
let loading = false;
let paused = false;
let animationTime = 0;
let lastInteraction = performance.now();
let preferences: DesktopPreferences = { ...DEFAULT_PREFERENCES };
const framePacer = new FramePacer();
let resizeStage = () => {};
let transientUntil = 0;
let look: { yaw: number; pitch: number; angle: number } | undefined;
let lastPointer = 0;
const exportSession = new ExportSession();
let runRevision = 0;
let exportUrl: string | undefined;
let modelSource: 'local-import' | 'official-demo' = 'local-import';
let forcedInteractive = false;
let ignoringMouse = false;

function applyPreferences(value: DesktopPreferences) {
  preferences = normalizePreferences(value);
  framePacer.reset();
  resizeStage();
  if (!petMode) {
    $<HTMLSelectElement>('#pet-scale').value = String(preferences.scale);
    $<HTMLSelectElement>('#performance-mode').value = preferences.performance;
  }
}

async function changePreferences() {
  const size = $<HTMLSelectElement>('#pet-scale');
  const performance = $<HTMLSelectElement>('#performance-mode');
  size.disabled = true; performance.disabled = true;
  try {
    const next = await savePreferences({ scale: Number(size.value) as DesktopPreferences['scale'], performance: performance.value as DesktopPreferences['performance'] });
    applyPreferences(next);
    $('#settings-status').textContent = '已保存。';
  } catch {
    applyPreferences(preferences);
    $('#settings-status').textContent = '设置保存失败，请重试。';
  } finally { size.disabled = !desktop; performance.disabled = false; }
}

function status(message: string, error = false) {
  const target = petMode ? $('#pet-message') : $('#status');
  target.textContent = message;
  target.classList.toggle('error', error);
}
function showInfo(value: ModelInfo) {
  if (petMode) { status(''); return; }
  $('#character-name').textContent = value.name.replaceAll('_', ' ');
  $('#character-author').textContent = `模型作者 · ${value.authors.join(' / ') || '未提供'}`;
  $('#stage-empty').hidden = true;
  $('#model-info').replaceChildren();
  for (const [label, text] of [
    ['版本', `VRM ${value.version}`], ['作者', value.authors.join(' / ') || '未提供'],
    ['表情', value.expressions.join('、') || '未提供预设表情'],
    ['许可链接', value.licenseUrl || '未提供'],
    ['第三方使用', value.avatarPermission], ['源模型再分发', value.allowRedistribution ? '元数据声明允许，仍需核对完整许可' : '元数据未声明允许'],
  ]) {
    const paragraph = document.createElement('p');
    paragraph.textContent = `${label}：${text}`;
    $('#model-info').append(paragraph);
  }
}
function showCharacter(summary: CharacterSummary | null, value: ModelInfo | null, input: CompanionInput) {
  document.body.dataset.characterKind = input.kind;
  document.body.dataset.characterId = summary?.id ?? '';
  if (value) showInfo(value);
  if (petMode) { status(''); return; }
  $('#stage-empty').hidden = true;
  $('#format-badge').textContent = input.kind === 'vrm' ? 'VRM 1.0' : `SPRITE ${input.profile}`;
  $('#character-name').textContent = summary?.name ?? value?.name ?? '本地精灵图';
  if (!value) {
    $('#character-author').textContent = '精灵图角色 · 原文件保存在本机';
    $('#model-info').textContent = `精灵图 ${input.kind === 'sprite' ? input.profile : ''}；可用于桌宠播放。作者和使用许可请核对原始文件说明。`;
  }
  $('#character-editor').hidden = !summary;
  $<HTMLInputElement>('#character-alias').value = summary?.name ?? '';
  $<HTMLButtonElement>('#export-button').title = value ? '' : '精灵图可直接播放；导出新动作需要源 VRM。';
}

async function refreshLibrary() {
  const entries = await library.list();
  if (petMode) return;
  const host = $('#character-list'); host.replaceChildren();
  for (const item of entries) {
    const row = document.createElement('div'); row.className = 'library-row'; row.dataset.characterId = item.id;
    const select = document.createElement('button'); select.className = 'library-select'; select.dataset.selectCharacter = item.id;
    select.textContent = `${item.id === currentCharacter?.id ? '● ' : ''}${item.name} · ${item.kind === 'vrm' ? 'VRM' : item.profile}`;
    select.disabled = loading || item.id === currentCharacter?.id;
    select.onclick = () => void selectCharacter(item.id);
    const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = '移除'; remove.dataset.removeCharacter = item.id;
    remove.disabled = loading || item.id === currentCharacter?.id;
    remove.onclick = () => void removeCharacter(item.id);
    row.append(select, remove); host.append(row);
  }
}

function notifyLibrary() { libraryChannel.postMessage('changed'); }

async function load(input: CompanionInput, persist: boolean, origin: 'local-import' | 'official-demo' = 'local-import', existing?: CharacterSummary) {
  if (loading) return;
  clearExport();
  loading = true;
  const controller = new AbortController(); loadController = controller;
  if (!petMode) {
    $<HTMLButtonElement>('#export-button').disabled = true;
    $('#cancel-load').hidden = false;
    $<HTMLButtonElement>('#cancel-load').disabled = false;
    $<HTMLButtonElement>('#import-button').disabled = true;
  }
  status('正在加载角色…');
  let prepared: PreparedCompanion | undefined;
  try {
    if (existing && (input.blob.size !== existing.encodedBytes || await sha256Hex(await input.blob.arrayBuffer(), { signal: controller.signal }) !== existing.sha256)) throw new Error('角色内容与保存摘要不一致。');
    prepared = await stage.prepare(input, controller.signal);
    const nextSource = input.kind === 'vrm' ? await input.blob.arrayBuffer() : null;
    let summary = existing ?? null;
    if (persist && !summary) summary = await library.add(input, controller.signal);
    if (controller.signal.aborted) throw new DOMException('角色切换已取消。', 'AbortError');
    committing = true;
    if (!petMode) $<HTMLButtonElement>('#cancel-load').disabled = true;
    if (persist && summary) await library.activate(summary.id);
    prepared.commit();
    currentCharacter = summary;
    info = prepared.info; source = nextSource; modelSource = origin;
    animationTime = 0; changeState('idle'); framePacer.reset(); resizeStage();
    showCharacter(summary, info, input);
    if (persist) notifyLibrary();
    status(petMode ? '' : '角色已就绪 · 点击动作试试看。');
  } catch (error) {
    status(controller.signal.aborted ? '加载已取消，保留原角色。' : `${error instanceof Error ? error.message : '角色加载失败。'}${stage.loaded ? ' 已保留原角色。' : ''}`, true);
  } finally {
    prepared?.dispose(); loading = false; committing = false; loadController = null;
    if (!petMode) { $<HTMLButtonElement>('#export-button').disabled = !source; $('#cancel-load').hidden = true; $<HTMLButtonElement>('#import-button').disabled = false; }
    try { await refreshLibrary(); } catch { status('角色库读取失败，请重试。', true); }
    if (syncRequested) { syncRequested = false; void syncLibrary(); }
  }
}

function assetInput(asset: CharacterAsset): CompanionInput {
  if (asset.summary.kind === 'sprite') {
    if (asset.summary.profile !== 'v1' && asset.summary.profile !== 'v2') throw new Error('精灵图规格缺失。');
    return { kind: 'sprite', blob: asset.blob, profile: asset.summary.profile };
  }
  return { kind: 'vrm', blob: asset.blob };
}

async function selectCharacter(id: string) {
  if (loading) return;
  try {
    const asset = await library.get(id);
    if (!asset) throw new Error('角色不存在，请刷新角色库。');
    await load(assetInput(asset), true, 'local-import', asset.summary);
  } catch (error) { status(error instanceof Error ? error.message : '切换失败，保留原角色。', true); }
}

async function removeCharacter(id: string) {
  if (loading) return;
  try { await library.remove(id); await refreshLibrary(); notifyLibrary(); status('已移除库内副本，原文件未删除。'); }
  catch (error) { status(error instanceof Error ? error.message : '移除失败。', true); }
}

async function syncLibrary() {
  if (loading) { syncRequested = true; return; }
  try {
    const active = await library.getActive();
    if (active && active.summary.id !== currentCharacter?.id) await load(assetInput(active), false, 'local-import', active.summary);
    else if (active) { currentCharacter = active.summary; showCharacter(currentCharacter, info, assetInput(active)); }
    await refreshLibrary();
  } catch (error) { status(`角色同步失败，保留当前画面：${error instanceof Error ? error.message : '请重试。'}`, true); }
}

async function demo(persist: boolean) {
  try {
    const response = await fetch(new URL('models/demo.vrm', document.baseURI));
    if (!response.ok) throw new Error('示例暂不可用。请导入本机的 VRM 1.0 角色。');
    await load({ kind: 'vrm', blob: await response.blob() }, persist, 'official-demo');
  } catch (error) { status(error instanceof Error ? error.message : '示例加载失败。', true); }
}

function changeState(next: AnimationState) {
  state = next; animationTime = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.classList.toggle('active', button.dataset.state === next));
}

async function importFile(file?: File) {
  if (!file || !stage || loading) return;
  if (file.name.toLowerCase().endsWith('.vrm')) {
    if (file.size > MAX_MODEL_BYTES) { status('模型不能超过 64 MiB。', true); return; }
    await load({ kind: 'vrm', blob: file }, true);
  } else if (/\.(png|webp)$/i.test(file.name)) {
    if (file.size > 20 * 1024 * 1024) { status('精灵图不能超过 20 MiB。', true); return; }
    const type = file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp';
    await load({ kind: 'sprite', blob: file.type ? file : new Blob([file], { type }), profile: $<HTMLSelectElement>('#sprite-profile').value as AtlasProfile }, true);
  } else status('请选择 VRM、PNG 或 WebP 文件。', true);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function clearExport(closeDialog = true) {
  ++runRevision;
  exportSession.reset();
  if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = undefined; }
  if (petMode) return;
  $<HTMLImageElement>('#atlas-image').removeAttribute('src');
  $('#atlas-preview-host').replaceChildren();
  $('#check-messages').replaceChildren();
  $('#export-description').textContent = '';
  $('#export-sha256').textContent = '';
  $('#local-check-status').textContent = '尚未检查';
  $<HTMLButtonElement>('#save-atlas').disabled = true;
  $<HTMLButtonElement>('#save-report').disabled = true;
  $<HTMLButtonElement>('#export-button').disabled = !source || loading;
  $('#export-progress').hidden = true;
  $('#cancel-export').hidden = true;
  const dialog = $<HTMLDialogElement>('#export-dialog');
  if (closeDialog && dialog.open) dialog.close();
}

const previewModules = import.meta.glob<{ createAtlasPreview(host: HTMLElement): PreviewController }>('../packages/atlas-preview/index.ts');

async function runExport() {
  if (!source || !info || exportSession.busy || loading) return;
  clearExport(false);
  const revision = runRevision;
  const currentSource = source;
  const currentInfo = structuredClone(info);
  const origin = modelSource;
  const profile = $<HTMLSelectElement>('#export-profile').value as AtlasProfile;
  const button = $<HTMLButtonElement>('#export-button');
  button.disabled = true;
  const progress = $<HTMLProgressElement>('#export-progress');
  progress.hidden = false;
  $('#cancel-export').hidden = false;
  $('#local-check-status').textContent = '正在渲染';
  $<HTMLDialogElement>('#export-dialog').showModal();
  status('正在渲染透明动画帧…');
  try {
    const importPreview = previewModules['../packages/atlas-preview/index.ts'];
    if (!importPreview) throw new Error('动画预览暂不可用，请稍后重试。');
    const { createAtlasPreview } = await importPreview();
    if (revision !== runRevision) return;
    const record = await exportSession.run(profile, {
      model: currentInfo, source: origin,
      sourceUrl: origin === 'official-demo' ? 'https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models' : undefined,
    }, async (signal) => {
      const rendered = await exportAtlas(currentSource, profile, (done, total) => {
        if (revision !== runRevision) return;
        progress.max = total; progress.value = done;
        $('#local-check-status').textContent = `渲染 ${done} / ${total}`;
        status(`正在导出 ${done} / ${total} 帧…`);
      }, signal);
      if (revision === runRevision) $('#local-check-status').textContent = '正在检查';
      return rendered.blob;
    }, () => createAtlasPreview($('#atlas-preview-host')));
    if (revision !== runRevision) return;
    const { checked, report } = record;
    exportUrl = URL.createObjectURL(checked.blob);
    $<HTMLImageElement>('#atlas-image').src = exportUrl;
    $('#export-description').textContent = `${report.model.name} · ${report.file.width} × ${report.file.height} · ${checked.inspection.requiredFrames} 帧 · ${(checked.encodedBytes / 1024 / 1024).toFixed(2)} MiB`;
    $('#export-sha256').textContent = `SHA-256 ${checked.sha256}`;
    $('#local-check-status').textContent = checked.inspection.valid ? '通过' : '未通过';
    for (const issue of checked.inspection.errors) {
      const paragraph = document.createElement('p'); paragraph.className = 'error';
      paragraph.textContent = `${issue.row === undefined ? '' : `第 ${issue.row + 1} 行、第 ${(issue.frame ?? 0) + 1} 帧：`}${issue.message}`;
      $('#check-messages').append(paragraph);
    }
    for (const warning of checked.inspection.warnings) {
      const paragraph = document.createElement('p'); paragraph.className = 'helper'; paragraph.textContent = warning;
      $('#check-messages').append(paragraph);
    }
    $<HTMLButtonElement>('#save-atlas').disabled = !exportSession.canSave;
    $<HTMLButtonElement>('#save-report').disabled = false;
    status(checked.inspection.valid ? '本地结构检查通过。请查看动作预览，再保存文件。' : '图集结构未通过检查，已禁用 PNG 保存。', !checked.inspection.valid);
  } catch (error) {
    if (revision !== runRevision) return;
    const message = error instanceof Error ? error.message : '导出失败。';
    $('#local-check-status').textContent = '未通过';
    $('#check-messages').textContent = message;
    status(message, true);
  } finally {
    if (revision === runRevision) { button.disabled = !source; progress.hidden = true; $('#cancel-export').hidden = true; }
  }
}

async function bootstrap() {
  try { applyPreferences(await readPreferences()); }
  catch { applyPreferences(DEFAULT_PREFERENCES); if (!petMode) $('#settings-status').textContent = '设置读取失败，暂用默认值。'; }
  desktop?.onPreferencesChanged(applyPreferences);
  if (!petMode) {
    $<HTMLSelectElement>('#pet-scale').disabled = !desktop;
    $<HTMLSelectElement>('#performance-mode').disabled = false;
    if (!desktop) $<HTMLSelectElement>('#pet-scale').title = '桌宠大小需要桌面应用。';
  }
  stage = new CompanionStage($<HTMLCanvasElement>('#character-canvas'));
  const resize = () => {
    const bounds = canvasHost.getBoundingClientRect();
    if (bounds.width && bounds.height) stage.resize(Math.round(bounds.width), Math.round(bounds.height), Math.min(window.devicePixelRatio || 1, PERFORMANCE_POLICIES[preferences.performance].maxPixelRatio));
  };
  resizeStage = resize;
  new ResizeObserver(resize).observe(canvasHost);
  resize();
  const frame = (now: number) => {
    const policy = PERFORMANCE_POLICIES[preferences.performance];
    const fps = now - lastInteraction >= IDLE_AFTER_MS ? policy.idleFps : policy.activeFps;
    const delta = framePacer.tick(now, fps, document.hidden);
    if (delta !== null) {
      if (!paused) animationTime += delta;
      if (transientUntil && now > transientUntil) { transientUntil = 0; changeState('idle'); }
      stage.render(state, animationTime, paused ? 0 : delta, now - lastPointer < 1800 ? look : undefined);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('pointermove', (event) => {
    const bounds = canvasHost.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    look = { yaw: -x / bounds.width * 0.7, pitch: y / bounds.height * 0.4, angle: (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360 };
    lastPointer = performance.now();
    lastInteraction = lastPointer;
    if (petMode && !forcedInteractive) {
      const interactive = (event.target as HTMLElement)?.closest('[data-interactive]') || stage.hitTest(event.clientX, event.clientY);
      const next = !interactive;
      if (next !== ignoringMouse) { ignoringMouse = next; void desktop!.setClickThrough(next); }
    }
  });
  const markActive = () => { lastInteraction = performance.now(); };
  window.addEventListener('pointerdown', markActive);
  window.addEventListener('keydown', markActive);
  document.addEventListener('visibilitychange', () => { framePacer.reset(); markActive(); });
  canvasHost.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).id !== 'character-canvas') return;
    changeState('waving'); transientUntil = performance.now() + 2000;
  });
  try {
    let active = await library.getActive();
    if (!active) {
      const saved = await getSavedModel();
      if (saved) { await library.migrateLegacyVrm(saved); active = await library.getActive(); }
    }
    if (active) await load(assetInput(active), false, 'local-import', active.summary);
    else if (__WITH_DEMO__) await demo(false);
    else status('导入本机的 VRM 1.0 角色或精灵图，开始陪伴。');
    await refreshLibrary();
  } catch (error) { status(`本地角色读取或迁移失败，原数据已保留：${error instanceof Error ? error.message : '请重试。'}`, true); }
  if (!petMode) $<HTMLButtonElement>('#import-button').disabled = false;
  libraryChannel.onmessage = () => void syncLibrary();
  desktop?.onModelChanged(() => void syncLibrary());
  desktop?.onInteractionRestored(() => { forcedInteractive = true; ignoringMouse = false; });
}

if (petMode) {
  $('#workshop-button').onclick = () => void desktop!.openWorkshop();
  $('#hide-pet').onclick = () => void desktop!.hidePet();
  $('#pet-wave').onclick = () => { changeState('waving'); transientUntil = performance.now() + 2000; };
  $('#click-through').onclick = () => {
    forcedInteractive = false; ignoringMouse = true;
    void desktop!.setClickThrough(true);
  };
} else {
  $('#cancel-load').onclick = () => { if (!committing) loadController?.abort(); };
  $('#rename-character').onclick = async () => {
    if (!currentCharacter || loading) return;
    try { await library.rename(currentCharacter.id, $<HTMLInputElement>('#character-alias').value); await syncLibrary(); notifyLibrary(); status('角色名称已保存。'); }
    catch (error) { status(error instanceof Error ? error.message : '名称保存失败。', true); }
  };
  $('#pet-scale').onchange = () => void changePreferences();
  $('#performance-mode').onchange = () => void changePreferences();
  $('#import-button').onclick = () => $<HTMLInputElement>('#model-file').click();
  $<HTMLInputElement>('#model-file').onchange = (event) => {
    const input = event.target as HTMLInputElement;
    void importFile(input.files?.[0]); input.value = '';
  };
  $('#load-demo').onclick = () => void demo(true);
  $('#wave-button').onclick = () => { changeState('waving'); transientUntil = performance.now() + 2000; };
  $('#pause-button').onclick = () => { paused = !paused; $('#pause-button').textContent = paused ? '继续动画' : '暂停动画'; };
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.onclick = () => { transientUntil = 0; changeState(button.dataset.state as AnimationState); });
  if (desktop) {
    $('#open-pet').onclick = () => { void desktop.openPet().catch(() => status('桌宠窗口无法打开，请从托盘重新尝试。', true)); };
  } else {
    const open = $<HTMLButtonElement>('#open-pet');
    open.disabled = true; open.textContent = '桌面版功能';
    open.title = '独立悬浮需要桌面应用；浏览器支持角色预览与图集导出。';
  }
  $('#export-button').onclick = () => void runExport();
  $('#cancel-export').onclick = () => { clearExport(); status('导出已取消。'); };
  $('#close-export').onclick = () => $<HTMLDialogElement>('#export-dialog').close();
  $('#export-dialog').addEventListener('close', () => clearExport(false));
  $('#save-atlas').onclick = async () => {
    const record = exportSession.record;
    if (!record || !exportSession.canSave) return;
    try {
      if (desktop) {
        const path = await desktop.saveAtlas(new Uint8Array(await record.checked.blob.arrayBuffer()), record.checked.profile, record.checked.sha256);
        if (path) status(`图集已保存到 ${path}`);
      } else download(record.checked.blob, `OiGptPet-${record.checked.profile}.png`);
    } catch { status('保存失败，请重试。', true); }
  };
  $('#save-report').onclick = async () => {
    const record = exportSession.record;
    if (!record) return;
    const json = JSON.stringify(record.report, null, 2);
    try {
      if (desktop) { const path = await desktop.saveReport(json); if (path) status(`检查报告已保存到 ${path}`); }
      else download(new Blob([json], { type: 'application/json' }), `OiGptPet-${record.checked.profile}-report.json`);
    } catch { status('报告保存失败，请重试。', true); }
  };
  window.addEventListener('dragover', (event) => { event.preventDefault(); $('#drop-zone').classList.add('dragover'); });
  window.addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragover'));
  window.addEventListener('drop', (event) => { event.preventDefault(); $('#drop-zone').classList.remove('dragover'); void importFile(event.dataTransfer?.files[0]); });
}

window.addEventListener('beforeunload', () => { loadController?.abort(); libraryChannel.close(); library.close(); exportSession.reset(); stage?.dispose(); if (exportUrl) URL.revokeObjectURL(exportUrl); });
void bootstrap();
