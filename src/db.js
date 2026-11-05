import Dexie from 'dexie';
import { autoTitle, splitSentences } from './text.js';

export const db = new Dexie('readio');
db.version(1).stores({
  articles: '++id, sortAt',
  sentences: '[articleId+idx], articleId',
  audios: 'key, articleId, status',
  lookups: 'key',
  savedSentences: '++id, createdAt, [articleId+idx]',
  savedWords: '++id, createdAt, [articleId+idx]',
  settings: 'key',
});
// v2：音频改为手动生成。从未开始生成过的文章（所有句子都还在排队、没有任何结果）改为"未生成"；
// 已经生成了一部分的文章保持原样，打开应用后继续生成。
db.version(2).stores({}).upgrade(async tx => {
  const audios = tx.table('audios');
  const started = new Set();
  await audios.each(row => { if (row.articleId != null && row.status !== 'pending') started.add(row.articleId); });
  await audios.filter(row => row.status === 'pending' && row.articleId != null && !started.has(row.articleId))
    .modify({ status: 'none' });
});
export default db;

// Every async service captures this value, so replacing a backup cannot revive old data.
let dataEpoch = 0;
export const getDataEpoch = () => dataEpoch;
export const invalidatePendingWork = () => ++dataEpoch;

function savedTable(name) {
  if (name !== 'savedSentences' && name !== 'savedWords') throw new Error('未知收藏类型');
  return db.table(name);
}

function prepareArticle(title, text) {
  if (typeof text !== 'string' || !/[A-Za-z]/.test(text)) throw new Error('没有识别到英文内容');
  const parts = splitSentences(text);
  if (!parts.length) throw new Error('请填写文章正文');
  if (parts.length > 300) throw new Error(`文章太长了，最多支持 300 句，当前约 ${parts.length} 句`);
  const articleTitle = String(title ?? '').trim() || autoTitle(parts[0].text);
  if (String(title ?? '').trim().length > 80) throw new Error('标题最多 80 个字符');
  return { title: articleTitle, parts };
}

async function insertArticle({ title, parts }, audioStatus = 'none') {
  const now = Date.now();
  const id = await db.articles.add({ title, sentenceCount: parts.length, createdAt: now,
    lastStudiedAt: null, sortAt: now, lastIndex: 0, finished: false });
  await db.sentences.bulkAdd(parts.map((part, idx) => ({ ...part, articleId: id, idx, zh: null })));
  await db.audios.bulkAdd(parts.map((_part, idx) => ({ key: `s:${id}:${idx}`, articleId: id,
    status: audioStatus, updatedAt: now })));
  return id;
}

export async function addArticle(title, text, { generateAudio = true } = {}) {
  const prepared = prepareArticle(title, text);
  const id = await db.transaction('rw', db.articles, db.sentences, db.audios,
    () => insertArticle(prepared, generateAudio ? 'pending' : 'none'));
  if (generateAudio) {
    const { enqueueArticle } = await import('./audioQueue.js');
    void enqueueArticle(id).catch(() => {});
  }
  return id;
}

export async function ensureBuiltinArticles(articles) {
  const epoch = getDataEpoch();
  const prepared = articles.map(article => ({ key: article.key, ...prepareArticle(article.title, article.text) }));
  return db.transaction('rw', db.articles, db.sentences, db.audios, db.settings, async () => {
    if (epoch !== getDataEpoch()) return [];
    const installed = new Set((await db.settings.get('builtinArticles'))?.value || []);
    const ids = [];
    for (const article of prepared) {
      if (installed.has(article.key)) continue;
      ids.push(await insertArticle(article));
      installed.add(article.key);
    }
    if (ids.length) await db.settings.put({ key: 'builtinArticles', value: [...installed] });
    return ids;
  });
}

export async function renameArticle(id, title) {
  const value = String(title ?? '').trim();
  if (!value || value.length > 80) throw new Error('标题不能为空，且最多 80 个字符');
  await db.articles.update(id, { title: value });
}

