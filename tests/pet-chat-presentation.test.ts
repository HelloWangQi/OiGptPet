import { describe, expect, it } from 'vitest';
import { PetChatPresentation } from '../src/pet-chat-presentation';

describe('pet conversation across character replacement', () => {
  it('does not invent a conversation before any state is received', () => {
    expect(new PetChatPresentation().current(0)).toBeUndefined();
  });
  it('replays a stalled stream with its thinking animation without another event', () => {
    const view = new PetChatPresentation();
    view.update({ sequence: 1, status: 'thinking' }, 0);
    expect(view.canReadAloud()).toBe(false);
    expect(view.current(1)?.text).toBe('正在思考…');
    view.update({ sequence: 2, status: 'streaming', text: '尚未完成' }, 10);
    expect(view.canReadAloud()).toBe(false);
    expect(view.current(5000)).toEqual({ text: '尚未完成', animation: 'running', until: 0 });
  });
  it('keeps the reply after an expired wave and does not extend it on replay', () => {
    const view = new PetChatPresentation(); const reply = { sequence: 3, status: 'reply', text: '完整回复' };
    view.update(reply, 100); view.update(reply, 1000);
    expect(view.canReadAloud()).toBe(true);
    expect(view.current(1100)).toEqual({ text: '完整回复', animation: 'waving', until: 2100 });
    expect(view.current(2100)).toEqual({ text: '完整回复', animation: 'idle', until: 0 });
  });
  it('never restores a cleared reply from an older event or changes through a shared reference', () => {
    const view = new PetChatPresentation(); const reply = { sequence: 1, status: 'reply', text: '旧回复' };
    view.update(reply, 0); reply.text = '篡改';
    expect(view.current(1)?.text).toBe('旧回复');
    view.update({ sequence: 2, status: 'cleared' }, 2); view.update(reply, 3);
    expect(view.canReadAloud()).toBe(false);
    expect(view.current(3)).toEqual({ text: '', animation: 'idle', until: 0 });
  });
  it('cancels the old wave when a new request starts and limits error detail on the pet', () => {
    const view = new PetChatPresentation();
    view.update({ sequence: 1, status: 'reply', text: '上一条' }, 0);
    view.update({ sequence: 2, status: 'thinking' }, 1);
    expect(view.canReadAloud()).toBe(false);
    expect(view.current(2)?.animation).toBe('running');
    view.update({ sequence: 3, status: 'error', text: '工坊详细错误' }, 3);
    expect(view.current(4)).toEqual({ text: '请求未完成，请在工坊查看。', animation: 'idle', until: 0 });
  });
  it('does not bring partial text back after cancellation', () => {
    const view = new PetChatPresentation();
    view.update({ sequence: 1, status: 'streaming', text: '片段' }, 0);
    view.update({ sequence: 2, status: 'cancelled' }, 1);
    expect(view.canReadAloud()).toBe(false);
    expect(view.current(500)).toEqual({ text: '', animation: 'idle', until: 0 });
  });
});
