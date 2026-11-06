import './style.css';
import { CompanionStage, type CompanionInput, type PreparedCompanion } from './companion-stage';
import { createCharacterLibrary, type CharacterAsset, type CharacterSummary } from '../packages/character-library';
import { MAX_MODEL_BYTES, type ModelInfo } from '../packages/character-core/vrm-file';
import { ANIMATION_ROWS, type AnimationState, type AtlasProfile } from '../packages/target-chatgpt/contract';
import { exportAtlas, type ExternalMotionExport } from '../packages/pet-exporter';
import { ExportSession, type PreviewController } from './export-session';
import { getSavedModel } from './model-store';
import { DEFAULT_PREFERENCES, IDLE_AFTER_MS, PERFORMANCE_POLICIES, normalizePreferences, readPreferences, savePreferences, type DesktopPreferences } from './desktop-preferences';
import { FramePacer } from './frame-pacer';
import { pointerLook } from './pointer-look';
import { setupChat } from './chat-panel';
import { ChatSpeech } from './chat-speech';
import { PetChatPresentation } from './pet-chat-presentation';
import { estimateSpeechMouthOpen } from './speech-mouth';
import { sha256Hex } from '../packages/atlas-preview/sha256';
import { characterPackageModule, MAX_CHARACTER_BACKUP_BYTES } from './character-package-client';
import { motionCapabilityRows } from './motion-capabilities-view';
import { RenderMonitor, renderSampleText, type RenderContext } from './render-monitor';
import type { VrmMotionClipInfo } from '../packages/renderer-vrm';

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
    <form id="pet-chat-composer" data-interactive hidden>
      <label class="sr-only" for="pet-chat-input">和桌宠聊天</label>
      <textarea id="pet-chat-input" maxlength="2000" rows="2" placeholder="输入想说的话…（Enter 发送，Shift+Enter 换行）"></textarea>
      <div><button id="pet-chat-close" type="button">收起</button><button id="pet-chat-send" class="pet-chat-send" type="submit">发送</button></div>
    </form>
    <div id="pet-controls" data-interactive>
      <button id="workshop-button" title="角色工坊">工坊</button>
      <button id="pet-chat-toggle" title="直接输入文字聊天" aria-expanded="false">聊聊</button>
      <button id="pet-chat-cancel" title="停止当前回复" hidden>停止</button>
      <button id="pet-voice-input" title="语音识别由系统服务提供，联网与处理方式由服务决定；检查转写后手动发送" aria-pressed="false">听写</button>
      <button id="pet-voice-send" title="把转写文字发送给伙伴" hidden>发送</button>
      <button id="pet-wave" title="挥手">挥手</button>
      <button id="pet-read-aloud" title="朗读最新完整回复" hidden>朗读</button>
      <button id="click-through" title="Ctrl+Alt+P 或托盘恢复互动">穿透</button>
      <button id="hide-pet" title="从托盘重新显示">隐藏</button>
    </div>
  </main>` : `
  <aside class="rail">
    <a class="brand" href="#" aria-label="OiGptPet 首页">oi<span>·</span></a>
    <div class="rail-mark selected" title="角色工坊">${icon.box}</div>
    <div class="rail-line"></div>
    <span class="rail-bottom">${__APP_VERSION__}</span>
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
        <div class="motion-panel"><div class="motion-heading"><h2>今天是什么心情？</h2><button id="pause-button" class="text-button">暂停动画</button></div><div class="motion-list">${ANIMATION_ROWS.map((row, i) => `<button class="motion-button ${i === 0 ? 'active' : ''}" data-state="${row.state}"><span class="motion-index">${String(i + 1).padStart(2, '0')}</span>${row.label}</button>`).join('')}</div>
          <section id="external-motion-panel" class="external-motion-panel" hidden aria-label="外部动作预览">
            <div class="external-motion-actions"><button id="external-motion-import" class="text-button" type="button">导入 VRM Animation（.vrma）</button><input id="external-motion-file" type="file" accept=".vrma,model/gltf-binary" hidden /></div>
            <div id="external-motion-controls" class="external-motion-actions" hidden><select id="external-motion-clip" aria-label="选择导入动作"></select><select id="external-motion-speed" aria-label="动作播放速度"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><select id="external-motion-loop" aria-label="动作循环模式"><option value="repeat" selected>循环</option><option value="once">播放一次</option><option value="pingpong">往返</option></select><button id="external-motion-toggle" class="text-button" type="button">暂停动作</button><button id="external-motion-clear" class="text-button" type="button">恢复内置动作</button></div>
            <div id="external-motion-scrubber" class="external-motion-scrubber" hidden><label for="external-motion-time">预览时间</label><input id="external-motion-time" type="range" min="0" max="1000" value="0" aria-label="拖动查看动作时间点" /><output id="external-motion-time-label">0.0 / 0.0 秒</output><label class="external-motion-exact-label" for="external-motion-exact-time">精确时间</label><input id="external-motion-exact-time" type="number" min="0" step="0.01" value="0" aria-label="输入精确动作时间（秒）" /><span>秒</span></div>
            <div id="external-motion-export" hidden><label class="field-label" for="external-motion-export-state">选择目标动作行</label><div class="external-motion-actions"><select id="external-motion-export-state"><option value="">选择要替换的动作行</option>${ANIMATION_ROWS.map(row => `<option value="${row.state}">${row.label}</option>`).join('')}</select><button id="external-motion-assign" class="text-button" type="button">添加 / 更新此行</button></div><div id="external-motion-assignments" class="external-motion-assignment-list" hidden aria-label="待导出的 VRMA 动作行"></div><p class="helper">可将同一文件中的不同片段分配给多行动作；未加入清单的行保留内置动作。保存前请检查动作语义、循环和裁切。</p></div>
            <div id="external-motion-sample-preview" class="external-motion-sample-preview" hidden><label class="field-label" for="external-motion-sample-frame">预览目标行的导出采样帧</label><div class="external-motion-actions"><select id="external-motion-sample-frame" aria-label="选择导出采样帧"></select><button id="external-motion-sample-jump" class="text-button" type="button">定位此帧</button></div><p id="external-motion-sample-description" class="helper"></p></div>
            <p id="external-motion-status" class="helper" role="status" aria-live="polite"></p>
            <p class="helper">动作仅暂存在工坊。可将不同片段分配给多行动作行；不会修改角色库或备份包。</p>
            <p class="helper">导入结果会对照当前角色检查动作轨道名称；匹配不代表动作绑定或视觉效果合格。</p>
          </section>
        </div>
        <p class="status-line" id="status" role="status" aria-live="polite">正在准备角色工坊…</p>
      </section>
      <aside class="detail-column" tabindex="0" aria-label="角色和陪伴设置">
        <section class="detail-section"><div class="section-heading"><div><span class="section-number">02</span><h2>你的角色</h2></div><span class="tag">VRM</span></div>
          <button class="character-card" id="load-demo" ${__WITH_DEMO__ ? '' : 'hidden'}><div class="avatar-monogram">S<span>✦</span></div><div><strong>官方示例角色</strong><span>pixiv · VRM 1.0</span></div><span class="card-arrow">↗</span></button>
          <button class="import-zone" id="import-button" disabled>${icon.plus}<strong>导入我的角色</strong><span>VRM 1.0 ≤64 MiB · PNG / WebP ≤20 MiB</span></button>
          <input type="file" id="model-file" accept=".vrm,.png,.webp,image/png,image/webp" hidden />
          <label class="field-label" for="sprite-profile">导入精灵图规格</label>
          <select id="sprite-profile"><option value="v2">v2 · 含 16 方向视线</option><option value="v1">v1 · 仅动作</option></select>
          <button class="text-button" id="cancel-load" hidden>取消加载</button>
          <div id="character-list" class="character-list" aria-label="本地角色库"></div>
          <div id="character-editor" hidden><label class="field-label" for="character-alias">当前角色名称</label><input id="character-alias" maxlength="80" /><button class="text-button" id="rename-character">保存名称</button></div>
          <div class="backup-actions"><button class="button" id="backup-character" disabled>备份当前角色</button><button class="button" id="restore-character" disabled>恢复角色备份</button><button class="text-button" id="cancel-package" hidden>取消</button></div>
          <input type="file" id="package-file" accept=".oipet" hidden />
          <p class="helper" id="package-status" role="status" aria-live="polite"></p>
          <p class="helper">备份文件包含一个角色的原始文件、名称和规格，可在其他本地应用目录恢复。</p>
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
          <p class="helper" id="render-performance">本窗口：正在准备采样…</p>
          <p class="helper">每两秒更新绘制调用采样；不等同于屏幕呈现帧率或 GPU 耗时。桌面诊断分别记录工坊和桌宠。</p>
          <button class="text-button" id="save-diagnostics" ${desktop ? '' : 'hidden'}>保存桌面诊断</button>
          <p class="helper" ${desktop ? '' : 'hidden'}>记录显示器、窗口位置和性能，方便排查问题；不包含角色文件和名称。</p>
          <p class="helper" id="settings-status" role="status" aria-live="polite"></p>
        </section>
        <section class="detail-section chat-panel" ${desktop ? '' : 'hidden'}>
          <h2>和伙伴聊聊</h2>
          <details><summary>对话设置</summary>
            <ol class="helper"><li>填写账户可用的模型 ID 和 API Key。</li><li>保存设置，再检查本地配置。</li><li>在下方发送一条消息验证网络和模型权限（可能计费）。</li></ol>
            <label class="field-label" for="chat-model">OpenAI 模型 ID</label><input id="chat-model" maxlength="120" placeholder="输入账户可用的模型 ID" />
            <label class="field-label" for="chat-key">API Key</label><input id="chat-key" type="password" maxlength="512" autocomplete="off" />
            <button id="chat-save" class="text-button" type="button">保存设置</button> <button id="chat-forget" class="text-button" type="button">移除密钥</button>
            <button id="chat-check" class="text-button" type="button">检查本地配置</button>
            <p class="helper" id="chat-check-status" role="status" aria-live="polite"></p>
            <p class="helper">保存和本地检查不会联网。保存设置会清空本次对话，本地检查保留对话。更换电脑或系统账户后，如无法解密密钥，请重新保存。</p>
            <p class="helper">密钥由系统加密后保存在本机。点击发送会将本次消息及最近四轮对话发送给 OpenAI API，费用由该 API 账户承担。</p>
          </details>
          <div id="chat-log" role="log" aria-label="本次对话"></div>
          <button id="chat-read-aloud" class="text-button" type="button" disabled>朗读最新回复</button>
          <p class="helper">手动使用系统语音朗读最新一条完整回复；不会自动播报。</p>
          <form id="chat-form"><label class="field-label" for="chat-input">想说的话</label><textarea id="chat-input" maxlength="2000" rows="3"></textarea>
            <p class="helper">Ctrl / ⌘ + Enter 发送，Enter 换行。</p>
            <button id="chat-voice-input" class="text-button" type="button" aria-pressed="false">语音输入</button>
            <span id="chat-voice-status" class="helper voice-note" role="status" aria-live="polite"></span><br />
            <button id="chat-send" class="button" type="submit">发送</button><button id="chat-cancel" class="text-button" type="button" hidden>取消请求</button><button id="chat-retry" class="text-button" type="button" hidden>重试上一条</button><button id="chat-clear" class="text-button" type="button">清空对话</button></form>
          <p class="helper" id="chat-status" role="status">请先配置对话设置。</p>
          <p class="helper">本次对话保留到应用退出。关闭工坊会取消未完成请求；未发送草稿不保留。</p>
        </section>
          <section id="model-capabilities" class="detail-section" hidden><h2>动作适配检查</h2>
            <details class="model-details"><summary id="motion-summary"></summary><div id="motion-capability-rows"></div></details>
            <p class="helper">根据实际加载结果检查当前动作所用能力。动作是否自然、头发遮挡和裁切仍需播放确认；检查结果会附在导出报告中。</p>
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
interface PackageJob { kind: 'backup' | 'restore'; id: string; controller: AbortController; nativeStarted: boolean }
let packageJob: PackageJob | null = null;
let closed = false;
let loadController: AbortController | null = null;
let committing = false;
let syncRequested = false;
let source: ArrayBuffer | null = null;
let state: AnimationState = 'idle';
let stateRevision = 0;
let info: ModelInfo | null = null;
let loading = false;
let paused = false;
let animationTime = 0;
let externalMotionClips: VrmMotionClipInfo[] = [];
let externalMotionBuffer: ArrayBuffer | undefined;
let externalMotionAssignments: Array<{ state: AnimationState; clipIndex: number }> = [];
let externalMotionImportRevision = 0;
let lastExternalMotionUiUpdate = 0;
let lastInteraction = performance.now();
let preferences: DesktopPreferences = { ...DEFAULT_PREFERENCES };
const framePacer = new FramePacer();
const renderMonitor = new RenderMonitor();
let renderReportPending = false;
let nativeVisible = true;
function renderContext(now: number): RenderContext {
  const activity = document.hidden || !nativeVisible ? 'hidden' : now - lastInteraction >= IDLE_AFTER_MS ? 'idle' : 'active';
  const policy = PERFORMANCE_POLICIES[preferences.performance];
  return { kind: stage?.loaded ? stage.sourceKind : 'empty', mode: preferences.performance, activity,
    targetFps: activity === 'hidden' ? 0 : activity === 'idle' ? policy.idleFps : policy.activeFps, paused };
}
function publishRenderMetrics() {
  if (closed) return;
  const now = performance.now(); renderMonitor.setContext(renderContext(now), now);
  const sample = renderMonitor.sample(now); if (!sample) return;
  if (!petMode) {
    const output = $('#render-performance'); output.textContent = renderSampleText(sample);
    output.dataset.kind = sample.kind; output.dataset.activity = sample.activity;
    output.dataset.targetFps = String(sample.targetFps); output.dataset.fps = sample.fps === null ? '' : String(sample.fps);
  }
  if (desktop && !renderReportPending) {
    renderReportPending = true;
    void desktop.reportRenderSample(sample).catch(() => {}).finally(() => { renderReportPending = false; });
  }
}
let renderReportTimer: number | undefined;
function scheduleRenderReports() {
  clearInterval(renderReportTimer);
  renderReportTimer = !document.hidden && nativeVisible && !closed ? window.setInterval(publishRenderMetrics, 2000) : undefined;
}
scheduleRenderReports();
let resizeStage = () => {};
let transientUntil = 0;
const petChat = new PetChatPresentation();
let petSpeechText = '';
const petSpeechButton = petMode ? $<HTMLButtonElement>('#pet-read-aloud') : undefined;
const speechRuntime = typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined'
  ? undefined : window.speechSynthesis;
