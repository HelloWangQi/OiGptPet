import './style.css';
import { VrmStage } from '../packages/renderer-vrm';
import { MAX_MODEL_BYTES, type ModelInfo } from '../packages/character-core/vrm-file';
import { ANIMATION_ROWS, type AnimationState, type AtlasProfile } from '../packages/target-chatgpt/contract';
import { exportAtlas, type ExportResult } from '../packages/pet-exporter';
import { getSavedModel, saveModel } from './model-store';

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
    <span class="rail-bottom">0.1</span>
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
          <div class="stage-empty" id="stage-empty"><span>初次见面，请多关照。</span><p>导入一个 VRM，开启陪伴。</p></div>
          <div class="stage-caption"><div><span class="eyebrow">CURRENT COMPANION</span><h3 id="character-name">等待角色</h3><span id="character-author">仅在本机处理你的模型</span></div><button class="round-button" id="wave-button" title="向你挥手">✧</button></div>
          <span class="stage-tip">移动鼠标，和 TA 对视 · 支持拖入 .vrm</span>
        </div>
        <div class="motion-panel"><div class="motion-heading"><h2>今天是什么心情？</h2><button id="pause-button" class="text-button">暂停动画</button></div><div class="motion-list">${ANIMATION_ROWS.map((row, i) => `<button class="motion-button ${i === 0 ? 'active' : ''}" data-state="${row.state}"><span class="motion-index">${String(i + 1).padStart(2, '0')}</span>${row.label}</button>`).join('')}</div></div>
        <p class="status-line" id="status" role="status" aria-live="polite">正在准备角色工坊…</p>
      </section>
      <aside class="detail-column">
        <section class="detail-section"><div class="section-heading"><div><span class="section-number">02</span><h2>你的角色</h2></div><span class="tag">VRM</span></div>
          <button class="character-card" id="load-demo"><div class="avatar-monogram">S<span>✦</span></div><div><strong>官方示例角色</strong><span>pixiv · VRM 1.0</span></div><span class="card-arrow">↗</span></button>
          <button class="import-zone" id="import-button">${icon.plus}<strong>导入我的角色</strong><span>.vrm · 最大 64 MiB · VRM 1.0</span></button>
          <input type="file" id="model-file" accept=".vrm" hidden />
          <p class="helper">模型保存在本机。可从 VRoid Studio 导出，或使用作者允许使用的 VRM。</p>
        </section>
        <section class="detail-section export-section"><div class="section-heading"><div><span class="section-number">03</span><h2>同一个 TA，两种陪伴</h2></div></div>
          <div class="destination-card"><span class="destination-icon">↗</span><div><strong>独立桌面</strong><p>随时互动，自由换装换角色</p></div><span class="status-pill">实时</span></div>
          <div class="destination-card"><span class="destination-icon">✳</span><div><strong>ChatGPT 宠物</strong><p>将角色动作导出为透明精灵图</p></div><span class="status-pill warm">导出</span></div>
          <label class="field-label" for="export-profile">导出格式</label>
          <select id="export-profile"><option value="v2">v2 · 73 帧 / 含 16 方向视线</option><option value="v1">v1 · 57 帧 / 网页文档规格</option></select>
          <button class="button export-button" id="export-button" disabled>${icon.download} 导出宠物动画</button>
          <button class="text-button cancel-button" id="cancel-export" hidden>取消导出</button>
          <progress id="export-progress" max="73" value="0" hidden></progress>
          <p class="helper">试验性导出。安装前需通过目标应用校验，并确认模型允许导出和上传。</p>
        </section>
        <section class="note-card"><span class="note-star">✦</span><div><strong>从一个喜欢的角色开始。</strong><p>角色和动作共用一套源资产。桌面实时互动，ChatGPT 播放导出的动画。</p></div></section>
        <details class="model-details"><summary>角色信息与使用说明</summary><div id="model-info">导入后显示角色元数据。</div><p>导出不代表已安装为 ChatGPT 宠物。不同入口可能支持不同规格；安装和预检在目标应用内完成。</p></details>
      </aside>
    </main>
    <footer><span>OiGptPet <span class="footer-dot">·</span> 为日常，添一点陪伴。</span><span>WINDOWS DESKTOP / VRM / SPRITE EXPORT</span></footer>
  </div>
  <dialog id="export-dialog"><div class="dialog-heading"><div><span class="eyebrow">YOUR COMPANION, READY TO GO</span><h2>角色动画已导出</h2></div><button id="close-export" class="round-button" aria-label="关闭">×</button></div><div class="atlas-preview"><img id="atlas-image" alt="角色动作图集预览" /></div><p id="export-description"></p><p class="helper">这是动画素材草稿。请检查每个动作、边界和视线，再在目标入口完成正式校验。</p><button id="save-atlas" class="button dark">保存 PNG 图集 ${icon.download}</button></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#character-canvas');
