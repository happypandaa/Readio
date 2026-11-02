import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

export function createApp(env = process.env, request = fetch, options = {}) {
  const managed = options.managed || null;
  const missing = ['DEEPSEEK_API_KEY', 'DOUBAO_API_KEY'].filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`请填写：${missing.join('、')}`);

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const safe = message => [env.DEEPSEEK_API_KEY, env.DOUBAO_API_KEY].reduce(
    (text, secret) => text.replaceAll(secret, '[已隐藏]'), String(message)).slice(0, 200);

  async function post(url, body, headers, service) {
    let response;
    try {
      response = await request(url, { method: 'POST', signal: AbortSignal.timeout(120_000),
        headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw fail(502, service === 'DeepSeek' ? '无法连接 DeepSeek' : '无法连接豆包语音'); }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw fail(502, safe(data?.error?.message || data?.message || `${service} HTTP ${response.status}`));
    }
    return response;
  }

  async function json(response, service) {
    let data;
    try { data = await response.json(); }
    catch { throw fail(502, `${service}返回了无效响应（HTTP ${response.status}）`); }
    if (data?.error) throw fail(502, safe(data.error.message || `${service}请求失败`));
    if (!data || typeof data !== 'object') throw fail(502, `${service}返回了无效响应`);
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
        const response = await post('https://api.deepseek.com/chat/completions', upstream,
          { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` }, 'DeepSeek');
        const data = await json(response, 'DeepSeek');
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      }

      if (path === '/v1/audio/speech' && method === 'POST') {
        const body = await readBody(req);
        const { input, voice } = body;
        if (typeof input !== 'string' || !input.trim()) throw fail(400, 'input 不能为空，且必须是文本');
        if (voice !== undefined && (typeof voice !== 'string' || !voice.trim())) throw fail(400, 'voice 必须是非空音色 ID');
        const response = await post('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
          req_params: { text: input, speaker: voice || env.DOUBAO_VOICE || 'en_female_zendaya_p1_uranus_bigtts',
            audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 0 } },
        }, { 'X-Api-Key': env.DOUBAO_API_KEY, 'X-Api-Resource-Id': env.DOUBAO_RESOURCE_ID || 'seed-tts-2.0',
          'X-Api-Request-Id': randomUUID() }, '豆包语音');
        let text;
        try { text = await response.text(); } catch { throw fail(502, '无法连接豆包语音'); }
        const chunks = [];
        for (const line of text.split(/\r?\n/).filter(line => line.trim())) {
          let data;
          try { data = JSON.parse(line); } catch { throw fail(502, '豆包语音返回了无效响应'); }
          if (!data || ![0, 20000000].includes(data.code)) throw fail(502, safe(`${data?.message || data?.error?.message || '豆包语音合成失败'}（${data?.code ?? '无状态码'}）`));
          if (!data.data) continue;
          if (typeof data.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) throw fail(502, '豆包语音没有返回有效音频');
          chunks.push(Buffer.from(data.data, 'base64'));
        }
        if (!chunks.length) throw fail(502, '豆包语音没有返回有效音频');
        return res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': Buffer.concat(chunks).length })
          .end(Buffer.concat(chunks));
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
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: { message } }));
      } else res.end();
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
