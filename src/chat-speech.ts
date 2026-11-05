type SpeechRuntime = Pick<SpeechSynthesis, 'speak' | 'cancel'>;
type UtteranceFactory = (text: string) => SpeechSynthesisUtterance;

/** User-triggered system voice playback for a completed chat reply. */
export class ChatSpeech {
  private current?: SpeechSynthesisUtterance;

  constructor(
    private readonly runtime: SpeechRuntime | undefined,
    private readonly createUtterance: UtteranceFactory = text => new SpeechSynthesisUtterance(text),
    private readonly onChange: (speaking: boolean) => void = () => {},
  ) {}

  get available(): boolean {
    return this.runtime !== undefined;
  }

  get speaking(): boolean {
    return this.current !== undefined;
  }

  speak(text: string, language: string): boolean {
    if (!this.runtime || !text.trim()) return false;
    this.stop();

    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = this.createUtterance(text);
    } catch {
      return false;
    }
    utterance.lang = language;
    utterance.onend = () => this.finish(utterance);
    utterance.onerror = () => this.finish(utterance);
    this.current = utterance;
    this.onChange(true);
    try {
      this.runtime.speak(utterance);
      return true;
    } catch {
      this.finish(utterance);
      return false;
    }
  }

  stop(): void {
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    current.onend = null;
    current.onerror = null;
    try {
      this.runtime?.cancel();
    } finally {
      this.onChange(false);
    }
  }

  dispose(): void {
    this.stop();
  }

  private finish(utterance: SpeechSynthesisUtterance): void {
    if (this.current !== utterance) return;
    this.current = undefined;
    this.onChange(false);
  }
}