let stage: VrmStage;
let source: ArrayBuffer | null = null;
let state: AnimationState = 'idle';
let info: ModelInfo | null = null;
let loading = false;
let paused = false;
let animationTime = 0;
let previousTime = performance.now();
let transientUntil = 0;
let look: { yaw: number; pitch: number } | undefined;
let lastPointer = 0;
let exportAbort: AbortController | undefined;
let exportResult: ExportResult | undefined;
let exportUrl: string | undefined;
let forcedInteractive = false;
let ignoringMouse = false;

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
async function load(buffer: ArrayBuffer, persist: boolean) {
  if (loading || exportAbort) return;
  loading = true;
  status('正在加载角色…');
  try {
    const value = await stage.load(buffer);
    info = value; source = buffer;
    showInfo(value);
    if (persist) {
      try { await saveModel(buffer); }
      catch { status('角色已加载，但本地保存失败；重启后请重新导入。', true); return; }
    }
    status(petMode ? '' : '角色已就绪 · 点击动作试试看。');
  } catch (error) { status(error instanceof Error ? error.message : '模型加载失败。', true); }
  finally { loading = false; if (!petMode) $<HTMLButtonElement>('#export-button').disabled = !source; }
}

async function demo(persist: boolean) {
  try {
    const response = await fetch(new URL('models/demo.vrm', document.baseURI));
    if (!response.ok) throw new Error('示例模型尚未下载，请运行 npm run demo:fetch，或导入自己的 VRM。');
    await load(await response.arrayBuffer(), persist);
  } catch (error) { status(error instanceof Error ? error.message : '示例加载失败。', true); }
}

function changeState(next: AnimationState) {
  state = next; animationTime = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.classList.toggle('active', button.dataset.state === next));
}

async function importFile(file?: File) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.vrm')) { status('请选择 .vrm 文件。', true); return; }
  if (file.size > MAX_MODEL_BYTES) { status('模型不能超过 64 MiB。', true); return; }
  await load(await file.arrayBuffer(), true);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function runExport() {
  if (!source || exportAbort || loading) return;
  exportAbort = new AbortController();
  const profile = $<HTMLSelectElement>('#export-profile').value as AtlasProfile;
  const button = $<HTMLButtonElement>('#export-button');
  button.disabled = true;
  const progress = $<HTMLProgressElement>('#export-progress');
  progress.hidden = false;
  $('#cancel-export').hidden = false;
  status('正在渲染透明动画帧…');
  try {
    exportResult = await exportAtlas(source, profile, (done, total) => {
      progress.max = total; progress.value = done;
      status(`正在导出 ${done} / ${total} 帧…`);
    }, exportAbort.signal);
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(exportResult.blob);
    $<HTMLImageElement>('#atlas-image').src = exportUrl;
    $('#export-description').textContent = `${info?.name ?? '角色'} · ${exportResult.width} × ${exportResult.height} · ${exportResult.frames} 帧 · ${(exportResult.blob.size / 1024 / 1024).toFixed(2)} MiB`;
    $<HTMLDialogElement>('#export-dialog').showModal();
    status('图集已生成。保存后请在目标入口完成校验。');
  } catch (error) { status(exportAbort.signal.aborted ? '导出已取消。' : error instanceof Error ? error.message : '导出失败。', !exportAbort.signal.aborted); }
  finally { exportAbort = undefined; button.disabled = !source; progress.hidden = true; $('#cancel-export').hidden = true; }
}

