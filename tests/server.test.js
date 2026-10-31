import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../server.js';

const env = {
  DEEPSEEK_API_KEY: 'test-deepseek-secret',
  DOUBAO_API_KEY: 'test-doubao-api-secret',
  DOUBAO_VOICE: 'test-english-voice',
};
const requiredKeys = ['DEEPSEEK_API_KEY', 'DOUBAO_API_KEY'];
const messages = [{ role: 'user', content: 'Hello.' }];

async function withApp(upstream, run, config = env) {
  const server = createApp(config, upstream).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    return await run({ base, post });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function errorResponse(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const data = await response.json();
  assert.deepEqual(Object.keys(data), ['error']);
  assert.equal(typeof data.error.message, 'string');
  assert.ok(data.error.message.length > 0);
  const serialized = JSON.stringify(data);
  for (const secret of [env.DEEPSEEK_API_KEY, env.DOUBAO_API_KEY]) {
    assert.equal(serialized.includes(secret), false, 'credentials must not appear in responses');
  }
  return data.error.message;
}

test('missing credentials fail before the application starts', () => {
  for (const key of requiredKeys) {
    const missing = { ...env, [key]: '  ' };
    assert.throws(() => createApp(missing), error => error.message.includes(key));
  }
  assert.throws(() => createApp({}), error => requiredKeys.every(key => error.message.includes(key)));
});

test('chat uses the default model, disables streaming, and preserves JSON parameters', async () => {
  const answer = { id: 'chat-test', choices: [{ message: { content: '你好' } }] };
  const messages = [{ role: 'user', content: 'Say hello.' }];
  let calls = 0;
  await withApp(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${env.DEEPSEEK_API_KEY}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, messages);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.temperature, 0.3);
    return Response.json(answer);
  }, async ({ post }) => {
    const response = await post('/v1/chat/completions', {
      messages, stream: true, temperature: 0.3, response_format: { type: 'json_object' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), answer);
  });
  assert.equal(calls, 1);
});

test('chat respects configured and explicitly requested models', async () => {
  const models = [];
  await withApp(async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    return Response.json({ choices: [] });
  }, async ({ post }) => {
    await post('/v1/chat/completions', { messages });
    await post('/v1/chat/completions', { messages, model: 'explicit-model' });
  }, { ...env, DEEPSEEK_MODEL: 'configured-model' });
  assert.deepEqual(models, ['configured-model', 'explicit-model']);
});