const petSpeech = petMode ? new ChatSpeech(speechRuntime, undefined, speaking => {
  if (petSpeechButton) {
    petSpeechButton.textContent = speaking ? '停止朗读' : '朗读';
    petSpeechButton.title = '朗读最新完整回复';
  }
}, event => {
  stage?.setSpeechMouthOpen(estimateSpeechMouthOpen(petSpeechText, event.charIndex, event.charLength));
  lastInteraction = performance.now();
}) : undefined;
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
  publishRenderMetrics();
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
function restorePetChat() {
  const view = petChat.current(performance.now());
  status(view?.text ?? '');
  if (petMode) {
    if (!petChat.canReadAloud()) petSpeech?.stop();
    if (petSpeechButton) {
      petSpeechButton.hidden = !petChat.canReadAloud();
      petSpeechButton.disabled = !petSpeech?.available;
      petSpeechButton.textContent = petSpeech?.speaking ? '停止朗读' : '朗读';
      petSpeechButton.title = petSpeech?.available ? '朗读最新完整回复' : '当前系统语音不可用';
    }
  }
  if (view) {
    transientUntil = view.until;
    if (state !== view.animation) changeState(view.animation);
  }
}
function packageStatus(message: string, error = false) {
  if (petMode || closed) return;
  $('#package-status').textContent = message;
  $('#package-status').classList.toggle('error', error);
}
function updatePackageControls() {
  if (petMode || closed) return;
  const busy = loading || Boolean(packageJob);
  document.body.dataset.packageBusy = packageJob?.kind ?? '';
  $<HTMLButtonElement>('#backup-character').disabled = busy || !currentCharacter;
  $<HTMLButtonElement>('#restore-character').disabled = busy || !stage;
  $<HTMLButtonElement>('#import-button').disabled = busy || !stage;
  $<HTMLButtonElement>('#load-demo').disabled = busy;
  $<HTMLButtonElement>('#rename-character').disabled = busy;
  $<HTMLButtonElement>('#export-button').disabled = busy || !source;
  $('#cancel-package').hidden = !packageJob;
  $<HTMLButtonElement>('#cancel-package').disabled = committing;
  if (busy) document.querySelectorAll<HTMLButtonElement>('#character-list button').forEach((button) => { button.disabled = true; });
}
function packageId() {
  // randomUUID is absent on non-secure LAN HTTP; getRandomValues remains available.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
}
function checkPackageJob(job: PackageJob) {
  if (closed || packageJob !== job || job.controller.signal.aborted) throw new DOMException('备份操作已取消。', 'AbortError');
}
async function cancelPackage() {
  const job = packageJob;
  if (!job || committing) return;
  if (job.nativeStarted && desktop) {
    try {
      const accepted = await desktop.cancelCharacterPackage(job.id);
      if (packageJob !== job || closed) return;
      if (!accepted) { packageStatus('正在完成保存，请稍候。'); return; }
    } catch { packageStatus('取消请求失败，请在保存窗口取消。', true); return; }
  }
  job.controller.abort();
  packageStatus('已请求取消，正在结束当前操作。');
}
function finishPackage(job: PackageJob) {
  if (packageJob !== job) return;
  packageJob = null; updatePackageControls();
  if (!closed) {
    void refreshLibrary().catch(() => packageStatus('角色库刷新失败，请重试。', true));
    if (syncRequested) { syncRequested = false; void syncLibrary(); }
  }
}
async function backupCharacter() {
  if (!currentCharacter || loading || packageJob) return;
  clearExport();
  const selected = { id: currentCharacter.id, name: currentCharacter.name };
  const job: PackageJob = { kind: 'backup', id: packageId(), controller: new AbortController(), nativeStarted: false };
  packageJob = job; updatePackageControls(); packageStatus('正在准备角色备份…');
  try {
    const asset = await library.getActive(); checkPackageJob(job);
    if (!asset || asset.summary.id !== selected.id || asset.summary.name !== selected.name) throw new Error('当前角色已变化，请重新备份。');
    const codec = await characterPackageModule(); checkPackageJob(job);
    const result = await codec.encodeCharacterPackage(asset, job.controller.signal); checkPackageJob(job);
    if (desktop) {
      const bytes = new Uint8Array(await result.blob.arrayBuffer()); checkPackageJob(job);
      job.nativeStarted = true;
      const path = await desktop.saveCharacterPackage(bytes, result.sha256, job.id);
      if (closed || packageJob !== job) return;
      // Native rename may already have committed; a successful path is authoritative.
      packageStatus(path ? `“${selected.name}”已备份到 ${path}` : '备份已取消。');
    } else {
      checkPackageJob(job); download(result.blob, 'OiGptPet-character.oipet');
      packageStatus(`“${selected.name}”备份已交给浏览器下载。`);
    }
  } catch (error) {
    if (!closed && packageJob === job) packageStatus(job.controller.signal.aborted ? '备份已取消。' : error instanceof Error ? error.message : '备份失败，请重试。', !job.controller.signal.aborted);
  } finally { finishPackage(job); }
}
async function restoreCharacter(file?: File) {
  if (!file || !stage || loading || packageJob) return;
  if (file.size > MAX_CHARACTER_BACKUP_BYTES) { packageStatus('角色备份超过大小上限。', true); return; }
  clearExport();
  const job: PackageJob = { kind: 'restore', id: packageId(), controller: new AbortController(), nativeStarted: false };
  packageJob = job; updatePackageControls(); packageStatus('正在检查角色备份…');
  try {
    const codec = await characterPackageModule(); checkPackageJob(job);
    const decoded = await codec.decodeCharacterPackage(file, job.controller.signal); checkPackageJob(job);
    const restored = await load(decoded.input, true, 'local-import', undefined, { name: decoded.input.name, signal: job.controller.signal });
    checkPackageJob(job);
    packageStatus(restored ? '角色备份已恢复。重复角色沿用库内已有名称。' : '恢复未完成，原角色保持不变。', !restored);
  } catch (error) {
    if (!closed && packageJob === job) packageStatus(job.controller.signal.aborted ? '恢复已取消，原角色保持不变。' : `${error instanceof Error ? error.message : '恢复失败。'} 原角色保持不变。`, !job.controller.signal.aborted);
  } finally { finishPackage(job); }
}
function showInfo(value: ModelInfo) {
  if (petMode) return;
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
  const capabilities = value.motionCapabilities;
  $('#model-capabilities').hidden = !capabilities;
  const host = $('#motion-capability-rows'); host.replaceChildren();
  if (capabilities) {
    const rows = motionCapabilityRows(capabilities);
    const warnings = rows.filter(row => row.warning).length;
    $('#motion-summary').textContent = warnings ? `${warnings} 项能力缺失或受限，展开查看` : '所检查的能力已加载，展开查看';
    $<HTMLDetailsElement>('#model-capabilities details').open = warnings > 0;
    for (const row of rows) {
      const p = document.createElement('p'); p.dataset.warning = String(row.warning);
      p.textContent = `${row.label}：${row.text}`; host.append(p);
    }
  }
}
function showCharacter(summary: CharacterSummary | null, value: ModelInfo | null, input: CompanionInput) {
  document.body.dataset.characterKind = input.kind;
  document.body.dataset.characterId = summary?.id ?? '';
  if (value) showInfo(value);
  if (petMode) { restorePetChat(); return; }
  $('#external-motion-panel').hidden = input.kind !== 'vrm';
  $('#stage-empty').hidden = true;
  $('#format-badge').textContent = input.kind === 'vrm' ? 'VRM 1.0' : `SPRITE ${input.profile}`;
  $('#character-name').textContent = summary?.name ?? value?.name ?? '本地精灵图';
  if (!value) {
    $('#model-capabilities').hidden = true; $('#motion-capability-rows').replaceChildren(); $('#motion-summary').textContent = '';
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
    select.disabled = loading || Boolean(packageJob) || item.id === currentCharacter?.id;
    select.onclick = () => void selectCharacter(item.id);
    const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = '移除'; remove.dataset.removeCharacter = item.id;
    remove.disabled = loading || Boolean(packageJob) || item.id === currentCharacter?.id;
    remove.onclick = () => void removeCharacter(item.id);
    row.append(select, remove); host.append(row);
  }
}

