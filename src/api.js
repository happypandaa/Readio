import db, { getDataEpoch } from './db.js';
import { isFatalServiceError, responseError, serviceError } from './serviceError.js';

const translations = new Map();
const lookups = new Map();
const translationPrompt = '你是英语翻译。把用户给的英文句子翻译成自然、准确的简体中文。只输出译文，不要解释，不要加引号。';
const batchTranslationPrompt = `你是英语翻译。用户会给一个 JSON 数组，每一项是一句英文。把每句翻译成自然、准确的简体中文。
返回 JSON：{"translations": [译文1, 译文2, ...]}，数量和顺序必须与输入完全一致。只输出 JSON。`;
const lookupPrompt = `你是英语词典助手。根据单词在给定句子中的用法，返回 JSON：
{"lemma": 原形（与原词相同则为 null）, "phonetic": 美式音标，带斜杠, "pos": 词性缩写（n. v. adj. adv. prep. conj. pron. phr. 之一）, "meaning": 中文释义}
meaning 要求：先给最常见的义项，再用"（这里指）……"说明在这句话里的意思；不超过 40 个汉字。只输出 JSON。`;

async function post(path, body, signal) {
  let response;
  const timeout = AbortSignal.timeout(90000);
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止生成', 'AbortError');
    if (timeout.aborted) throw serviceError('生成失败：网络请求超时，请检查网络后重试', { code: 'timeout', retryable: true });
    if (error.name === 'AbortError') throw error;
    throw serviceError('连接不上服务，请确认本地服务已启动', { code: 'network_error', retryable: true });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw responseError(response.status, data);
  }
  return response;
}

export async function chat(messages, { json = false, signal } = {}) {
  const response = await post('/v1/chat/completions', { messages, temperature: 0.3,
    thinking: { type: 'disabled' }, stream: false,
    ...(json ? { response_format: { type: 'json_object' } } : {}) }, signal);
  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('生成失败：服务返回了空内容');
  return content.trim();
}

export async function speech(text, { signal } = {}) {
  const response = await post('/v1/audio/speech', { input: text }, signal);
  const blob = await response.blob();
  if (!blob.size || !/^audio\//i.test(blob.type)) throw new Error('生成失败：服务没有返回有效音频');
  return blob;
}

function assertEpoch(epoch) {
  if (epoch !== getDataEpoch()) throw new Error('数据已更新，请重试');
}

function translateText(text, epoch) {
  const key = `${epoch}:${text}`;
  if (translations.has(key)) return translations.get(key);
  const task = chat([{ role: 'system', content: translationPrompt }, { role: 'user', content: text }])
    .then(zh => { assertEpoch(epoch); return zh; })
    .finally(() => { if (translations.get(key) === task) translations.delete(key); });
  translations.set(key, task);
  return task;
}

async function updateTranslation(sentence, zh, epoch) {
  await db.transaction('rw', db.sentences, db.savedSentences, async () => {
    assertEpoch(epoch);
    const original = await db.sentences.get([sentence.articleId, sentence.idx]);
    if (original?.text === sentence.text) await db.sentences.update([sentence.articleId, sentence.idx], { zh });
    await db.savedSentences.where('[articleId+idx]').equals([sentence.articleId, sentence.idx])
      .filter(item => item.text === sentence.text).modify({ zh, zhStatus: 'ok' });
  });
}

export async function translateSentence(sentence) {
  const epoch = getDataEpoch();
  const original = await db.sentences.get([sentence.articleId, sentence.idx]);
  assertEpoch(epoch);
  const zh = (original?.text === sentence.text && original.zh) || sentence.zh || await translateText(sentence.text, epoch);
  await updateTranslation(sentence, zh, epoch);
  return zh;
}

export async function translateSavedSentence(item) {
  const epoch = getDataEpoch();
  const current = await db.savedSentences.get(item.id);
  assertEpoch(epoch);
  if (!current || current.text !== item.text) return item.zh || null;
  if (current.zh && current.zhStatus === 'ok') return current.zh;
  await db.transaction('rw', db.savedSentences, async () => {
    assertEpoch(epoch);
    await db.savedSentences.update(item.id, { zhStatus: 'pending' });
  });
  try {
    const original = await db.sentences.get([current.articleId, current.idx]);
    assertEpoch(epoch);
    const zh = (original?.text === current.text && original.zh) || await translateText(current.text, epoch);
    await updateTranslation({ ...current, articleId: current.articleId }, zh, epoch);
    return zh;
  } catch (error) {
    if (epoch === getDataEpoch()) await db.transaction('rw', db.savedSentences, async () => {
      if (epoch !== getDataEpoch()) return;
      const row = await db.savedSentences.get(current.id);
      if (row?.text === current.text) await db.savedSentences.update(current.id, { zhStatus: 'fail' });
    });
    throw error;
  }
}

export const TRANSLATION_BATCH_SIZE = 10;
const TRANSLATION_CONCURRENCY = 2;

export function parseBatchTranslations(content, count) {
  let list;
  try { list = JSON.parse(content)?.translations; } catch { list = null; }
  if (!Array.isArray(list) || list.length !== count
    || !list.every(item => typeof item === 'string' && item.trim() && item.length <= 2000)) throw new Error('翻译结果格式不正确');
  return list.map(item => item.trim());
}

async function translateChunk(chunk, epoch, signal) {
  let list = null;
  try {
    const content = await chat([{ role: 'system', content: batchTranslationPrompt },
      { role: 'user', content: JSON.stringify(chunk.map(sentence => sentence.text)) }], { json: true, signal });
    list = parseBatchTranslations(content, chunk.length);
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError' || isFatalServiceError(error)) throw error;
  }
  if (list) {
    for (const [index, sentence] of chunk.entries()) await updateTranslation(sentence, list[index], epoch);
    return 0;
  }
  // 整组返回格式不对时退回逐句翻译，只有逐句也失败的句子才算失败。
  let failed = 0;
  for (const sentence of chunk) {
    if (signal?.aborted) throw new DOMException('已停止翻译', 'AbortError');
    try { await translateSentence(sentence); }
    catch (error) { if (isFatalServiceError(error)) throw error; failed++; }
  }
  return failed;
}

// 翻译整篇文章里还没有译文的句子。返回失败的句数；停止时抛出 AbortError。
export async function translateArticle(articleId, { signal } = {}) {
  const epoch = getDataEpoch();
  const rows = (await db.sentences.where('articleId').equals(articleId).sortBy('idx')).filter(sentence => !sentence.zh);
  assertEpoch(epoch);
  const chunks = [];
  for (let at = 0; at < rows.length; at += TRANSLATION_BATCH_SIZE) chunks.push(rows.slice(at, at + TRANSLATION_BATCH_SIZE));
  let next = 0;
  let failed = 0;
  let fatal = null;
  await Promise.all(Array.from({ length: Math.min(TRANSLATION_CONCURRENCY, chunks.length) }, async () => {
    while (!fatal && next < chunks.length && !signal?.aborted) {
      const chunk = chunks[next++];
      try { failed += await translateChunk(chunk, epoch, signal); }
      catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) return;
        if (isFatalServiceError(error)) fatal = error;
        else failed += chunk.length;
      }
    }
  }));
  if (fatal) throw fatal;
  if (signal?.aborted) throw new DOMException('已停止翻译', 'AbortError');
  return failed;
}

