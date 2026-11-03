export const CHAT_READINESS_TEXT: Record<ChatReadiness['code'], string> = {
  ready: '本地检查通过：已保存配置可读取、密钥可解密。模型权限和网络请通过发送消息验证（可能计费）。',
  missing_model: '请先填写模型 ID 和 API Key，并保存设置。',
  invalid_model: '已保存的模型 ID 格式无效，请修改后保存设置。',
  missing_key: '尚未保存 API Key，请填写后保存设置。',
  unavailable: '系统安全存储不可用，请恢复本机安全存储后重试。',
  unreadable_key: '已保存密钥无法在本机解密，请重新填写 API Key 并保存。',
  busy: '当前操作尚未完成，请稍后再检查。',
  timeout: '本地检查超时，请稍后重试或重新保存密钥。',
  cancelled: '本地检查已取消。',
};

export function chatSettingsIssue(model: string, key: string) {
  if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(model.trim())) return '模型 ID 需为 1–120 个字母、数字或 . _ : / -，请填写账户可用的模型 ID。';
  if (key && (key.length > 512 || /[^\x21-\x7e]/.test(key))) return 'API Key 含空白或不支持的字符，请重新完整复制。';
  return null;
}
