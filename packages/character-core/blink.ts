export type BlinkChannel = 'blink' | 'blinkLeft' | 'blinkRight';
export function blinkChannels(has: (name: BlinkChannel) => boolean): BlinkChannel[] {
  if (has('blink')) return ['blink'];
  return has('blinkLeft') && has('blinkRight') ? ['blinkLeft', 'blinkRight'] : [];
}

/** Prefer the combined preset; never turn a one-sided preset into an unintended wink. */
export function applyBlink(manager: { getExpression(name: string): unknown; setValue(name: string, value: number): void } | undefined, weight: number) {
  if (!manager) return;
  const present = new Set<BlinkChannel>(['blink', 'blinkLeft', 'blinkRight'].filter(name => Boolean(manager.getExpression(name))) as BlinkChannel[]);
  const selected = blinkChannels(name => present.has(name));
  const value = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  for (const name of present) manager.setValue(name, selected.includes(name) ? value : 0);
}