function notifyLibrary() { libraryChannel.postMessage('changed'); }

async function load(input: CompanionInput, persist: boolean, origin: 'local-import' | 'official-demo' = 'local-import', existing?: CharacterSummary, options?: { name?: string; signal?: AbortSignal }) {
  if (loading || closed || (packageJob && (packageJob.kind !== 'restore' || options?.signal !== packageJob.controller.signal))) return false;
  clearExport();
  loading = true;
  const controller = new AbortController(); loadController = controller;
  const relayAbort = () => { if (!committing) controller.abort(); };
  options?.signal?.addEventListener('abort', relayAbort, { once: true });
  if (options?.signal?.aborted) controller.abort();
  updatePackageControls();
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
    if (controller.signal.aborted) throw new DOMException('角色切换已取消。', 'AbortError');
    const beginCommit = () => {
      committing = true; updatePackageControls();
      if (!petMode) $<HTMLButtonElement>('#cancel-load').disabled = true;
    };
    if (persist && !summary) {
      summary = await library.addAndActivate({ ...input, ...(options?.name === undefined ? {} : { name: options.name }) }, controller.signal, beginCommit);
    } else {
      beginCommit();
      if (persist && summary) await library.activate(summary.id);
    }
    prepared.commit();
    resetExternalMotionPreview();
    currentCharacter = summary;
    info = prepared.info; source = nextSource; modelSource = origin;
    animationTime = 0; changeState('idle'); framePacer.reset(); resizeStage();
    renderMonitor.reset(performance.now()); publishRenderMetrics();
    showCharacter(summary, info, input);
    if (persist) notifyLibrary();
    if (!petMode) status('角色已就绪 · 点击动作试试看。');
    return true;
  } catch (error) {
    status(controller.signal.aborted ? '加载已取消，保留原角色。' : `${error instanceof Error ? error.message : '角色加载失败。'}${stage.loaded ? ' 已保留原角色。' : ''}`, true);
    return false;
  } finally {
    options?.signal?.removeEventListener('abort', relayAbort);
    prepared?.dispose(); loading = false; committing = false; loadController = null;
    if (!petMode) {
      $<HTMLButtonElement>('#export-button').disabled = !source;
      $('#cancel-load').hidden = true;
      $<HTMLButtonElement>('#import-button').disabled = false;
      $<HTMLButtonElement>('#external-motion-import').disabled = false;
    }
    updatePackageControls();
    try { await refreshLibrary(); } catch { status('角色库读取失败，请重试。', true); }
    if (syncRequested && !packageJob) { syncRequested = false; void syncLibrary(); }
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
  if (loading || packageJob) return;
  try {
    const asset = await library.get(id);
    if (!asset) throw new Error('角色不存在，请刷新角色库。');
    await load(assetInput(asset), true, 'local-import', asset.summary);
  } catch (error) { status(error instanceof Error ? error.message : '切换失败，保留原角色。', true); }
}

