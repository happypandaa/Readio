import { readFile } from 'node:fs/promises';
import { createApp } from '../server.js';

const audio = await readFile(new URL('./fixtures/short.mp3', import.meta.url));
const calls = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    if (body.response_format) {
      const word = text.match(/单词：([^\n]+)/)?.[1] || 'word';
      if (word.toLowerCase() === 'mystery' && calls.get(key) === 1) return Response.json({ error: { message: '测试查词失败' } }, { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ lemma: word.toLowerCase() === 'habits' ? 'habit' : null,
        phonetic: '/ˈhæbɪt/', pos: 'n.', meaning: '习惯；（这里指）每天反复做的小事' }) } }] });
    }
    return Response.json({ choices: [{ message: { content: '每天读一段，认真听每一句。' } }] });
  }
  const text = body.req_params.text;
  const key = `audio:${text}`;
  calls.set(key, (calls.get(key) || 0) + 1);
  await wait(text.includes('Slow') ? 2500 : 250);
  if (text.includes('Fail audio') && calls.get(key) <= 3) return Response.json({ code: 45000000, message: '测试音频失败' });
  return new Response(JSON.stringify({ code: 0, data: audio.toString('base64') }) + '\n' + JSON.stringify({ code: 20000000 }), { headers: { 'Content-Type': 'application/json' } });
}
createApp({ DEEPSEEK_API_KEY: 'qa-placeholder', DOUBAO_API_KEY: 'qa-placeholder' }, upstream)
  .listen(8790, '127.0.0.1', () => console.log('隔离测试服务 http://127.0.0.1:8790（模拟上游）'));
