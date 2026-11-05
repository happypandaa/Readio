import db, { getDataEpoch, invalidatePendingWork } from './db.js';
import { speech } from './api.js';
import { isFatalServiceError } from './serviceError.js';
import { getArticleAudioState } from './audioState.js';

const CONCURRENCY = 3;
const tasks = new Map();
const active = new Set();
let queue = [];
let speechVerified = false;
let blockedError = null;
const stoppedArticles = new Set();

function cancelled() {
  return new DOMException('数据已更新', 'AbortError');
}

function check(task) {
  if (task.epoch !== getDataEpoch() || task.controller.signal.aborted || tasks.get(task.key) !== task) throw cancelled();
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function makeTask(key) {
  const match = /^s:(\d+):\d+$/.exec(key);
  const task = { key, articleId: match ? Number(match[1]) : null, epoch: getDataEpoch(), controller: new AbortController() };
  task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
  // A queued article often has no player waiting for it yet.
  task.promise.catch(() => {});
  tasks.set(key, task);
  return task;
}

function cancelTasks(predicate, error = cancelled()) {
  for (const task of tasks.values()) {
    if (!predicate(task)) continue;
    task.controller.abort();
    task.reject(error);
    tasks.delete(task.key);
  }
  queue = queue.filter(task => tasks.get(task.key) === task);
}

async function failBatch(error, epoch) {
  if (epoch !== getDataEpoch()) return;
  blockedError = error;
  speechVerified = false;
  cancelTasks(() => true, error);
  await db.transaction('rw', db.audios, async () => {
    if (epoch !== getDataEpoch()) return;
    await db.audios.where('status').equals('pending').modify({
      status: 'fail', error: error.message, errorCode: error.code, updatedAt: Date.now(),
    });
  });
}

async function currentSentence(task) {
  check(task);
  const match = /^s:(\d+):(\d+)$/.exec(task.key);
  if (!match) throw cancelled();
  const articleId = Number(match[1]);
  const idx = Number(match[2]);
  const [record, sentence] = await Promise.all([db.audios.get(task.key), db.sentences.get([articleId, idx])]);
  check(task);
  if (!record || !sentence) throw cancelled();
  return { record, sentence };
}

async function generate(task) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { record, sentence } = await currentSentence(task);
    if (record.status === 'ok' && record.blob) return record.blob;
    try {
      const blob = await speech(sentence.text, { signal: task.controller.signal });
      check(task);
      await db.transaction('rw', db.audios, db.sentences, async () => {
        check(task);
        const row = await db.audios.get(task.key);
        const source = await db.sentences.get([sentence.articleId, sentence.idx]);
        if (!row || source?.text !== sentence.text) throw cancelled();
        await db.audios.update(task.key, { status: 'ok', blob, updatedAt: Date.now(), error: null });
      });
      return blob;
    } catch (caught) {
      check(task);
      if (caught.name === 'AbortError') throw caught;
      error = caught;
      if (isFatalServiceError(error)) {
        await failBatch(error, task.epoch);
        throw error;
      }
      if (error.retryable === false) break;
      if (attempt < 2) await delay(attempt === 0 ? 1000 : 3000, task.controller.signal);
    }
  }
  await db.transaction('rw', db.audios, async () => {
    check(task);
    if (await db.audios.get(task.key)) await db.audios.update(task.key, {
      status: 'fail', updatedAt: Date.now(), error: error?.message || '音频生成失败', errorCode: error?.code || null,
    });
  });
  throw error;
}

function pump() {
  // Verify the first real request before starting a batch of concurrent requests.
  while (!blockedError && active.size < (speechVerified ? CONCURRENCY : 1) && queue.length) {
    const task = queue.shift();
    if (task.epoch !== getDataEpoch()) { task.reject(cancelled()); continue; }
    active.add(task);
    void generate(task).then(blob => {
      check(task);
      speechVerified = true;
      task.resolve(blob);
    }).catch(task.reject).finally(() => {
      active.delete(task);
      if (tasks.get(task.key) === task) tasks.delete(task.key);
      pump();
    });
  }
}

function enqueueKey(key) {
  const old = tasks.get(key);
  if (old && old.epoch === getDataEpoch()) return old.promise;
  const task = makeTask(key);
  queue.push(task);
  return task.promise;
}

