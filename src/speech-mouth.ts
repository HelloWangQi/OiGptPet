const punctuation = /^[\s.,!?;:，。！？、；：…—-]+$/u;

/** Approximate an open-mouth viseme from the current system speech boundary. */
export function estimateSpeechMouthOpen(text: string, charIndex: number, charLength = 1): number {
  if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= text.length) return 0;
  const length = Number.isFinite(charLength) && charLength > 0 ? Math.floor(charLength) : 1;
  const segment = [...text.slice(charIndex, charIndex + length)].filter(character => !punctuation.test(character));
  if (!segment.length) return 0;

  let sum = 0;
  for (const character of segment) {
    const normalized = character.normalize('NFD').toLowerCase();
    if (/^[a-z]$/u.test(normalized)) {
      sum += ({ a: 0.82, e: 0.46, i: 0.32, o: 0.7, u: 0.48 } as Record<string, number>)[normalized] ?? 0.18;
    } else if (/^[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]$/u.test(character)) {
      // SpeechSynthesis does not expose phonemes for CJK voices. Use a modest
      // syllable opening while punctuation boundaries close the mouth.
      sum += 0.52;
    } else {
      sum += 0.18;
    }
  }
  return Math.max(0, Math.min(1, sum / segment.length));
}
