import { describe, expect, it, vi } from 'vitest';
import { ChatSpeech } from '../src/chat-speech';

interface FakeUtterance {
  text: string;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onboundary: ((event: { charIndex: number; charLength: number }) => void) | null;
}

function speechHarness() {
  const utterances: FakeUtterance[] = [];
  const runtime = { speak: vi.fn(), cancel: vi.fn() };
  const createUtterance = (text: string) => {
    const value: FakeUtterance = { text, lang: '', onend: null, onerror: null, onboundary: null };
    utterances.push(value);
    return value as unknown as SpeechSynthesisUtterance;
  };
  return { runtime, utterances, createUtterance };
}

describe('ChatSpeech', () => {
  it('only starts playback for a non-empty reply when speech is available', () => {
    const unavailable = new ChatSpeech(undefined);
    expect(unavailable.available).toBe(false);
    expect(unavailable.speak('你好', 'zh-CN')).toBe(false);

    const harness = speechHarness();
    const speech = new ChatSpeech(harness.runtime, harness.createUtterance);
    expect(speech.available).toBe(true);
    expect(speech.speak('  ', 'zh-CN')).toBe(false);
    expect(harness.runtime.speak).not.toHaveBeenCalled();
  });

  it('stops or replaces speech and ignores late events from an older utterance', () => {
    const harness = speechHarness();
    const changes: boolean[] = [];
    const speech = new ChatSpeech(harness.runtime, harness.createUtterance, active => changes.push(active));

    expect(speech.speak('第一条', 'zh-CN')).toBe(true);
    const previous = harness.utterances[0];
    expect(speech.speaking).toBe(true);
    expect(previous.lang).toBe('zh-CN');

    expect(speech.speak('第二条', 'zh-CN')).toBe(true);
    expect(harness.runtime.cancel).toHaveBeenCalledTimes(1);
    previous.onend?.();
    expect(speech.speaking).toBe(true);

    speech.stop();
    expect(harness.runtime.cancel).toHaveBeenCalledTimes(2);
    expect(speech.speaking).toBe(false);
    expect(changes).toEqual([true, false, true, false]);
  });

  it('resets its active state after natural completion or a speech error', () => {
    const harness = speechHarness();
    const speech = new ChatSpeech(harness.runtime, harness.createUtterance);
    speech.speak('完成', 'zh-CN');
    harness.utterances[0].onend?.();
    expect(speech.speaking).toBe(false);

    speech.speak('失败', 'zh-CN');
    harness.utterances[1].onerror?.();
    expect(speech.speaking).toBe(false);
  });

  it('recovers when utterance creation or playback throws', () => {
    const runtime = { speak: vi.fn(() => { throw new Error('unavailable'); }), cancel: vi.fn() };
    const factory = vi.fn((text: string) => ({ text, lang: '', onend: null, onerror: null, onboundary: null } as unknown as SpeechSynthesisUtterance));
    const speech = new ChatSpeech(runtime, factory);
    expect(speech.speak('试播', 'zh-CN')).toBe(false);
    expect(speech.speaking).toBe(false);

    const brokenFactory = new ChatSpeech(runtime, () => { throw new Error('unsupported'); });
    expect(brokenFactory.speak('试播', 'zh-CN')).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
