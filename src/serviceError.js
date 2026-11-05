const fatalCodes = new Set(['invalid_api_key', 'insufficient_balance', 'permission_denied']);

export function isFatalServiceError(error) {
  return fatalCodes.has(error?.code);
}

export function serviceError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export function responseError(status, data) {
  const detail = data?.error;
  const code = detail?.code || ({ 401: 'invalid_api_key', 402: 'insufficient_balance', 403: 'permission_denied',
    429: 'rate_limited' })[status] || 'upstream_error';
  return serviceError(`生成失败：${detail?.message || '服务暂时不可用'}`, {
    code, status, service: detail?.service,
    retryable: !fatalCodes.has(code) && detail?.retryable !== false,
  });
}
