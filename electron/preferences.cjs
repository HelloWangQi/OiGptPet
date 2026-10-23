const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PREFERENCES = Object.freeze({ version: 1, scale: 1, performance: 'balanced' });
const scales = [0.8, 1, 1.2];
const modes = ['quality', 'balanced', 'battery'];

function normalizePreferences(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) && value.version === 1 ? value : {};
  return {
    version: 1,
    scale: scales.includes(input.scale) ? input.scale : DEFAULT_PREFERENCES.scale,
    performance: modes.includes(input.performance) ? input.performance : DEFAULT_PREFERENCES.performance,
  };
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).some((key) => !['scale', 'performance'].includes(key))
    || ('scale' in patch && !scales.includes(patch.scale))
    || ('performance' in patch && !modes.includes(patch.performance))) {
    throw new Error('Invalid desktop preferences');
  }
  return { ...patch };
}

function createPreferencesStore(file) {
  let current = { ...DEFAULT_PREFERENCES };
  let writes = Promise.resolve();
  return {
    async load() {
      await writes;
      try { current = normalizePreferences(JSON.parse(await fs.readFile(file, 'utf8'))); }
      catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        current = { ...DEFAULT_PREFERENCES };
      }
      return { ...current };
    },
    get() { return { ...current }; },
    async update(patch) {
      const validated = validatePatch(patch);
      const result = writes.then(async () => {
        const next = { ...current, ...validated };
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.tmp`, JSON.stringify(next), 'utf8');
        await fs.rename(`${file}.tmp`, file);
        current = next;
        return { ...current };
      });
      // A failed write must not block later attempts or update the in-memory state.
      writes = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { DEFAULT_PREFERENCES, normalizePreferences, createPreferencesStore };