async function removeCharacter(id: string) {
  if (loading || packageJob) return;
  try { await library.remove(id); await refreshLibrary(); notifyLibrary(); status('已移除库内副本，原文件未删除。'); }
  catch (error) { status(error instanceof Error ? error.message : '移除失败。', true); }
}

async function syncLibrary() {
  if (loading || packageJob) { syncRequested = true; if (packageJob) void cancelPackage(); return; }
  try {
    const active = await library.getActive();
    if (loading || packageJob) { syncRequested = true; if (packageJob) void cancelPackage(); return; }
    if (active && active.summary.id !== currentCharacter?.id) await load(assetInput(active), false, 'local-import', active.summary);
    else if (active) { currentCharacter = active.summary; showCharacter(currentCharacter, info, assetInput(active)); }
    await refreshLibrary();
  } catch (error) { status(`角色同步失败，保留当前画面：${error instanceof Error ? error.message : '请重试。'}`, true); }
}

async function demo(persist: boolean) {
  if (loading || packageJob) return;
  try {
    const response = await fetch(new URL('models/demo.vrm', document.baseURI));
    if (!response.ok) throw new Error('示例暂不可用。请导入本机的 VRM 1.0 角色。');
    await load({ kind: 'vrm', blob: await response.blob() }, persist, 'official-demo');
  } catch (error) { status(error instanceof Error ? error.message : '示例加载失败。', true); }
}

function changeState(next: AnimationState) {
  state = next; stateRevision += 1; animationTime = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.classList.toggle('active', button.dataset.state === next));
}

function resetExternalMotionPreview(message = '') {
  externalMotionImportRevision += 1;
  externalMotionClips = [];
  externalMotionBuffer = undefined;
  externalMotionAssignments = [];
  stage?.clearMotion();
  const controls = document.querySelector<HTMLElement>('#external-motion-controls');
  if (controls) controls.hidden = true;
  const exportControls = document.querySelector<HTMLElement>('#external-motion-export');
  if (exportControls) exportControls.hidden = true;
  const samplePreview = document.querySelector<HTMLElement>('#external-motion-sample-preview');
  if (samplePreview) samplePreview.hidden = true;
  const sampleFrame = document.querySelector<HTMLSelectElement>('#external-motion-sample-frame');
  if (sampleFrame) { sampleFrame.replaceChildren(); delete sampleFrame.dataset.sampleKey; }
  const exportState = document.querySelector<HTMLSelectElement>('#external-motion-export-state');
  if (exportState) exportState.value = '';
  renderExternalMotionAssignments();
  const scrubber = document.querySelector<HTMLElement>('#external-motion-scrubber');
  if (scrubber) scrubber.hidden = true;
  const timeInput = document.querySelector<HTMLInputElement>('#external-motion-time');
  if (timeInput) timeInput.value = '0';
  const exactTimeInput = document.querySelector<HTMLInputElement>('#external-motion-exact-time');
  if (exactTimeInput) { exactTimeInput.value = '0'; exactTimeInput.max = '0'; }
  const timeLabel = document.querySelector<HTMLOutputElement>('#external-motion-time-label');
  if (timeLabel) timeLabel.textContent = '0.0 / 0.0 秒';
  const file = document.querySelector<HTMLInputElement>('#external-motion-file');
  if (file) file.value = '';
  const importButton = document.querySelector<HTMLButtonElement>('#external-motion-import');
  if (importButton) importButton.disabled = loading || Boolean(packageJob);
  const select = document.querySelector<HTMLSelectElement>('#external-motion-clip');
  if (select) select.replaceChildren();
  const toggle = document.querySelector<HTMLButtonElement>('#external-motion-toggle');
  if (toggle) { toggle.textContent = '暂停动作'; toggle.disabled = true; }
  const speed = document.querySelector<HTMLSelectElement>('#external-motion-speed');
  if (speed) speed.value = '1';
  const loop = document.querySelector<HTMLSelectElement>('#external-motion-loop');
  if (loop) loop.value = 'repeat';
  const statusLine = document.querySelector<HTMLElement>('#external-motion-status');
  if (statusLine) statusLine.textContent = message;
}

