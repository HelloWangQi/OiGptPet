type VoiceAlternative = { transcript: string };
type VoiceResult = { isFinal: boolean; length: number; [index: number]: VoiceAlternative };
type VoiceResultEvent = { results: ArrayLike<VoiceResult> };
type VoiceRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: VoiceResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceConstructor = new () => VoiceRecognition;
type VoiceWindow = Window & { SpeechRecognition?: VoiceConstructor; webkitSpeechRecognition?: VoiceConstructor };
export type VoiceInputState = 'idle' | 'listening' | 'unsupported' | 'error';

const voiceConstructor = () => {
  const target = window as VoiceWindow;
  return target.SpeechRecognition ?? target.webkitSpeechRecognition;
};

const errorText = (code: string) => ({
  'not-allowed': '麦克风权限未授予。',
  'service-not-allowed': '语音识别服务不允许使用。',
  'audio-capture': '没有检测到可用麦克风。',
  'no-speech': '没有识别到语音。',
  network: '语音识别服务连接失败。',
  'language-not-supported': '当前语言不受语音识别支持。',
}[code] ?? '语音识别失败，请重试。');

/** Manual, one-utterance dictation into the chat composer; never sends by itself. */
export class ChatVoiceInput {
  private recognition?: VoiceRecognition;
  private stopping = false;
  private baseText = '';
  private failure?: string;

  constructor(
    private readonly readText: () => string,
    private readonly writeText: (text: string) => void,
    private readonly onState: (state: VoiceInputState, message: string) => void,
    private readonly language = navigator.language || 'zh-CN',
    private readonly maxLength = 2000,
  ) {}

  get available() { return Boolean(voiceConstructor()); }
  get listening() { return this.recognition !== undefined; }

  toggle() {
    if (this.recognition) this.stop();
    else this.start();
  }

  stop() {
    const recognition = this.recognition;
    if (!recognition || this.stopping) return;
    this.stopping = true;
    this.onState('listening', '正在结束听写并整理识别结果…');
    try { recognition.stop(); }
    catch { this.finish(recognition, '听写已停止。检查文字后再手动发送。'); }
  }

  abort() {
    const recognition = this.recognition;
    if (!recognition) return;
    this.recognition = undefined;
    this.stopping = false;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* The recognition may already have ended. */ }
    this.onState('idle', '听写已取消。');
  }

  dispose() { this.abort(); }

  private start() {
    const Constructor = voiceConstructor();
    if (!Constructor) { this.onState('unsupported', '此运行环境不支持语音识别。'); return; }
    let recognition: VoiceRecognition;
    try { recognition = new Constructor(); }
    catch { this.onState('error', '语音识别初始化失败。'); return; }

    this.baseText = this.readText();
    this.failure = undefined;
    this.stopping = false;
    recognition.lang = this.language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => this.updateText(event.results);
    recognition.onerror = event => { this.failure = errorText(event.error); };
    recognition.onend = () => this.finish(recognition, this.failure ?? '听写完成。检查文字后再手动发送。');
    this.recognition = recognition;
    this.onState('listening', '正在听写…再次点击麦克风停止。');
    try {
      recognition.start();
    } catch {
      this.finish(recognition, '无法启动语音识别，请检查麦克风权限。', true);
    }
  }

  private updateText(results: ArrayLike<VoiceResult>) {
    const finalParts: string[] = [];
    const interimParts: string[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const text = result?.[0]?.transcript ?? '';
      (result?.isFinal ? finalParts : interimParts).push(text);
    }
    const transcript = finalParts.join('') + interimParts.join('');
    const needsSpace = /[A-Za-z0-9]$/u.test(this.baseText) && /^[A-Za-z0-9]/u.test(transcript);
    const prefix = this.baseText + (needsSpace ? ' ' : '');
    this.writeText(prefix + transcript.slice(0, Math.max(0, this.maxLength - prefix.length)));
  }

  private finish(recognition: VoiceRecognition, message: string, failed?: boolean) {
    if (this.recognition !== recognition) return;
    this.recognition = undefined;
    this.stopping = false;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    this.onState((failed ?? Boolean(this.failure)) ? 'error' : 'idle', message);
  }
}
