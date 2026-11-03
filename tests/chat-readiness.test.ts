import { describe, expect, it } from 'vitest';
import { CHAT_READINESS_TEXT, chatSettingsIssue } from '../src/chat-readiness';

describe('first chat configuration feedback', () => {
  it('checks syntax without assuming a key prefix or model availability', () => {
    expect(chatSettingsIssue('test-model', 'unprefixed-printable-key')).toBeNull();
    expect(chatSettingsIssue('test-model', '')).toBeNull();
    expect(chatSettingsIssue('invalid model!', 'key')).toContain('模型 ID');
    expect(chatSettingsIssue('valid', 'key with spaces')).toContain('API Key');
    expect(chatSettingsIssue('valid', 'x'.repeat(513))).toContain('API Key');
  });
  it('does not describe local readiness as a successful online request', () => {
    expect(CHAT_READINESS_TEXT.ready).toContain('本地检查');
    expect(CHAT_READINESS_TEXT.ready).toContain('模型权限和网络');
    expect(CHAT_READINESS_TEXT.unreadable_key).toContain('重新填写');
  });
});
