import assert from 'node:assert/strict';
import test from 'node:test';
import { autoTitle, splitSentences, tokenize } from '../src/text.js';

test('sentence splitting preserves paragraph boundaries and normalizes pasted whitespace', () => {
  assert.deepEqual(splitSentences('  First sentence.\r\nSecond sentence!\r\n\r\n\tA new\t paragraph?  '), [
    { text: 'First sentence.', paraStart: false },
    { text: 'Second sentence!', paraStart: false },
    { text: 'A new paragraph?', paraStart: true },
  ]);
});

test('blank paragraphs do not create sentences or a paragraph start on the first sentence', () => {
  assert.deepEqual(splitSentences('\n\n  \n \nHello.\n\n\n\nGoodbye.'), [
    { text: 'Hello.', paraStart: false }, { text: 'Goodbye.', paraStart: true },
  ]);
  assert.deepEqual(splitSentences(' \n\t '), []);
  assert.deepEqual(splitSentences('A sentence without closing punctuation'), [
    { text: 'A sentence without closing punctuation', paraStart: false },
  ]);
});

test('tokenizing keeps punctuation and numbers intact and allows internal apostrophes and hyphens', () => {
  const value = "“Don't,” she said. It’s well-known—2026!";
  const tokens = tokenize(value);
  assert.equal(tokens.map(token => token.value).join(''), value);
  assert.deepEqual(tokens.filter(token => token.type === 'word').map(token => token.value),
    ["Don't", 'she', 'said', 'It’s', 'well-known']);
  assert.deepEqual(tokenize('42 — !'), [{ type: 'text', value: '42 — !' }]);
  assert.deepEqual(tokenize(''), []);
});

test('tokenization has no state between repeated calls', () => {
  assert.deepEqual(tokenize('Word.'), tokenize('Word.'));
});

test('automatic titles remove ending punctuation and keep at most eight words', () => {
  assert.equal(autoTitle('  We all need a little hope today.  '), 'We all need a little hope today');
  assert.equal(autoTitle('One two three four five six seven eight nine ten.'), 'One two three four five six seven eight…');
  assert.equal(autoTitle('She said, “Hello!”'), 'She said, “Hello');
});
