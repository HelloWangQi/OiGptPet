export function chatStressOptions(args) {
  const options = { mixed: false, fixedWindows: false, cycles: 24, settleSeconds: 0, minutes: null, warmupSeconds: 300, switchSeconds: 60, sampleSeconds: 15 };
  const flags = { '--mixed': 'mixed', '--fixed-windows': 'fixedWindows' };
  const values = { '--cycles': 'cycles', '--settle-seconds': 'settleSeconds', '--minutes': 'minutes', '--warmup-seconds': 'warmupSeconds', '--switch-seconds': 'switchSeconds', '--sample-seconds': 'sampleSeconds' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg) || (!Object.hasOwn(flags, arg) && !Object.hasOwn(values, arg))) throw new Error('Unknown or duplicate chat stress option: ' + arg);
    seen.add(arg);
    if (Object.hasOwn(flags, arg)) options[flags[arg]] = true;
    else {
      const raw = args[++i]; const value = Number(raw);
      if (raw === undefined || !raw.trim() || !Number.isFinite(value)) throw new Error('Expected a finite number after ' + arg);
      options[values[arg]] = value;
    }
  }
  const timed = options.minutes !== null;
  if (timed) { options.mixed = true; options.fixedWindows = true; }
  if (!Number.isInteger(options.cycles) || options.cycles < 4 || options.cycles > 200
      || !Number.isInteger(options.settleSeconds) || options.settleSeconds < 0 || options.settleSeconds > 30
      || (timed && (options.minutes <= 0 || options.minutes > 180 || seen.has('--cycles')))
      || !Number.isInteger(options.warmupSeconds) || options.warmupSeconds < 0 || options.warmupSeconds > 600
      || !Number.isFinite(options.switchSeconds) || options.switchSeconds < 1 || options.switchSeconds > 3600
      || !Number.isFinite(options.sampleSeconds) || options.sampleSeconds < 1 || options.sampleSeconds > 60
      || (!options.mixed && (options.fixedWindows || options.settleSeconds))
      || (!timed && ['--warmup-seconds', '--switch-seconds', '--sample-seconds'].some(flag => seen.has(flag)))) throw new Error('Invalid chat stress duration, interval or option combination.');
  return options;
}

// Deadlines are anchored to the run start, never to the previous action's end.
// Delayed slots are recorded and skipped instead of issuing catch-up bursts.
export class SwitchSchedule {
  constructor(intervalSeconds, totalSeconds) { this.interval = intervalSeconds; this.total = totalSeconds; this.next = 0; }
  reserve(now) {
    const skipped = Math.max(0, Math.floor((now - this.next) / this.interval));
    this.next += skipped * this.interval;
    if (this.next >= this.total) return null;
    const slot = { atSeconds: this.next, skippedSlots: skipped };
    this.next += this.interval; return slot;
  }
}

export function soakDuration(options, elapsedSeconds) {
  const observationSeconds = Math.max(0, elapsedSeconds - options.warmupSeconds);
  return { observationSeconds, completeHour: options.minutes >= 60 && options.warmupSeconds >= 300 && observationSeconds >= 3600 };
}

export function sampleCoverage(samples, intervalSeconds) {
  const gaps = samples.slice(1).map((row, i) => row.collectedSeconds - samples[i].collectedSeconds);
  const maximumGapSeconds = gaps.length ? Math.max(...gaps) : null;
  return { maximumGapSeconds, continuous: samples.length >= 2 && gaps.every(gap => gap >= 0 && gap <= Math.max(45, intervalSeconds * 3)) };
}