function renderExternalMotionAssignments() {
  const host = document.querySelector<HTMLElement>('#external-motion-assignments');
  if (!host) return;
  host.replaceChildren();
  const ordered = ANIMATION_ROWS.flatMap(row => {
    const assignment = externalMotionAssignments.find(item => item.state === row.state);
    return assignment ? [{ row, assignment }] : [];
  });
  for (const { row, assignment } of ordered) {
    const clip = externalMotionClips.find(item => item.index === assignment.clipIndex);
    if (!clip) continue;
    const item = document.createElement('div');
    item.className = 'external-motion-assignment';
    const description = document.createElement('span');
    description.textContent = `${row.label} ← ${clip.name} · ${clip.duration.toFixed(1)} 秒`;
    const remove = document.createElement('button');
    remove.className = 'text-button';
    remove.type = 'button';
    remove.dataset.removeMotionState = row.state;
    remove.setAttribute('aria-label', `移除${row.label}动作替换`);
    remove.textContent = '移除';
    item.append(description, remove);
    host.append(item);
  }
  host.hidden = host.childElementCount === 0;
}

function describeExternalMotionCompatibility(clip: VrmMotionClipInfo) {
  const report = clip.compatibility;
  const mappedBones = report.totalBones - report.missingBones.length;
  const mappedExpressions = report.totalExpressions - report.missingExpressions.length;
  const lookAt = report.lookAt === 'unused' ? '未使用视线轨道' : report.lookAt === 'available' ? '视线轨道可映射' : '缺少视线控制器';
  const missing: string[] = [];
  const summarize = (label: string, names: string[]) => {
    if (names.length) missing.push(`${label}：${names.slice(0, 5).join('、')}${names.length > 5 ? ` 等 ${names.length} 项` : ''}`);
  };
  summarize('骨骼', report.missingBones);
  summarize('表情', report.missingExpressions);
  if (report.lookAt === 'missing') missing.push('视线控制器');
  return `${clip.name} · ${clip.duration.toFixed(1)} 秒；骨骼匹配 ${mappedBones}/${report.totalBones}，表情匹配 ${mappedExpressions}/${report.totalExpressions}，${lookAt}。${missing.length ? `可能不会播放的轨道：${missing.join('；')}。` : ''}此检查只看名称映射，不评价动作视觉质量。`;
}

function updateExternalMotionTime() {
  const index = Number($<HTMLSelectElement>('#external-motion-clip').value);
  const clip = externalMotionClips.find(item => item.index === index);
  const time = stage?.motionTime(index) ?? 0;
  const slider = $<HTMLInputElement>('#external-motion-time');
  const value = clip && clip.duration > 0 ? Math.min(1000, Math.round(time / clip.duration * 1000)) : 0;
  if (slider.value !== String(value)) slider.value = String(value);
  const exactTime = $<HTMLInputElement>('#external-motion-exact-time');
  exactTime.max = String(clip?.duration ?? 0);
  if (document.activeElement !== exactTime) exactTime.value = time.toFixed(2);
  $('#external-motion-time-label').textContent = `${time.toFixed(1)} / ${(clip?.duration ?? 0).toFixed(1)} 秒`;
  $<HTMLButtonElement>('#external-motion-toggle').textContent = stage?.motionIsPlaying() ? '暂停动作' : '继续动作';
}

function updateExternalMotionSamplePreview() {
  const panel = $<HTMLElement>('#external-motion-sample-preview');
  const state = $<HTMLSelectElement>('#external-motion-export-state').value as AnimationState | '';
  const row = ANIMATION_ROWS.find(item => item.state === state);
  const clipIndex = Number($<HTMLSelectElement>('#external-motion-clip').value);
  const clip = externalMotionClips.find(item => item.index === clipIndex);
  if (!row || !clip || clip.duration <= 0) { panel.hidden = true; return; }
  panel.hidden = false;
  const select = $<HTMLSelectElement>('#external-motion-sample-frame');
  const previous = Number(select.value);
  const sampleKey = `${clip.index}:${row.state}:${clip.duration}`;
  if (select.dataset.sampleKey !== sampleKey || select.options.length !== row.frames) {
    const selectedBefore = Number.isInteger(previous) ? Math.max(0, Math.min(row.frames - 1, previous)) : 0;
    select.replaceChildren(...Array.from({ length: row.frames }, (_, frameIndex) => {
      const option = document.createElement('option');
      option.value = String(frameIndex);
      option.textContent = `第 ${frameIndex + 1} / ${row.frames} 帧 · ${(clip.duration * frameIndex / row.frames).toFixed(2)} 秒`;
      return option;
    }));
    select.dataset.sampleKey = sampleKey;
    select.value = String(selectedBefore);
  }
  const selectedValue = Number(select.value);
  const selected = Number.isInteger(selectedValue) ? Math.max(0, Math.min(row.frames - 1, selectedValue)) : 0;
  select.value = String(selected);
  const seconds = clip.duration * selected / row.frames;
  $('#external-motion-sample-description').textContent = `导出器以 ${row.frames} 帧均匀采样，所选帧对应 ${seconds.toFixed(3)} 秒。此处只对齐采样时间；正式导出会重新渲染并稳定化物理效果。`;
}

