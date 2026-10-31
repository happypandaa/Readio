import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export function createApp(env = process.env, request = fetch) {
  const required = ['DEEPSEEK_API_KEY', 'DOUBAO_API_KEY'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`请在 .env 中填写：${missing.join('、')}`);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
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
  app.post('/v1/chat/completions', async (req, res) => {
    if (!Array.isArray(req.body?.messages) || !req.body.messages.length) throw fail(400, 'messages 不能为空');
    const body = { ...req.body, model: req.body.model || env.DEEPSEEK_MODEL || 'deepseek-flash', stream: false };
    const response = await post('https://api.deepseek.com/chat/completions', body,
      { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` }, 'DeepSeek');
    res.json(await json(response, 'DeepSeek'));
  });
  app.post('/v1/audio/speech', async (req, res) => {
    const { input, voice } = req.body || {};
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
    res.type('audio/mpeg').send(Buffer.concat(chunks));
  });
  app.use('/v1', (req, res) => res.status(404).json({ error: { message: '接口不存在' } }));
  if (existsSync(join(root, 'dist/index.html'))) {
    app.use(express.static(join(root, 'dist')));
    app.get(/.*/, (req, res) => res.sendFile(join(root, 'dist/index.html')));
  }
  app.use((req, res) => res.status(404).json({ error: { message: '页面不存在，请先运行 npm run build 或使用开发地址' } }));
  app.use((error, req, res, next) => {
    const status = error.status || 502;
    const message = error.type === 'entity.parse.failed' ? '请求 JSON 格式不正确'
      : error.type === 'entity.too.large' ? '请求内容超过 1MB' : safe(error.message || '服务请求失败');
    res.status(status).json({ error: { message } });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = createApp();
    const port = Number(process.env.PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数');
    app.listen(port, '127.0.0.1', () => console.log(`Readio 服务：http://127.0.0.1:${port}`))
      .on('error', error => { console.error(`服务启动失败：${error.message}`); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
