import type { AnimationState } from '../packages/target-chatgpt/contract';

/** Conversation display survives canvas replacement; replay never extends a wave. */
export class PetChatPresentation {
  private latest?: CompanionChatState;
  private replyUntil = 0;

  update(value: CompanionChatState, now: number) {
    if (this.latest && value.sequence <= this.latest.sequence) return;
    this.latest = { ...value };
    this.replyUntil = value.status === 'reply' ? now + 2000 : 0;
  }

  current(now: number): { text: string; animation: AnimationState; until: number } | undefined {
    const value = this.latest;
    if (!value) return undefined;
    if (value.status === 'thinking' || value.status === 'streaming') return {
      text: value.status === 'thinking' ? '正在思考…' : value.text ?? '', animation: 'running', until: 0,
    };
    if (value.status === 'reply') {
      const waving = now < this.replyUntil;
      return { text: value.text ?? '', animation: waving ? 'waving' : 'idle', until: waving ? this.replyUntil : 0 };
    }
    return { text: value.status === 'error' ? '请求未完成，请在工坊查看。' : '', animation: 'idle', until: 0 };
  }
}
