import assert from 'node:assert/strict';
import test from 'node:test';
import { readBackup, validateBackup } from '../src/backup.js';

function fixture() {
  return {
    app: 'Readio', version: 1, exportedAt: '2026-10-30T10:00:00.000Z',
    data: {
      articles: [{ id: 1, title: 'A story', sentenceCount: 1, createdAt: 1000,
        lastStudiedAt: 2000, sortAt: 2000, lastIndex: 0, finished: false }],
      sentences: [{ articleId: 1, idx: 0, text: 'Hello, world.', paraStart: false, zh: '你好，世界。' }],
      lookups: [{ key: 'hello|Hello, world.', result: { lemma: null, phonetic: '/həˈləʊ/', pos: 'phr.', meaning: '你好' } }],
      savedSentences: [{ id: 1, text: 'Hello, world.', zh: '你好，世界。', zhStatus: 'ok',
        articleId: 1, articleTitle: 'A story', idx: 0, createdAt: 3000 }],
      savedWords: [{ id: 1, word: 'Hello', lemma: null, phonetic: '/həˈləʊ/', pos: 'phr.', meaning: '你好',
        sentence: 'Hello, world.', articleId: 1, articleTitle: 'A story', idx: 0, createdAt: 3000 }],
      settings: [{ key: 'speed', value: 0.8 }, { key: 'lastTab', value: 'words' },
        { key: 'favView', value: { sentences: 'compact', words: 'full' } }],
    },
  };
}

function invalid(change) {
  const data = fixture();
  change(data);
  assert.throws(() => validateBackup(data), { message: '这个文件不是 Readio 备份' });
}

test('a complete backup is validated and detached from the input object', () => {
  const value = fixture();
  const validated = validateBackup(value);
  assert.deepEqual(validated, value);
  validated.data.articles[0].title = 'changed';
  assert.equal(value.data.articles[0].title, 'A story');
});

test('deleted originals are allowed while their snapshots stay complete', () => {
  const value = fixture();
  value.data.articles = [];
  value.data.sentences = [];
  assert.deepEqual(validateBackup(value), value);
});

test('format, table schema, invalid fields and exhausted IDs are rejected', () => {
  invalid(value => value.app = 'Other');
  invalid(value => value.version = 2);
  invalid(value => value.exportedAt = 'yesterday');
  invalid(value => delete value.data.lookups);
  invalid(value => value.data.sentences[0].zh = 42);
  invalid(value => value.data.articles[0].id = Number.MAX_SAFE_INTEGER);
  invalid(value => value.data.audios = []);
});

test('sentence indices, paragraph flags, counts and existing-source links must agree', () => {
  invalid(value => value.data.articles[0].sentenceCount = 2);
  invalid(value => value.data.articles[0].lastIndex = 1);
  invalid(value => value.data.sentences[0].articleId = 5);
  invalid(value => value.data.sentences[0].paraStart = true);
  invalid(value => value.data.savedSentences[0].text = 'A different sentence.');
  invalid(value => value.data.savedWords[0].word = 'absent');
});

test('all primary and semantic duplicate keys are rejected', () => {
  for (const table of ['articles', 'sentences', 'lookups', 'savedSentences', 'savedWords', 'settings']) {
    invalid(value => value.data[table].push(structuredClone(value.data[table][0])));
  }
  invalid(value => value.data.savedWords.push({ ...value.data.savedWords[0], id: 2, word: 'hello' }));
  invalid(value => value.data.savedSentences.push({ ...value.data.savedSentences[0], id: 2 }));
});

test('lookup schemas, translation status and supported settings are enforced', () => {
  invalid(value => value.data.lookups[0].result.pos = 'unexpected');
  invalid(value => value.data.lookups[0].result.phonetic = 'not an IPA field');
  invalid(value => value.data.lookups[0].key = 'HELLO|Hello, world.');
  invalid(value => value.data.savedSentences[0].zh = null);
  invalid(value => value.data.settings[0].value = 99);
  invalid(value => value.data.settings[1].value = 'unknown');
  invalid(value => value.data.settings[2].value.words = 'grid');
  invalid(value => value.data.settings.push({ key: '__proto__', value: {} }));
});

test('builtin article markers allow valid and legacy backups but reject malformed or duplicate keys', () => {
  const value = fixture();
  value.data.settings.push({ key: 'builtinArticles', value: [
    'how-language-shapes-the-way-we-think', 'saying-no-at-work-can-be-good-for-your-health',
  ] });
  assert.deepEqual(validateBackup(value), value);
  assert.deepEqual(validateBackup(fixture()), fixture(), 'older backups need no builtin marker');
  for (const marker of [null, {}, 'article-key', [42], [''], ['same-key', 'same-key'],
    ['../outside'], ['__proto__'], ['a'.repeat(129)], Array.from({ length: 1001 }, (_, index) => `article-${index}`)]) {
    invalid(backup => backup.data.settings.push({ key: 'builtinArticles', value: marker }));
  }
});

test('readBackup validates file bytes, JSON and the complete schema', async () => {
  const value = fixture();
  const file = new Blob([JSON.stringify(value)], { type: 'application/json' });
  assert.deepEqual(await readBackup(file), value);
  await assert.rejects(readBackup(new Blob(['{ broken'])), { message: '这个文件不是 Readio 备份' });
  await assert.rejects(readBackup({ size: 51 * 1024 * 1024, text: () => { throw new Error('must not read oversized file'); } }),
    { message: '这个文件不是 Readio 备份' });
  await assert.rejects(readBackup(new Blob([])), { message: '这个文件不是 Readio 备份' });
});