async function bootstrap() {
  try { stage = new VrmStage(canvas); }
  catch { status('无法启动 WebGL。请更新显卡驱动，或在支持 WebGL 的环境运行。', true); return; }
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width && bounds.height) stage.resize(Math.round(bounds.width), Math.round(bounds.height));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  const frame = (now: number) => {
    const delta = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    if (!document.hidden) {
      if (!paused) animationTime += delta;
      if (transientUntil && now > transientUntil) { transientUntil = 0; changeState('idle'); }
      stage.render(state, animationTime / 2, paused ? 0 : delta, now - lastPointer < 1800 ? look : undefined);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect();
    look = { yaw: -(event.clientX - bounds.left - bounds.width / 2) / bounds.width * 0.7, pitch: (event.clientY - bounds.top - bounds.height / 2) / bounds.height * 0.4 };
    lastPointer = performance.now();
    if (petMode && !forcedInteractive) {
      const interactive = (event.target as HTMLElement)?.closest('[data-interactive]') || stage.hitTest(event.clientX, event.clientY);
      const next = !interactive;
      if (next !== ignoringMouse) { ignoringMouse = next; void desktop!.setClickThrough(next); }
    }
  });
  canvas.addEventListener('click', () => { changeState('waving'); transientUntil = performance.now() + 2000; });
  try {
    const saved = await getSavedModel();
    if (saved) await load(saved, false);
    else await demo(false);
  } catch { await demo(false); }
  desktop?.onModelChanged(async () => {
    try { const saved = await getSavedModel(); if (saved) await load(saved, false); }
    catch { status('同步角色失败，请重新打开工坊。', true); }
  });
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
  $('#import-button').onclick = () => $<HTMLInputElement>('#model-file').click();
  $<HTMLInputElement>('#model-file').onchange = (event) => {
    const input = event.target as HTMLInputElement;
    void importFile(input.files?.[0]); input.value = '';
  };
  $('#load-demo').onclick = () => void demo(true);
  $('#wave-button').onclick = () => { changeState('waving'); transientUntil = performance.now() + 2000; };
  $('#pause-button').onclick = () => { paused = !paused; $('#pause-button').textContent = paused ? '继续动画' : '暂停动画'; };
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.onclick = () => { transientUntil = 0; changeState(button.dataset.state as AnimationState); });
  $('#open-pet').onclick = () => desktop ? void desktop.openPet() : status('桌面模式需要 Electron。请使用 npm run dev 或 npm start 启动。');
  $('#export-button').onclick = () => void runExport();
  $('#cancel-export').onclick = () => exportAbort?.abort();
  $('#close-export').onclick = () => $<HTMLDialogElement>('#export-dialog').close();
  $('#save-atlas').onclick = async () => {
    if (!exportResult) return;
    try {
      if (desktop) {
        const path = await desktop.saveAtlas(new Uint8Array(await exportResult.blob.arrayBuffer()), exportResult.profile);
        if (path) status(`图集已保存到 ${path}`);
      } else download(exportResult.blob, `OiGptPet-${exportResult.profile}.png`);
    } catch { status('保存失败，请重试。', true); }
  };
  window.addEventListener('dragover', (event) => { event.preventDefault(); $('#drop-zone').classList.add('dragover'); });
  window.addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragover'));
  window.addEventListener('drop', (event) => { event.preventDefault(); $('#drop-zone').classList.remove('dragover'); void importFile(event.dataTransfer?.files[0]); });
}

window.addEventListener('beforeunload', () => { exportAbort?.abort(); stage?.dispose(); if (exportUrl) URL.revokeObjectURL(exportUrl); });
void bootstrap();