async function importExternalMotion(file?: File) {
  if (!file || !stage || loading || packageJob || petMode) return;
  if (!file.name.toLowerCase().endsWith('.vrma')) { $('#external-motion-status').textContent = '请选择 .vrma 动作文件。'; return; }
  if (file.size === 0 || file.size > MAX_MODEL_BYTES) { $('#external-motion-status').textContent = '动作文件不能为空且不能超过 64 MiB。'; return; }
  const importRevision = ++externalMotionImportRevision;
  const targetStage = stage;
  const button = $<HTMLButtonElement>('#external-motion-import');
  button.disabled = true;
  $('#external-motion-status').textContent = '正在本机读取并检查动作…';
  try {
    const buffer = await file.arrayBuffer();
    if (importRevision !== externalMotionImportRevision || targetStage !== stage || loading || packageJob) return;
    const clips = await targetStage.loadMotion(buffer);
    if (importRevision !== externalMotionImportRevision || targetStage !== stage || loading || packageJob) return;
    externalMotionClips = clips;
    externalMotionBuffer = buffer;
    externalMotionAssignments = [];
    renderExternalMotionAssignments();
    $<HTMLSelectElement>('#external-motion-export-state').value = '';
    const select = $<HTMLSelectElement>('#external-motion-clip');
    select.replaceChildren(...clips.map(clip => {
      const option = document.createElement('option'); option.value = String(clip.index);
      option.textContent = `${clip.name} · ${clip.duration.toFixed(1)} 秒`; return option;
    }));
    $('#external-motion-controls').hidden = false;
    $('#external-motion-scrubber').hidden = false;
    $('#external-motion-export').hidden = false;
    $<HTMLSelectElement>('#external-motion-speed').value = '1';
    $<HTMLSelectElement>('#external-motion-loop').value = 'repeat';
    $<HTMLButtonElement>('#external-motion-toggle').disabled = false;
    updateExternalMotionTime();
    updateExternalMotionSamplePreview();
    $('#external-motion-status').textContent = `${file.name} · ${clips.length} 段动作，正在预览第 1 段。${describeExternalMotionCompatibility(clips[0])}`;
  } catch (error) {
    if (importRevision === externalMotionImportRevision) $('#external-motion-status').textContent = error instanceof Error ? error.message : '动作加载失败。';
  } finally { if (importRevision === externalMotionImportRevision) button.disabled = false; }
}

async function importFile(file?: File) {
  if (!file || !stage || loading || packageJob) return;
  if (file.name.toLowerCase().endsWith('.oipet')) { await restoreCharacter(file); return; }
  if (file.name.toLowerCase().endsWith('.vrma')) {
    if (document.body.dataset.characterKind !== 'vrm') { status('VRMA 动作预览需要先加载 VRM 角色。', true); return; }
    await importExternalMotion(file); return;
  }
  if (file.name.toLowerCase().endsWith('.vrm')) {
    if (file.size > MAX_MODEL_BYTES) { status('模型不能超过 64 MiB。', true); return; }
    await load({ kind: 'vrm', blob: file }, true);
  } else if (/\.(png|webp)$/i.test(file.name)) {
    if (file.size > 20 * 1024 * 1024) { status('精灵图不能超过 20 MiB。', true); return; }
    const type = file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp';
    await load({ kind: 'sprite', blob: file.type ? file : new Blob([file], { type }), profile: $<HTMLSelectElement>('#sprite-profile').value as AtlasProfile }, true);
  } else status('请选择 VRM、PNG、WebP 或 .oipet 备份文件。', true);
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
  $<HTMLButtonElement>('#export-button').disabled = !source || loading || Boolean(packageJob);
  $('#export-progress').hidden = true;
  $('#cancel-export').hidden = true;
  const dialog = $<HTMLDialogElement>('#export-dialog');
  if (closeDialog && dialog.open) dialog.close();
}

const previewModules = import.meta.glob<{ createAtlasPreview(host: HTMLElement): PreviewController }>('../packages/atlas-preview/index.ts');

async function runExport() {
  if (!source || !info || exportSession.busy || loading || packageJob) return;
  const selectedState = $<HTMLSelectElement>('#external-motion-export-state').value as AnimationState | '';
  const selectedClipIndex = Number($<HTMLSelectElement>('#external-motion-clip').value);
  // Keep compatibility with existing automation and older usage: a selected row
  // exports as a one-row replacement until the user starts a multi-row list.
  const assignments: Array<{ state: AnimationState; clipIndex: number }> = externalMotionAssignments.length
    ? externalMotionAssignments.map(item => ({ ...item }))
    : selectedState ? [{ state: selectedState, clipIndex: selectedClipIndex }] : [];
  const assignmentStates = new Set<AnimationState>();
  const resolvedAssignments = assignments.map(assignment => {
    const row = ANIMATION_ROWS.find(item => item.state === assignment.state);
    const clip = externalMotionClips.find(item => item.index === assignment.clipIndex);
    if (!row || assignmentStates.has(assignment.state) || !clip || !externalMotionBuffer) return undefined;
    assignmentStates.add(assignment.state);
    return { ...assignment, row, clip };
  });
  if (resolvedAssignments.some(item => !item)) {
    status('外部动作替换信息不完整，请重新导入动作或检查替换清单。', true);
    return;
  }
  const exportMotionBuffer = assignments.length ? externalMotionBuffer?.slice(0) : undefined;
  const externalMotion: ExternalMotionExport[] = exportMotionBuffer
    ? resolvedAssignments.map(item => ({ buffer: exportMotionBuffer, clipIndex: item!.clipIndex, state: item!.state }))
    : [];
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
    const sourceSha256 = externalMotion.length ? await sha256Hex(exportMotionBuffer!.slice(0)) : undefined;
    const animationOverrides = externalMotion.length
      ? resolvedAssignments.map(item => ({
          state: item!.state,
          label: item!.row.label,
          clipName: item!.clip.name,
          duration: item!.clip.duration,
          sourceSha256: sourceSha256!,
        }))
      : [];
    if (revision !== runRevision) return;
    const record = await exportSession.run(profile, {
      model: currentInfo, source: origin,
      sourceUrl: origin === 'official-demo' ? 'https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models' : undefined,
      ...(animationOverrides.length === 1 ? { externalAnimation: animationOverrides[0] } : {}),
      ...(animationOverrides.length > 1 ? { externalAnimations: animationOverrides } : {}),
    }, async (signal) => {
      const rendered = await exportAtlas(currentSource, profile, (done, total) => {
        if (revision !== runRevision) return;
        progress.max = total; progress.value = done;
        $('#local-check-status').textContent = `渲染 ${done} / ${total}`;
        status(`正在导出 ${done} / ${total} 帧…`);
      }, signal, externalMotion.length ? externalMotion : undefined);
      if (revision === runRevision) $('#local-check-status').textContent = '正在检查';
      return rendered.blob;
    }, () => createAtlasPreview($('#atlas-preview-host')));
    if (revision !== runRevision) return;
    const { checked, report } = record;
    exportUrl = URL.createObjectURL(checked.blob);
    $<HTMLImageElement>('#atlas-image').src = exportUrl;
    const exportedAnimations = report.externalAnimations ?? (report.externalAnimation ? [report.externalAnimation] : []);
    const externalAnimationLabel = exportedAnimations.length
      ? ` · ${exportedAnimations.map(animation => `${animation.label}行使用「${animation.clipName}」`).join('、')}`
      : '';
    $('#export-description').textContent = `${report.model.name}${externalAnimationLabel} · ${report.file.width} × ${report.file.height} · ${checked.inspection.requiredFrames} 帧 · ${(checked.encodedBytes / 1024 / 1024).toFixed(2)} MiB`;
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
    if (closed) return;
    const context = renderContext(now); renderMonitor.setContext(context, now);
    const delta = framePacer.tick(now, context.targetFps, context.activity === 'hidden');
    if (delta !== null) {
      if (!paused) animationTime += delta;
      if (transientUntil && now > transientUntil) { transientUntil = 0; changeState('idle'); }
      const started = performance.now();
      stage.render(state, animationTime, paused ? 0 : delta, now - lastPointer < 1800 ? look : undefined, stateRevision);
      renderMonitor.record(performance.now() - started);
    }
    if (!petMode && externalMotionClips.length && now - lastExternalMotionUiUpdate >= 100) {
      lastExternalMotionUiUpdate = now;
      updateExternalMotionTime();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let bodyDrag: { pointerId: number; x: number; y: number; target: HTMLElement; moved: boolean } | undefined;
  let suppressBodyClick = false;
  const trackDrag = (event: PointerEvent) => {
    if (bodyDrag && event.pointerId === bodyDrag.pointerId
      && Math.hypot(event.screenX - bodyDrag.x, event.screenY - bodyDrag.y) >= 4) bodyDrag.moved = true;
  };
  const finishBodyDrag = () => {
    if (!bodyDrag) return;
    const previous = bodyDrag; bodyDrag = undefined;
    suppressBodyClick = previous.moved;
    document.body.classList.remove('pet-body-dragging');
    if (previous.target.hasPointerCapture(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
    void desktop!.endDrag().catch(console.error);
  };
  if (petMode) {
    canvasHost.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).id !== 'character-canvas'
        || !stage.hitTest(event.clientX, event.clientY)) return;
      suppressBodyClick = false;
      const target = event.target as HTMLElement;
      bodyDrag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, target, moved: false };
      target.setPointerCapture(event.pointerId);
      document.body.classList.add('pet-body-dragging');
      ignoringMouse = false;
      void desktop!.startDrag().then(started => { if (!started) finishBodyDrag(); }).catch(error => { finishBodyDrag(); console.error(error); });
      event.preventDefault();
    });
    window.addEventListener('pointerup', event => { if (event.pointerId === bodyDrag?.pointerId) { trackDrag(event); finishBodyDrag(); } });
    window.addEventListener('pointercancel', event => { if (event.pointerId === bodyDrag?.pointerId) finishBodyDrag(); });
    window.addEventListener('lostpointercapture', event => { if (event.pointerId === bodyDrag?.pointerId) finishBodyDrag(); });
    window.addEventListener('blur', finishBodyDrag);
    window.addEventListener('pagehide', finishBodyDrag);
    canvasHost.addEventListener('click', event => {
      if (suppressBodyClick && (event.target as HTMLElement).id === 'character-canvas') {
        suppressBodyClick = false; event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  }
  window.addEventListener('pointermove', (event) => {
    if (bodyDrag) {
      trackDrag(event);
      if (event.buttons === 0) finishBodyDrag();
    }
    const bounds = canvasHost.getBoundingClientRect();
    look = pointerLook(event.clientX, event.clientY, bounds);
    lastPointer = performance.now();
    lastInteraction = lastPointer;
    if (petMode && !forcedInteractive && !bodyDrag) {
      const interactive = (event.target as HTMLElement)?.closest('[data-interactive]') || stage.hitTest(event.clientX, event.clientY);
      const next = !interactive;
      if (next !== ignoringMouse) { ignoringMouse = next; void desktop!.setClickThrough(next); }
    }
  });
  const markActive = () => { lastInteraction = performance.now(); };
  window.addEventListener('pointerdown', markActive);
  window.addEventListener('keydown', markActive);
  document.addEventListener('visibilitychange', () => { framePacer.reset(); markActive(); publishRenderMetrics(); scheduleRenderReports(); });
  canvasHost.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).id !== 'character-canvas') return;
    if (petMode && !stage.hitTest(event.clientX, event.clientY)) return;
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
  updatePackageControls();
  libraryChannel.onmessage = () => void syncLibrary();
  desktop?.onModelChanged(() => void syncLibrary());
  desktop?.onInteractionRestored(() => { forcedInteractive = true; ignoringMouse = false; });
  if (petMode) await chatUI.refresh();
}