export function validateLookup(result) {
  const positions = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'phr.'];
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !(result.lemma === null || (typeof result.lemma === 'string' && result.lemma.trim() && result.lemma.length <= 200))
    || typeof result.phonetic !== 'string' || !/^\/.+\/$/.test(result.phonetic) || result.phonetic.length > 200
    || !positions.includes(result.pos) || typeof result.meaning !== 'string' || !result.meaning.trim() || result.meaning.length > 200) {
    throw new Error('查询失败');
  }
  return { lemma: result.lemma, phonetic: result.phonetic, pos: result.pos, meaning: result.meaning.trim() };
}

export async function lookupWord(word, sentenceText) {
  const epoch = getDataEpoch();
  const key = `${word.toLowerCase()}|${sentenceText}`;
  const cached = await db.lookups.get(key);
  assertEpoch(epoch);
  if (cached) return validateLookup(cached.result);
  const taskKey = `${epoch}:${key}`;
  if (lookups.has(taskKey)) return lookups.get(taskKey);
  const task = (async () => {
    const content = await chat([{ role: 'system', content: lookupPrompt },
      { role: 'user', content: `单词：${word}\n句子：${sentenceText}` }], { json: true });
    let result;
    try { result = validateLookup(JSON.parse(content)); } catch { throw new Error('查询失败'); }
    await db.transaction('rw', db.lookups, async () => {
      assertEpoch(epoch);
      await db.lookups.put({ key, result });
    });
    return result;
  })().finally(() => { if (lookups.get(taskKey) === task) lookups.delete(taskKey); });
  lookups.set(taskKey, task);
  return task;
}

export async function resumeTranslations() {
  const epoch = getDataEpoch();
  const pending = await db.savedSentences.filter(item => item.zhStatus === 'pending').toArray();
  if (epoch !== getDataEpoch()) return;
  // Bound startup requests; saved translations are independent from the audio queue.
  let next = 0;
  let fatalError = null;
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (!fatalError && next < pending.length && epoch === getDataEpoch()) {
      const item = pending[next++];
      await translateSavedSentence(item).catch(error => { if (isFatalServiceError(error)) fatalError = error; });
    }
  }));
  if (fatalError && epoch === getDataEpoch()) {
    await db.transaction('rw', db.savedSentences, async () => {
      if (epoch === getDataEpoch()) await db.savedSentences.filter(item => item.zhStatus === 'pending').modify({ zhStatus: 'fail' });
    });
    throw fatalError;
  }
}
