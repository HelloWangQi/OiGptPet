// Return only application-owned messages. Never forward upstream message text,
// arbitrary codes or error bodies into IPC, history, logs or the UI.
async function describeHttpError(response, { signal, wait }) {
  const status = response.status;
  let code; let type;
  if ([400, 404, 429].includes(status) && response.body) {
    const reader = response.body.getReader();
    try {
      const chunks = []; let size = 0;
      while (true) {
        const value = await wait(() => reader.read(), signal);
        if (value.done) break;
        size += value.value.byteLength;
        if (size > 8192) break;
        chunks.push(value.value);
      }
      if (size <= 8192) {
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const error = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))?.error;
        code = error?.code; type = error?.type;
      }
    } catch (error) { if (signal.aborted) throw error; }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else { void response.body?.cancel().catch(() => {}); }
  if (status === 401) return '服务认证失败（HTTP 401）。请核对 API Key 是否有效，以及所属项目的访问权限。';
  if (status === 403) return '服务拒绝访问（HTTP 403）。请核对项目、模型权限及服务可用地区。';
  if (status === 404 || ([400, 404].includes(status) && code === 'model_not_found')) return `服务未找到可用模型或资源（HTTP ${status}）。请核对模型 ID 和账户访问权限。`;
  if (status === 429) {
    if (['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded'].includes(code) || type === 'insufficient_quota') return '服务额度或限额不足（HTTP 429）。请核对 API 账户可用额度及项目/组织限额，确认后再重试。';
    if (['rate_limit_exceeded', 'slow_down'].includes(code) || type === 'rate_limit_error') return '服务请求过于频繁（HTTP 429）。请稍后手动重试。';
    return '服务请求受限（HTTP 429）。请核对请求频率和账户额度，确认后再手动重试。';
  }
  if (status >= 500) return `服务暂时异常（HTTP ${status}）。请稍后手动重试。`;
  if ([400, 422].includes(status)) return `服务未接受请求（HTTP ${status}）。请核对模型 ID 及模型支持的请求参数。`;
  return `服务请求失败（HTTP ${status}）。请检查配置后手动重试。`;
}
module.exports = { describeHttpError };
