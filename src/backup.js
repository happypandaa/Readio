import db from './db.js';
import { reset, start } from './audioQueue.js';
import { resumeTranslations, validateLookup } from './api.js';

const TABLES = ['articles', 'sentences', 'lookups', 'savedSentences', 'savedWords', 'settings'];
const MAX_BYTES = 50 * 1024 * 1024;
const INVALID = '这个文件不是 Readio 备份';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const id = value => integer(value) && value > 0 && value < 2147483647;
const text = (value, max = MAX_BYTES) => typeof value === 'string' && value.length <= max && value.trim().length > 0;
const timestamp = value => integer(value) && value <= 8640000000000000;
const nullableText = value => value === null || text(value);
function requireValid(condition) { if (!condition) throw new Error(INVALID); }
function fields(row, names) {
  requireValid(isObject(row) && Object.keys(row).length === names.length && names.every(name => Object.hasOwn(row, name)));
}
function unique(seen, key) { requireValid(!seen.has(key)); seen.add(key); }

export function validateBackup(input) {
  try {
    requireValid(isObject(input));
    const serialized = JSON.stringify(input);
    requireValid(serialized && new TextEncoder().encode(serialized).byteLength <= MAX_BYTES);
    fields(input, ['app', 'version', 'exportedAt', 'data']);
    requireValid(input.app === 'Readio' && input.version === 1 && typeof input.exportedAt === 'string'
      && Number.isFinite(Date.parse(input.exportedAt)));
    fields(input.data, TABLES);
    requireValid(TABLES.every(name => Array.isArray(input.data[name])));
    requireValid(TABLES.reduce((count, name) => count + input.data[name].length, 0) <= 500000);
    const { articles, sentences, lookups, savedSentences, savedWords, settings } = input.data;
    requireValid(articles.length <= 10000);
    const articleMap = new Map();
    for (const row of articles) {
      fields(row, ['id', 'title', 'sentenceCount', 'createdAt', 'lastStudiedAt', 'sortAt', 'lastIndex', 'finished']);
      requireValid(id(row.id) && text(row.title) && integer(row.sentenceCount) && row.sentenceCount >= 1
        && row.sentenceCount <= 300 && timestamp(row.createdAt)
        && (row.lastStudiedAt === null || timestamp(row.lastStudiedAt))
        && row.sortAt === (row.lastStudiedAt ?? row.createdAt)
        && integer(row.lastIndex) && row.lastIndex < row.sentenceCount && typeof row.finished === 'boolean');
      requireValid(!articleMap.has(row.id));
      articleMap.set(row.id, row);
    }
    const sentenceMap = new Map();
    const sentenceCounts = new Map();
    for (const row of sentences) {
      fields(row, ['articleId', 'idx', 'text', 'paraStart', 'zh']);
      const article = articleMap.get(row.articleId);
      requireValid(article && integer(row.idx) && row.idx < article.sentenceCount && text(row.text)
        && typeof row.paraStart === 'boolean' && (row.idx !== 0 || row.paraStart === false) && nullableText(row.zh));
      const key = `${row.articleId}:${row.idx}`;
      requireValid(!sentenceMap.has(key));
      sentenceMap.set(key, row);
      sentenceCounts.set(row.articleId, (sentenceCounts.get(row.articleId) || 0) + 1);
    }
    for (const article of articles) requireValid(sentenceCounts.get(article.id) === article.sentenceCount);
    const lookupKeys = new Set();
    for (const row of lookups) {
      fields(row, ['key', 'result']);
      requireValid(text(row.key));
      const delimiter = row.key.indexOf('|');
      const word = row.key.slice(0, delimiter);
      requireValid(delimiter > 0 && word === word.toLowerCase() && /^[a-z]+(?:['’-][a-z]+)*$/.test(word)
        && text(row.key.slice(delimiter + 1)));
      fields(row.result, ['lemma', 'phonetic', 'pos', 'meaning']);
      validateLookup(row.result);
      unique(lookupKeys, row.key);
    }
    const savedIds = { savedSentences: new Set(), savedWords: new Set() };
    const savedKeys = { savedSentences: new Set(), savedWords: new Set() };
    const checkSaved = (row, table) => {
      requireValid(id(row.id) && id(row.articleId) && integer(row.idx) && row.idx < 300
        && text(row.articleTitle) && timestamp(row.createdAt));
      unique(savedIds[table], row.id);
      const original = sentenceMap.get(`${row.articleId}:${row.idx}`);
      if (articleMap.has(row.articleId)) requireValid(original && original.text === (table === 'savedSentences' ? row.text : row.sentence));
      unique(savedKeys[table], `${row.articleId}:${row.idx}${table === 'savedWords' ? `:${row.word.toLowerCase()}` : ''}`);
    };
    for (const row of savedSentences) {
      fields(row, ['id', 'text', 'zh', 'zhStatus', 'articleId', 'articleTitle', 'idx', 'createdAt']);
      requireValid(text(row.text) && nullableText(row.zh) && ['pending', 'ok', 'fail'].includes(row.zhStatus)
        && (row.zhStatus !== 'ok' || text(row.zh)));
      checkSaved(row, 'savedSentences');
    }
    for (const row of savedWords) {
      fields(row, ['id', 'word', 'lemma', 'phonetic', 'pos', 'meaning', 'sentence', 'articleId', 'articleTitle', 'idx', 'createdAt']);
      requireValid(text(row.word, 200) && /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(row.word) && text(row.sentence));
      validateLookup({ lemma: row.lemma, phonetic: row.phonetic, pos: row.pos, meaning: row.meaning });
      const wordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
      requireValid([...row.sentence.matchAll(wordPattern)].some(match => match[0].toLowerCase() === row.word.toLowerCase()));
      checkSaved(row, 'savedWords');
    }
    const settingKeys = new Set();
    for (const row of settings) {
      fields(row, ['key', 'value']);
      requireValid(['speed', 'lastTab', 'favView', 'builtinArticles'].includes(row.key));
      unique(settingKeys, row.key);
      if (row.key === 'speed') requireValid([0.6, 0.8, 1, 1.2, 1.5].includes(row.value));
      if (row.key === 'lastTab') requireValid(['articles', 'sentences', 'words'].includes(row.value));
      if (row.key === 'favView') {
        fields(row.value, ['sentences', 'words']);
        requireValid(['full', 'compact'].includes(row.value.sentences) && ['full', 'compact'].includes(row.value.words));
      }
      if (row.key === 'builtinArticles') requireValid(Array.isArray(row.value) && row.value.length <= 1000
        && row.value.every(key => typeof key === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(key))
        && new Set(row.value).size === row.value.length);
    }
    // Drop object identity and inherited values before any database write.
    return JSON.parse(serialized);
  } catch { throw new Error(INVALID); }
}

export async function exportBackup() {
  const data = await db.transaction('r', TABLES.map(name => db.table(name)), async () => {
    const entries = await Promise.all(TABLES.map(async name => [name, await db.table(name).toArray()]));
    return Object.fromEntries(entries);
  });
  const backup = validateBackup({ app: 'Readio', version: 1, exportedAt: new Date().toISOString(), data });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `readio-backup-${date}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup;
}

export async function readBackup(file) {
  try {
    requireValid(file && typeof file.text === 'function' && file.size <= MAX_BYTES && file.size > 0);
    return validateBackup(JSON.parse(await file.text()));
  } catch { throw new Error(INVALID); }
}

export async function importBackup(input) {
  const backup = validateBackup(input);
  reset();
  try {
    await db.transaction('rw', db.tables, async () => {
      const installed = (await db.settings.get('builtinArticles'))?.value || [];
      for (const table of db.tables) await table.clear();
      for (const name of TABLES) if (backup.data[name].length) await db.table(name).bulkAdd(backup.data[name]);
      const imported = (await db.settings.get('builtinArticles'))?.value || [];
      const builtinKeys = [...new Set([...installed, ...imported])];
      if (builtinKeys.length) await db.settings.put({ key: 'builtinArticles', value: builtinKeys });
      const now = Date.now();
      if (backup.data.sentences.length) await db.audios.bulkAdd(backup.data.sentences.map(sentence => ({
        key: `s:${sentence.articleId}:${sentence.idx}`, articleId: sentence.articleId, status: 'pending', updatedAt: now,
      })));
      // clear() preserves IndexedDB's generator. Also reserve IDs belonging to imported orphaned favorites.
      const referencedIds = [...backup.data.articles.map(row => row.id), ...backup.data.savedSentences.map(row => row.articleId),
        ...backup.data.savedWords.map(row => row.articleId)];
      const highWater = referencedIds.reduce((highest, value) => Math.max(highest, value), 0);
      if (highWater && !(await db.articles.get(highWater))) {
        await db.articles.add({ id: highWater });
        await db.articles.delete(highWater);
      }
    });
  } finally {
    // A failed transaction rolled back; resume its original pending work as well.
    void start().catch(() => {});
    void resumeTranslations().catch(() => {});
  }
}
