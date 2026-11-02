import { describe, expect, it } from 'vitest';
import trust from '../electron/ipc-trust.cjs';
const mainFrame = {}; const sender = { mainFrame }; const event = { sender, senderFrame: mainFrame };
const owner = { isDestroyed: () => false };
describe('native IPC window ownership', () => {
  it('allows a known live main-frame sender', () => {
    expect(trust.assertTrustedSender(event, [owner, null], value => { expect(value).toBe(sender); return owner; })).toBe(owner);
  });
  it('rejects an unowned sender even when a closed window slot is null', () => {
    expect(() => trust.assertTrustedSender(event, [null, owner], () => null)).toThrow('Unknown IPC sender');
  });
  it('rejects a destroyed owner still present in a window slot', () => {
    const destroyed = { isDestroyed: () => true };
    expect(() => trust.assertTrustedSender(event, [destroyed, null], () => destroyed)).toThrow('Unknown IPC sender');
  });
  it('rejects an unrelated window', () => {
    expect(() => trust.assertTrustedSender(event, [owner, null], () => ({ isDestroyed: () => false }))).toThrow('Unknown IPC sender');
  });
  it('rejects subframes within an otherwise trusted window', () => {
    expect(() => trust.assertTrustedSender({ ...event, senderFrame: {} }, [owner], () => owner)).toThrow('Unknown IPC sender');
  });
});