if (petMode) {
  $('#workshop-button').onclick = () => {
    window.dispatchEvent(new Event('pet:open-workshop'));
    void desktop!.openWorkshop();
  };
  $('#hide-pet').onclick = () => void desktop!.hidePet();
  $('#pet-read-aloud').onclick = () => {
    if (petSpeech?.speaking) { petSpeech.stop(); return; }
    const view = petChat.current(performance.now());
    if (!view || !petChat.canReadAloud() || !petSpeech) return;
    petSpeechText = view.text;
    if (!petSpeech.speak(view.text, navigator.language || 'zh-CN') && petSpeechButton) {
      petSpeechButton.title = '系统语音播放失败，请检查 Windows 语音设置。';
    }
  };
  $('#pet-wave').onclick = () => { changeState('waving'); transientUntil = performance.now() + 2000; };
  $('#click-through').onclick = () => {
    forcedInteractive = false; ignoringMouse = true;
    void desktop!.setClickThrough(true);
  };
} else {
  $('#backup-character').onclick = () => void backupCharacter();
  $('#restore-character').onclick = () => $<HTMLInputElement>('#package-file').click();
  $<HTMLInputElement>('#package-file').onchange = (event) => {
    const input = event.target as HTMLInputElement; void restoreCharacter(input.files?.[0]); input.value = '';
  };
  $('#cancel-package').onclick = () => void cancelPackage();
  $('#cancel-load').onclick = () => { if (!committing) loadController?.abort(); };
  $('#rename-character').onclick = async () => {
    if (!currentCharacter || loading || packageJob) return;
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
  const chooseBuiltinMotion = (next: AnimationState) => {
    if (externalMotionClips.length) resetExternalMotionPreview();
    changeState(next);
  };
  $('#wave-button').onclick = () => { chooseBuiltinMotion('waving'); transientUntil = performance.now() + 2000; };
  $('#pause-button').onclick = () => { paused = !paused; $('#pause-button').textContent = paused ? '继续动画' : '暂停动画'; };
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach((button) => button.onclick = () => { transientUntil = 0; chooseBuiltinMotion(button.dataset.state as AnimationState); });
  $('#external-motion-import').onclick = () => $<HTMLInputElement>('#external-motion-file').click();
  $<HTMLInputElement>('#external-motion-file').onchange = event => {
    const input = event.target as HTMLInputElement;
    void importExternalMotion(input.files?.[0]); input.value = '';
  };
  $<HTMLSelectElement>('#external-motion-clip').onchange = event => {
    const index = Number((event.target as HTMLSelectElement).value);
    try {
      stage.playMotion(index);
      $<HTMLButtonElement>('#external-motion-toggle').textContent = '暂停动作';
      const clip = externalMotionClips[index];
      $('#external-motion-status').textContent = clip ? `正在预览：${describeExternalMotionCompatibility(clip)}` : '正在预览动作。';
      updateExternalMotionTime();
      updateExternalMotionSamplePreview();
    } catch (error) { $('#external-motion-status').textContent = error instanceof Error ? error.message : '动作切换失败。'; }
  };
  $<HTMLSelectElement>('#external-motion-export-state').onchange = updateExternalMotionSamplePreview;
  $('#external-motion-assign').onclick = () => {
    const targetState = $<HTMLSelectElement>('#external-motion-export-state').value as AnimationState | '';
    const clipIndex = Number($<HTMLSelectElement>('#external-motion-clip').value);
    const row = ANIMATION_ROWS.find(item => item.state === targetState);
    const clip = externalMotionClips.find(item => item.index === clipIndex);
    if (!row || !clip || !externalMotionBuffer) {
      $('#external-motion-status').textContent = '先选择目标动作行和 VRMA 片段，再加入替换清单。';
      return;
    }
    const existing = externalMotionAssignments.find(item => item.state === row.state);
    if (existing) existing.clipIndex = clip.index;
    else externalMotionAssignments.push({ state: row.state, clipIndex: clip.index });
    renderExternalMotionAssignments();
    $('#external-motion-status').textContent = `已将「${clip.name}」分配给${row.label}行。`;
  };
  $('#external-motion-assignments').onclick = event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-remove-motion-state]');
    const targetState = button?.dataset.removeMotionState as AnimationState | undefined;
    if (!targetState) return;
    externalMotionAssignments = externalMotionAssignments.filter(item => item.state !== targetState);
    if (externalMotionAssignments.length === 0) $<HTMLSelectElement>('#external-motion-export-state').value = '';
    renderExternalMotionAssignments();
    updateExternalMotionSamplePreview();
    $('#external-motion-status').textContent = '已移除该行替换，导出时将使用内置动作。';
  };
  $<HTMLSelectElement>('#external-motion-sample-frame').onchange = updateExternalMotionSamplePreview;
  $('#external-motion-sample-jump').onclick = () => {
    const clipIndex = Number($<HTMLSelectElement>('#external-motion-clip').value);
    const clip = externalMotionClips.find(item => item.index === clipIndex);
    const state = $<HTMLSelectElement>('#external-motion-export-state').value as AnimationState | '';
    const row = ANIMATION_ROWS.find(item => item.state === state);
    const frameIndex = Number($<HTMLSelectElement>('#external-motion-sample-frame').value);
    if (!clip || !row || !Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= row.frames) return;
    try {
      const seconds = clip.duration * frameIndex / row.frames;
      stage.seekMotion(clipIndex, seconds);
      updateExternalMotionTime();
      $('#external-motion-status').textContent = `已定位到导出采样第 ${frameIndex + 1} / ${row.frames} 帧（${seconds.toFixed(3)} 秒）。`;
    } catch (error) { $('#external-motion-status').textContent = error instanceof Error ? error.message : '采样帧定位失败。'; }
  };
  $<HTMLSelectElement>('#external-motion-speed').onchange = event => {
    try {
      const rate = Number((event.currentTarget as HTMLSelectElement).value);
      stage.setMotionPlaybackRate(rate);
      $('#external-motion-status').textContent = `动作预览速度：${rate}×。`;
    } catch (error) { $('#external-motion-status').textContent = error instanceof Error ? error.message : '动作速度设置失败。'; }
  };
  $<HTMLSelectElement>('#external-motion-loop').onchange = event => {
    try {
      const mode = (event.currentTarget as HTMLSelectElement).value as 'repeat' | 'once' | 'pingpong';
      stage.setMotionLoopMode(mode);
      $('#external-motion-status').textContent = `动作循环模式：${mode === 'once' ? '播放一次' : mode === 'pingpong' ? '往返' : '循环'}。`;
    } catch (error) { $('#external-motion-status').textContent = error instanceof Error ? error.message : '动作循环模式设置失败。'; }
  };
  $<HTMLInputElement>('#external-motion-time').oninput = event => {
    const index = Number($<HTMLSelectElement>('#external-motion-clip').value);
    const clip = externalMotionClips.find(item => item.index === index);
    if (!clip) return;
    try {
      const fraction = Number((event.currentTarget as HTMLInputElement).value) / 1000;
      stage.seekMotion(index, clip.duration * fraction);
      $<HTMLButtonElement>('#external-motion-toggle').textContent = '继续动作';
      updateExternalMotionTime();
    } catch (error) { $('#external-motion-status').textContent = error instanceof Error ? error.message : '动作定位失败。'; }
  };
  $<HTMLInputElement>('#external-motion-exact-time').onchange = event => {
    const index = Number($<HTMLSelectElement>('#external-motion-clip').value);
    const clip = externalMotionClips.find(item => item.index === index);
    const input = event.currentTarget as HTMLInputElement;
    if (!clip) return;
    const requested = Number(input.value);
    if (!Number.isFinite(requested)) { $('#external-motion-status').textContent = '请输入有效的动作时间。'; updateExternalMotionTime(); return; }
    try {
      stage.seekMotion(index, Math.min(clip.duration, Math.max(0, requested)));
      input.value = (stage.motionTime(index) ?? 0).toFixed(2);
      $<HTMLButtonElement>('#external-motion-toggle').textContent = '继续动作';
      updateExternalMotionTime();
    } catch (error) { $('#external-motion-status').textContent = error instanceof Error ? error.message : '动作定位失败。'; }
  };
  $('#external-motion-toggle').onclick = () => {
    const playing = stage.toggleMotion();
    $('#external-motion-toggle').textContent = playing ? '暂停动作' : '继续动作';
  };
  $('#external-motion-clear').onclick = () => {
    resetExternalMotionPreview('已恢复内置动作。'); transientUntil = 0; changeState('idle');
  };
  if (desktop) {
    $('#save-diagnostics').onclick = async () => {
      const button = $<HTMLButtonElement>('#save-diagnostics');
      button.disabled = true;
      try {
        const saved = await desktop.saveDiagnostics();
        $('#settings-status').textContent = saved ? '桌面诊断已保存到所选文件。' : '已取消保存桌面诊断。';
      } catch { $('#settings-status').textContent = '桌面诊断保存失败，请重试。'; }
      finally { button.disabled = false; }
    };
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

const chatUI = setupChat(desktop, petMode, value => {
  if (!petMode) return;
  petChat.update(value, performance.now()); restorePetChat();
}, amount => {
  stage?.setSpeechMouthOpen(amount);
  lastInteraction = performance.now();
});
let visibilityRevision = 0;
const applyNativeVisibility = (visible: boolean) => {
  if (closed) return;
  if (!visible) petSpeech?.stop();
  nativeVisible = visible; framePacer.reset(); lastInteraction = performance.now();
  publishRenderMetrics(); scheduleRenderReports();
};
const stopVisibility = desktop?.onWindowVisibility(visible => { ++visibilityRevision; applyNativeVisibility(visible); });
if (desktop) {
  const revision = visibilityRevision;
  void desktop.getWindowVisibility().then(visible => { if (revision === visibilityRevision) applyNativeVisibility(visible); }).catch(() => {});
}
window.addEventListener('beforeunload', () => {
  clearInterval(renderReportTimer);
  stopVisibility?.();
  petSpeech?.dispose();
  chatUI.dispose();
  closed = true; packageJob?.controller.abort();
  if (packageJob?.nativeStarted) void desktop?.cancelCharacterPackage(packageJob.id).catch(() => {});
  loadController?.abort(); libraryChannel.close(); library.close(); exportSession.reset(); stage?.dispose(); if (exportUrl) URL.revokeObjectURL(exportUrl);
});
void bootstrap();
