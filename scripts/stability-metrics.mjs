export function soakOptions(args) {
  const values = { minutes: 60, 'switch-seconds': 90, 'sample-seconds': 30 };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = Number(args[i + 1]);
    if (!Object.hasOwn(values, key) || !Number.isFinite(value) || value <= 0) throw new Error('Use --minutes N --switch-seconds N --sample-seconds N; all values must be positive');
    values[key] = value;
  }
  if (values.minutes > 180 || values['sample-seconds'] < 1 || values['switch-seconds'] < 1) throw new Error('Unsupported soak duration or interval');
  return values;
}

// Electron's privateBytes and workingSetSize are KiB. Missing values stay null.
export function summarizeMemory(samples, warmupSeconds = 300) {
  const groups = new Map();
  for (const sample of samples.filter(row => row.elapsedSeconds >= warmupSeconds)) {
    const workload = sample.kind ?? 'unknown';
    for (const process of sample.processes) {
      if (!Number.isFinite(process.memory?.privateBytes)) continue;
      // VRM/WebGL and sprite/Canvas have different steady-state allocation
      // sizes. Compare each process under the same renderer workload so the
      // first/last samples do not accidentally compare different model types.
      const key = `${process.pid}:${process.creationTime ?? ''}:${workload}`;
      if (!groups.has(key)) groups.set(key, { pid: process.pid, type: process.type, roles: process.roles ?? [], kind: workload, points: [] });
      groups.get(key).points.push({ x: sample.elapsedSeconds / 60, y: process.memory.privateBytes / 1024 });
    }
  }
  return [...groups.values()].map(({ points, ...identity }) => {
    const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
    const variance = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
    const slope = variance ? points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0) / variance : null;
    const delta = points.at(-1).y - points[0].y;
    return { ...identity, samples: points.length, firstPrivateMiB: points[0].y, lastPrivateMiB: points.at(-1).y, deltaPrivateMiB: delta, slopeMiBPerMinute: slope, needsReview: points.length >= 5 && delta > 100 && slope > 1 };
  });
}