export async function deleteArticle(id) {
  const { stopArticle } = await import('./audioQueue.js');
  await stopArticle(id);
  await db.transaction('rw', db.articles, db.sentences, db.audios, async () => {
    await db.articles.delete(id);
    await db.sentences.where('articleId').equals(id).delete();
    await db.audios.where('articleId').equals(id).delete();
  });
}

export async function touchArticle(id) {
  return db.transaction('rw', db.articles, async () => {
    const article = await db.articles.get(id);
    if (!article) return undefined;
    const now = Date.now();
    const changes = { lastStudiedAt: now, sortAt: now };
    if (article.finished) Object.assign(changes, { finished: false, lastIndex: 0 });
    await db.articles.update(id, changes);
    return { ...article, ...changes };
  });
}

export async function setLastIndex(id, idx) {
  if (!Number.isInteger(idx)) return;
  await db.transaction('rw', db.articles, async () => {
    const article = await db.articles.get(id);
    if (article) await db.articles.update(id, { lastIndex: Math.max(0, Math.min(idx, article.sentenceCount - 1)) });
  });
}

export async function setFinished(id) {
  await db.transaction('rw', db.articles, async () => {
    const article = await db.articles.get(id);
    if (article) await db.articles.update(id, { finished: true, lastIndex: article.sentenceCount - 1 });
  });
}

export async function toggleSavedSentence(article, sentence) {
  const result = await db.transaction('rw', db.savedSentences, async () => {
    const old = await db.savedSentences.where('[articleId+idx]').equals([article.id, sentence.idx]).first();
    if (old) {
      await db.savedSentences.delete(old.id);
      return { saved: false };
    }
    const item = { text: sentence.text, zh: sentence.zh || null,
      zhStatus: sentence.zh ? 'ok' : 'pending', articleId: article.id, articleTitle: article.title,
      idx: sentence.idx, createdAt: Date.now() };
    item.id = await db.savedSentences.add(item);
    return { saved: true, item };
  });
  if (result.saved && !result.item.zh) {
    void import('./api.js').then(({ translateSavedSentence }) => translateSavedSentence(result.item)).catch(() => {});
  }
  return result.saved;
}

export async function toggleSavedWord(article, sentence, word, lookup) {
  return db.transaction('rw', db.savedWords, async () => {
    const old = await db.savedWords.where('[articleId+idx]').equals([article.id, sentence.idx])
      .filter(item => item.word.toLowerCase() === word.toLowerCase()).first();
    if (old) {
      await db.savedWords.delete(old.id);
      return false;
    }
    await db.savedWords.add({ word, lemma: lookup.lemma, phonetic: lookup.phonetic, pos: lookup.pos,
      meaning: lookup.meaning, sentence: sentence.text, articleId: article.id,
      articleTitle: article.title, idx: sentence.idx, createdAt: Date.now() });
    return true;
  });
}

export async function removeSaved(tableName, id) {
  const table = savedTable(tableName);
  return db.transaction('rw', table, async () => {
    const item = await table.get(id);
    if (item) await table.delete(id);
    return item;
  });
}

export async function restoreSaved(tableName, item) {
  if (!item) return;
  const table = savedTable(tableName);
  await db.transaction('rw', table, async () => {
    const duplicates = await table.where('[articleId+idx]').equals([item.articleId, item.idx]).toArray();
    if (duplicates.some(row => tableName === 'savedSentences' || row.word.toLowerCase() === item.word.toLowerCase())) return;
    await table.put(item);
  });
  if (tableName === 'savedSentences' && item.zhStatus === 'pending') {
    void import('./api.js').then(({ translateSavedSentence }) => translateSavedSentence(item)).catch(() => {});
  }
}

export async function getSetting(key, fallback) {
  const item = await db.settings.get(key);
  return item ? item.value : fallback;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
