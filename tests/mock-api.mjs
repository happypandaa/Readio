import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from '../server.js';

const audio = await readFile(new URL('./fixtures/short.mp3', import.meta.url));
const calls = new Map();
async function upstream(url, options) {
  const body = JSON.parse(options.body);
  if (url.includes('chat/completions')) {
    const text = body.messages.at(-1).content;
    if (text === '__reset_readio_qa__') {
      calls.clear();
      return Response.json({ choices: [{ message: { content: 'readio-qa-reset-ok' } }] });
    }
    const key = `chat:${text}`;
    calls.set(key, (calls.get(key) || 0) + 1);
    await wait(text.includes('Slow') ? 2500 : 350);
    if (text.includes('Fail translation') && calls.get(key) === 1) return Response.json({ error: { message: '测试翻译失败' } }, { status: 503 });
    if (body.response_format && text.startsWith('[')) {
      // 批量翻译：按输入顺序返回同样数量的译文；包含 Broken batch 时返回错误格式，触发逐句翻译。
      const list = JSON.parse(text);
      if (list.some(item => item.includes('Broken batch'))) return Response.json({ choices: [{ message: { content: '{"translations": []}' } }] });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ translations: list.map((_, index) => `批量译文 ${index + 1}`) }) } }] });
    }
    if (body.response_format) {
      const word = text.match(/单词：([^\n]+)/)?.[1] || 'word';
      if (word.toLowerCase() === 'mystery' && calls.get(key) === 1) return Response.json({ error: { message: '测试查词失败' } }, { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ lemma: word.toLowerCase() === 'habits' ? 'habit' : null,
        phonetic: '/ˈhæbɪt/', pos: 'n.', meaning: '习惯；（这里指）每天反复做的小事' }) } }] });
    }
    return Response.json({ choices: [{ message: { content: '每天读一段，认真听每一句。' } }] });
  }
  const { text, format, reference_id: referenceId } = body;
  if (url !== 'https://api.fish.audio/v1/tts' || options.method !== 'POST'
    || typeof text !== 'string' || !text.trim() || format !== 'mp3' || typeof referenceId !== 'string' || !referenceId) {
    return Response.json({ message: '无效的模拟 Fish Audio 请求' }, { status: 400 });
  }
  const key = `audio:${text}`;
  calls.set(key, (calls.get(key) || 0) + 1);
  await wait(text.includes('Slow') ? 2500 : 250, undefined, { signal: options.signal });
  if (text.includes('Invalid key audio')) return Response.json({ error: { message: 'Invalid API key' } }, { status: 401 });
  if (text.includes('No balance audio')) return Response.json({ message: 'insufficient balance' }, { status: 402 });
  if (text.includes('Fail audio') && calls.get(key) <= 3) return Response.json({ message: '测试音频失败' }, { status: 503 });
  return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } });
}
createApp({ DEEPSEEK_API_KEY: 'qa-placeholder', FISH_API_KEY: 'qa-placeholder' }, upstream)
  .listen(8790, '127.0.0.1', () => console.log('隔离测试服务 http://127.0.0.1:8790（模拟上游）'));
