const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_PACKAGE_BYTES = 12 + 65536 + 64 * 1024 * 1024;

function validatePackageSave(bytes, sha256, operationId) {
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(operationId)) throw new Error('Invalid package operation');
  if (!(bytes instanceof Uint8Array) || bytes.length < 14 || bytes.length > MAX_PACKAGE_BYTES) throw new Error('Invalid package size');
  const buffer = Buffer.from(bytes);
  const manifestBytes = buffer.readUInt32LE(8);
  if (buffer.subarray(0, 8).toString('ascii') !== 'OIPET001' || manifestBytes < 1 || manifestBytes > 65536 || 12 + manifestBytes >= buffer.length) throw new Error('Invalid package header');
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || createHash('sha256').update(buffer).digest('hex') !== sha256) throw new Error('Package hash mismatch');
  return buffer;
}

function createCharacterPackageSaver({ chooseFile, fileSystem = fs }) {
  const jobs = new Map();
  const key = (owner, id) => `${owner.id}:${id}`;
  return {
    cancel(owner, id) {
      const job = jobs.get(key(owner, id));
      if (!job || job.committing) return false;
      job.cancelled = true;
      return true;
    },
    async save(owner, bytes, sha256, operationId) {
      const buffer = validatePackageSave(bytes, sha256, operationId);
      if (owner.isDestroyed()) return null;
      const id = key(owner, operationId);
      if (jobs.has(id)) throw new Error('Package operation already exists');
      const job = { cancelled: false, committing: false };
      const onClosed = () => { if (!job.committing) job.cancelled = true; };
      jobs.set(id, job); owner.once('closed', onClosed);
      let temporary;
      const cancelled = () => job.cancelled || owner.isDestroyed();
      try {
        const result = await chooseFile(owner);
        if (result.canceled || !result.filePath || cancelled()) return null;
        temporary = path.join(path.dirname(result.filePath), `.OiGptPet-${randomUUID()}.tmp`);
        await fileSystem.writeFile(temporary, buffer, { flag: 'wx' });
        if (cancelled()) return null;
        // A rename already started is a commit: cancellation cannot claim it was undone.
        job.committing = true;
        await fileSystem.rename(temporary, result.filePath);
        temporary = undefined;
        return result.filePath;
      } finally {
        jobs.delete(id); owner.removeListener('closed', onClosed);
        if (temporary) await fileSystem.unlink(temporary).catch(() => {});
      }
    },
  };
}

module.exports = { MAX_PACKAGE_BYTES, validatePackageSave, createCharacterPackageSaver };
