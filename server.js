import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const FISH_MODELS = new Set(['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3']);
const DEFAULT_FISH_REFERENCE_ID = 'a18851e0129d4a43bf7589961cb6f300'; // Jessica

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

export function createApp(env = process.env, request = fetch, options = {}) {
  const managed = options.managed || null;
  const missing = ['DEEPSEEK_API_KEY', 'FISH_API_KEY'].filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`请填写：${missing.join('、')}`);
  const fishApiKey = env.FISH_API_KEY.trim();
  const fishModel = env.FISH_MODEL?.trim() || 's2.1-pro-free';
  const fishReferenceId = env.FISH_REFERENCE_ID?.trim() || DEFAULT_FISH_REFERENCE_ID;
  // Fish Audio falls back to a paid model when it receives an unknown model ID.
  if (!FISH_MODELS.has(fishModel)) throw new Error('FISH_MODEL 不是支持的型号，请检查配置');

  const fail = (status, message, code = status < 500 ? 'invalid_request' : 'upstream_error', service = 'Readio', retryable = status >= 500) =>
    Object.assign(new Error(message), { status, code, service, retryable });
  const safe = message => [env.DEEPSEEK_API_KEY.trim(), fishApiKey].reduce(
    (text, secret) => text.replaceAll(secret, '[已隐藏]'), String(message)).slice(0, 200);

  function providerFailure(service, status, data) {
    const detail = safe(data?.error?.message || data?.message || data?.reason || `${service} HTTP ${status}`);
    const reason = `${data?.error?.code || data?.code || ''} ${data?.reason || ''} ${detail}`;
    if (status === 401 || /invalid[_ -]?(api[_ -]?)?key|incorrect.{0,20}key|invalid.{0,20}(credential|token)|authentication.{0,15}(fail|error)|unauthenticated|api.?key.{0,20}(invalid|expired)|密钥.{0,10}(错误|无效|过期)/i.test(reason)) {
      return fail(502, `${service} API Key 无效或已过期，请检查配置。${detail}`, 'invalid_api_key', service, false);
    }
    if (/concurrency|qps|rate[_ -]?limit|too many requests|并发|限流|请求过于频繁/i.test(reason)) {
      return fail(502, `${service}请求过于频繁，请稍后重试。${detail}`, 'rate_limited', service, true);
    }
    if (status === 402 || /insufficient[_ -]?(balance|quota|funds)|balance.{0,20}(insufficient|exhaust|not enough)|quota.{0,15}(exhaust|exceed)|arrears|欠费|余额不足|余额已用完|额度.{0,10}(不足|用尽|耗尽)|资源包.{0,10}(耗尽|用完)/i.test(reason)) {
      return fail(502, `${service}余额或可用额度不足，请检查账户。${detail}`, 'insufficient_balance', service, false);
    }
    if (status === 403 || /permission[_ -]?denied|access[_ -]?denied|not authorized|unauthorized|forbidden|未授权|权限不足|无权限/i.test(reason)) {
      return fail(502, `${service}权限不足，请检查服务或音色授权。${detail}`, 'permission_denied', service, false);
    }
    if (status === 429) return fail(502, `${service}请求过于频繁，请稍后重试。${detail}`, 'rate_limited', service, true);
    if ([400, 404, 422].includes(status)) return fail(502, `${service}请求参数有误。${detail}`, 'invalid_request', service, false);
    return fail(502, detail, 'upstream_error', service, true);
  }

  function connectionFailure(error, service, signal) {
    if (signal?.aborted && signal.reason?.name !== 'TimeoutError') return signal.reason;
    if (signal?.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError') {
      return fail(502, `${service}请求超时，请检查网络后重试`, 'timeout', service, true);
    }
    return fail(502, `无法连接 ${service}`, 'network_error', service, true);
  }

  async function post(url, body, headers, service, clientSignal) {
    const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(120_000)]);
    let response;
    try {
      response = await request(url, { method: 'POST', signal,
        headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) { throw connectionFailure(error, service, signal); }
    if (!response.ok) {
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (signal.aborted) throw connectionFailure(error, service, signal);
        data = null;
      }
      throw providerFailure(service, response.status, data);
    }
    return { response, signal };
  }

  async function json(response, service, signal) {
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (signal.aborted) throw connectionFailure(error, service, signal);
      throw fail(502, `${service}返回了无效响应（HTTP ${response.status}）`, 'upstream_error', service);
    }
    if (data?.error) throw providerFailure(service, response.status, data);
    if (!data || typeof data !== 'object') throw fail(502, `${service}返回了无效响应`, 'upstream_error', service);
    return data;
  }

  async function readBody(req, limit = 1024 * 1024) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(400, '请使用 JSON 格式提交请求');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw fail(413, '请求内容超过 1MB');
      chunks.push(chunk);
    }
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data;
    } catch { throw fail(400, '请求 JSON 格式不正确'); }
  }

  async function serveFile(res, path, type) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw fail(404, '页面不存在');
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[type || extname(path)] || 'application/octet-stream',
      'Content-Length': bytes.length });
    res.end(bytes);
  }

  async function handle(req, res) {
    const controller = new AbortController();
    const abort = () => controller.abort(new DOMException('请求已取消', 'AbortError'));
    const closed = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort);
    res.once('close', closed);
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method;

      if (managed) {
        const expected = Buffer.from(`Bearer ${managed.token}`);
        const supplied = Buffer.from(req.headers.authorization || '');
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          throw fail(401, '需要平台实例认证');
        }
        if (path === '/_platform/health' && method === 'GET') {
          return res.writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ protocolVersion: 1, instanceId: managed.instanceId, status: 'ok' }));
        }
      }

      if (path === '/v1/chat/completions' && method === 'POST') {
        const body = await readBody(req);
        if (!Array.isArray(body.messages) || !body.messages.length) throw fail(400, 'messages 不能为空');
        const upstream = { ...body, model: body.model || env.DEEPSEEK_MODEL || 'deepseek-flash', stream: false };
        const { response, signal } = await post('https://api.deepseek.com/chat/completions', upstream,
          { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` }, 'DeepSeek', controller.signal);
        const data = await json(response, 'DeepSeek', signal);
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      }

      if (path === '/v1/audio/speech' && method === 'POST') {
        const body = await readBody(req);
        const { input, voice } = body;
        if (typeof input !== 'string' || !input.trim()) throw fail(400, 'input 不能为空，且必须是文本');
        if (voice !== undefined && (typeof voice !== 'string' || !voice.trim())) throw fail(400, 'voice 必须是非空音色 ID');
        const service = 'Fish Audio';
        const { response, signal } = await post('https://api.fish.audio/v1/tts', {
          text: input, reference_id: voice?.trim() || fishReferenceId, format: 'mp3',
        }, { Authorization: `Bearer ${fishApiKey}`, model: fishModel }, service, controller.signal);
        if (!/^audio\//i.test(response.headers.get('content-type') || '')) {
          void response.body?.cancel().catch(() => {});
          throw fail(502, `${service}没有返回有效音频`, 'upstream_error', service);
        }
        let audio;
        try { audio = Buffer.from(await response.arrayBuffer()); }
        catch (error) { throw connectionFailure(error, service, signal); }
        if (!audio.length) throw fail(502, `${service}没有返回有效音频`, 'upstream_error', service);
        return res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length }).end(audio);
      }

      if (path.startsWith('/v1')) throw fail(404, '接口不存在');

      // Managed mode serves only the API; the platform proxy serves the web UI.
      if (managed) throw fail(404, '受管后端不提供静态页面');

      // Static frontend (production build in dist/).
      if (['GET', 'HEAD'].includes(method)) {
        const dist = join(root, 'dist');
        if (existsSync(join(dist, 'index.html'))) {
          const file = path === '/' ? 'index.html' : path.slice(1);
          const target = join(dist, file);
          if (file === 'index.html' || (await stat(target).catch(() => null))?.isFile()) {
            return await serveFile(res, target, extname(target));
          }
          // SPA fallback: return index.html for extension-less paths.
          if (!extname(path)) return await serveFile(res, join(dist, 'index.html'), '.html');
          throw fail(404, '页面不存在');
        }
        throw fail(404, '页面不存在，请先运行 npm run build 或使用开发地址');
      }

      throw fail(404, '页面不存在');
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
      const message = safe(error.message || '服务请求失败');
      if (res.destroyed) return;
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: { message, code: error.code || 'upstream_error',
            retryable: error.retryable ?? status >= 500, service: error.service || 'Readio' } }));
      } else res.end();
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', closed);
    }
  }

  return http.createServer(handle);
}

export { root };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = createApp();
    const port = Number(process.env.PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数');
    server.listen(port, '127.0.0.1', () => console.log(`Readio 服务：http://127.0.0.1:${port}`))
      .on('error', error => { console.error(`服务启动失败：${error.message}`); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
