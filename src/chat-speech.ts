type SpeechRuntime = Pick<SpeechSynthesis, 'speak' | 'cancel'>;
type UtteranceFactory = (text: string) => SpeechSynthesisUtterance;
type SpeechBoundary = Pick<SpeechSynthesisEvent, 'charIndex' | 'charLength'>;

/** User-triggered system voice playback for a completed chat reply. */
export class ChatSpeech {
  private current?: SpeechSynthesisUtterance;
  private boundaryTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly runtime: SpeechRuntime | undefined,
    private readonly createUtterance: UtteranceFactory = text => new SpeechSynthesisUtterance(text),
    private readonly onChange: (speaking: boolean) => void = () => {},
    private readonly onBoundary: (event: SpeechBoundary) => void = () => {},
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
    utterance.onboundary = event => {
      if (this.current !== utterance) return;
      clearTimeout(this.boundaryTimer);
      this.onBoundary(event);
      const length = Number.isFinite(event.charLength) ? Math.max(0, event.charLength) : 1;
      const hold = Math.min(700, 160 + length * 45);
      this.boundaryTimer = setTimeout(() => {
        this.boundaryTimer = undefined;
        if (this.current === utterance) this.onBoundary({ charIndex: -1, charLength: 0 });
      }, hold);
    };
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
    clearTimeout(this.boundaryTimer);
    this.boundaryTimer = undefined;
    current.onend = null;
    current.onerror = null;
    current.onboundary = null;
    try {
      this.runtime?.cancel();
    } finally {
      this.onBoundary({ charIndex: -1, charLength: 0 });
      this.onChange(false);
    }
  }

  dispose(): void {
    this.stop();
  }

  private finish(utterance: SpeechSynthesisUtterance): void {
    if (this.current !== utterance) return;
    this.current = undefined;
    clearTimeout(this.boundaryTimer);
    this.boundaryTimer = undefined;
    utterance.onboundary = null;
    this.onBoundary({ charIndex: -1, charLength: 0 });
    this.onChange(false);
  }
}