function speechFrames(frames, { chunkSize = 11, finalNewline = true } = {}) {
  const bytes = new TextEncoder().encode(frames.map(frame => JSON.stringify(frame)).join('\n') + (finalNewline ? '\n' : ''));
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

test('speech adapts V3 Key-only requests and joins NDJSON audio chunks into MP3', async () => {
  const audio = Buffer.from([0x49, 0x44, 0x33, 0x00, 0xff, 0xe2, 0x41, 0x00]);
  const ids = [];
  const voices = [];
  await withApp(async (url, options) => {
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    assert.equal(options.method, 'POST');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('x-api-key'), env.DOUBAO_API_KEY);
    assert.equal(headers.get('x-api-resource-id'), 'seed-tts-2.0');
    assert.equal(headers.has('x-api-app-id'), false);
    assert.equal(headers.has('authorization'), false);
    assert.match(headers.get('x-api-request-id'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const body = JSON.parse(options.body);
    assert.equal('app' in body, false);
    assert.deepEqual(body.req_params, {
      text: 'Hello, Readio.',
      speaker: body.req_params.speaker,
      audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
    });
    ids.push(headers.get('x-api-request-id'));
    voices.push(body.req_params.speaker);
    return speechFrames([
      { code: 0, message: '成功', data: audio.subarray(0, 3).toString('base64') },
      { code: 0, data: audio.subarray(3).toString('base64') },
      { code: 20000000, message: 'finished' },
    ]);
  }, async ({ post }) => {
    for (const body of [{ input: 'Hello, Readio.' }, { input: 'Hello, Readio.', voice: 'another-voice' }]) {
      const response = await post('/v1/audio/speech', body);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^audio\/mpeg/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
    }
  });
  assert.notEqual(ids[0], ids[1], 'each synthesis request needs a new UUID');
  assert.deepEqual(voices, [env.DOUBAO_VOICE, 'another-voice']);
});

test('speech rejects invalid text and voice before contacting the provider', async () => {
  let calls = 0;
  await withApp(async () => { calls++; throw new Error('must not call upstream'); }, async ({ post }) => {
    for (const body of [
      {}, { input: '' }, { input: '  \n\t' }, { input: 42 }, { input: null },
      { input: 'Hello', voice: 42 }, { input: 'Hello', voice: '' },
    ]) {
      await errorResponse(await post('/v1/audio/speech', body), 400);
    }
  });
  assert.equal(calls, 0);
});

test('speech accepts code 0 with normal EOF and uses optional default voice and resource', async () => {
  const audio = Buffer.from('audio-fixture');
  await withApp(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(typeof body.req_params.speaker, 'string');
    assert.ok(body.req_params.speaker.length > 0);
    assert.equal(new Headers(options.headers).get('x-api-resource-id'), 'custom-resource');
    return speechFrames([{ code: 0, data: audio.toString('base64') }], { finalNewline: false });
  }, async ({ post }) => {
    const response = await post('/v1/audio/speech', { input: 'Hello.' });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
  }, { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY, DOUBAO_API_KEY: env.DOUBAO_API_KEY, DOUBAO_RESOURCE_ID: 'custom-resource' });
});

test('upstream HTTP errors become 502 with a useful reason', async () => {
  await withApp(async () => Response.json({ error: { message: 'quota exhausted' } }, { status: 429 }), async ({ post }) => {
    const message = await errorResponse(await post('/v1/chat/completions', { messages }), 502);
    assert.match(message, /quota exhausted/);
  });
});

test('provider error details cannot echo configured API credentials to the browser', async () => {
  await withApp(async () => Response.json({
    error: { message: `invalid credentials ${env.DEEPSEEK_API_KEY} ${env.DOUBAO_API_KEY}` },
  }, { status: 401 }), async ({ post }) => {
    await errorResponse(await post('/v1/chat/completions', { messages }), 502);
    await errorResponse(await post('/v1/audio/speech', { input: 'Hello.' }), 502);
  });
});

test('speech rejects provider failures even after receiving an audio chunk', async () => {
  for (const prefix of [[], [{ code: 0, data: Buffer.from('partial-audio').toString('base64') }]]) {
    await withApp(async () => speechFrames([...prefix, { code: 45000000, message: 'voice not authorized' }]), async ({ post }) => {
      const message = await errorResponse(await post('/v1/audio/speech', { input: 'Hello.' }), 502);
      assert.match(message, /voice not authorized/);
    });
  }
});

test('speech rejects invalid frames, corrupt audio and streams without audio', async () => {
  const partial = JSON.stringify({ code: 0, data: Buffer.from('partial-audio').toString('base64') });
  for (const text of [
    'not JSON', `${partial}\nnot JSON`, 'null\n', '{}\n',
    JSON.stringify({ code: 0, data: 'not base64%%%' }),
    JSON.stringify({ code: 0, data: 42 }),
    JSON.stringify({ code: 0 }),
    JSON.stringify({ code: 20000000, message: 'finished' }),
    '',
  ]) {
    await withApp(async () => new Response(text), async ({ post }) => {
      await errorResponse(await post('/v1/audio/speech', { input: 'Hello.' }), 502);
    });
  }
});

test('network failures use provider-specific messages without leaking credentials', async () => {
  await withApp(async () => { throw new Error(`network failed ${env.DEEPSEEK_API_KEY}`); }, async ({ post }) => {
    assert.equal(await errorResponse(await post('/v1/chat/completions', { messages }), 502), '无法连接 DeepSeek');
    assert.equal(await errorResponse(await post('/v1/audio/speech', { input: 'Hello.' }), 502), '无法连接豆包语音');
  });
});

test('non-JSON provider responses become structured 502 errors', async () => {
  await withApp(async () => new Response('<html>bad gateway</html>', { status: 502 }), async ({ post }) => {
    await errorResponse(await post('/v1/chat/completions', { messages }), 502);
    await errorResponse(await post('/v1/audio/speech', { input: 'Hello.' }), 502);
  });
});

test('malformed and oversized request bodies return structured errors', async () => {
  let calls = 0;
  await withApp(async () => { calls++; throw new Error('must not call upstream'); }, async ({ base }) => {
    const malformed = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid',
    });
    await errorResponse(malformed, 400);
    const oversized = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'a'.repeat(1024 * 1024) }),
    });
    await errorResponse(oversized, 413);
  });
  assert.equal(calls, 0);
});

test('unknown API routes return JSON 404 instead of the frontend document', async () => {
  await withApp(async () => { throw new Error('must not call upstream'); }, async ({ base, post }) => {
    await errorResponse(await fetch(`${base}/v1/not-found`), 404);
    await errorResponse(await post('/v1/not-found', {}), 404);
    const document = await (await fetch(`${base}/.env`)).text();
    assert.equal(document.includes('DEEPSEEK_API_KEY='), false, 'environment file must not be served');
    assert.equal(document.includes('DOUBAO_API_KEY='), false, 'environment file must not be served');
  });
});