export async function start() {
  const epoch = getDataEpoch();
  const [articles, pending] = await Promise.all([db.articles.toArray(), db.audios.where('status').equals('pending').toArray()]);
  if (epoch !== getDataEpoch()) return;
  const articleMap = new Map(articles.map(article => [article.id, article]));
  if (blockedError) {
    await failBatch(blockedError, epoch);
    return;
  }
  pending.filter(audio => /^s:\d+:\d+$/.test(audio.key) && articleMap.has(audio.articleId) && !stoppedArticles.has(audio.articleId))
    .sort((a, b) => articleMap.get(a.articleId).createdAt - articleMap.get(b.articleId).createdAt
      || a.articleId - b.articleId || Number(a.key.split(':')[2]) - Number(b.key.split(':')[2]))
    .forEach(audio => enqueueKey(audio.key));
  pump();
}

export async function enqueueArticle(articleId) {
  const epoch = getDataEpoch();
  const pending = await db.audios.where('articleId').equals(articleId).filter(row => row.status === 'pending').toArray();
  if (epoch !== getDataEpoch() || stoppedArticles.has(articleId)) return;
  if (blockedError) {
    await failBatch(blockedError, epoch);
    return;
  }
  pending.sort((a, b) => Number(a.key.split(':')[2]) - Number(b.key.split(':')[2]))
    .forEach(audio => enqueueKey(audio.key));
  pump();
}

export async function retryFailed(articleId) {
  const epoch = getDataEpoch();
  await db.transaction('rw', db.audios, async () => {
    if (epoch !== getDataEpoch()) return;
    await db.audios.where('articleId').equals(articleId).filter(row => row.status === 'fail' || row.status === 'stopped'
      || (row.status === 'ok' && (!(row.blob instanceof Blob) || !row.blob.size || !/^audio\//i.test(row.blob.type))))
      .modify({ status: 'pending', updatedAt: Date.now(), error: null, errorCode: null });
  });
  if (epoch === getDataEpoch()) {
    stoppedArticles.delete(articleId);
    blockedError = null;
    speechVerified = false;
    await enqueueArticle(articleId);
  }
}

export async function stopArticle(articleId) {
  const epoch = getDataEpoch();
  stoppedArticles.add(articleId);
  cancelTasks(task => task.articleId === articleId);
  await db.transaction('rw', db.audios, async () => {
    if (epoch !== getDataEpoch()) return;
    await db.audios.where('articleId').equals(articleId).filter(row => row.status === 'pending')
      .modify({ status: 'stopped', updatedAt: Date.now(), error: null, errorCode: null });
  });
  // A pending enqueue read may have completed while the stop transaction was waiting.
  if (epoch === getDataEpoch()) cancelTasks(task => task.articleId === articleId);
  pump();
}

export async function ensureAudio(key, text) {
  const epoch = getDataEpoch();
  const old = await db.audios.get(key);
  if (epoch !== getDataEpoch()) throw cancelled();
  if (/^s:\d+:\d+$/.test(key)) {
    if (!old) throw new Error('原文已删除');
    const [article, audios] = await Promise.all([
      db.articles.get(old.articleId), db.audios.where('articleId').equals(old.articleId).toArray(),
    ]);
    if (epoch !== getDataEpoch()) throw cancelled();
    if (!article) throw new Error('原文已删除');
    const state = getArticleAudioState(audios, article.sentenceCount);
    if (!state.ready) throw new Error(state.error || (state.stopped ? '音频生成已停止，请继续生成后播放'
      : state.failed ? '音频生成失败，请重试完成后播放' : '整篇音频生成完成后才能播放'));
    return old.blob;
  }
  if (old?.status === 'ok' && old.blob) return old.blob;
  // An on-demand word/favorite request is an explicit retry after configuration is fixed.
  if (blockedError) { blockedError = null; speechVerified = false; }
  const existing = tasks.get(key);
  if (existing && existing.epoch === epoch) return existing.promise;
  if (!/^(w:.+|f:\d+)$/.test(key)) throw new Error('无效音频标识');
  const task = makeTask(key);
  void (async () => {
    try {
      const blob = await speech(text, { signal: task.controller.signal });
      check(task);
      await db.transaction('rw', db.audios, db.savedSentences, async () => {
        check(task);
        if (key.startsWith('f:') && !(await db.savedSentences.get(Number(key.slice(2))))) throw cancelled();
        await db.audios.put({ key, articleId: null, status: 'ok', blob, updatedAt: Date.now() });
      });
      task.resolve(blob);
    } catch (error) {
      if (tasks.get(key) === task && isFatalServiceError(error)) await failBatch(error, epoch);
      task.reject(error);
    }
    finally { if (tasks.get(key) === task) tasks.delete(key); }
  })();
  return task.promise;
}

export function reset() {
  invalidatePendingWork();
  cancelTasks(() => true);
  queue = [];
  active.clear();
  blockedError = null;
  speechVerified = false;
  stoppedArticles.clear();
}
