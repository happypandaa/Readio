import assert from 'node:assert/strict';
import test from 'node:test';
import { getArticleAudioState, isAudioNotStarted } from '../src/audioState.js';

const row = (idx, status = 'ok', extra = {}) => ({ key: `s:1:${idx}`, articleId: 1, status,
  ...(status === 'ok' ? { blob: new Blob(['audio'], { type: 'audio/mpeg' }) } : {}), ...extra });

test('article playback stays blocked until every sentence has usable audio', () => {
  const audios = [row(0), row(1, 'pending'), row(2, 'fail', { error: '网络连接失败' })];
  assert.deepEqual(getArticleAudioState(audios, 3), {
    ready: false, pending: 1, failed: 1, stopped: 0, idle: 0, completed: 1, error: '网络连接失败',
  });
  assert.equal(getArticleAudioState([row(0), row(1), row(2)], 3).ready, true);
});

test('stopping preserves completed progress and exposes the stop reason', () => {
  assert.deepEqual(getArticleAudioState([row(0), row(1, 'stopped', { error: '已停止生成' })], 2), {
    ready: false, pending: 0, failed: 0, stopped: 1, idle: 0, completed: 1, error: '已停止生成',
  });
});

test('missing, duplicate, empty or non-audio records never unlock playback', () => {
  assert.equal(getArticleAudioState([], 0).ready, false);
  assert.equal(getArticleAudioState([row(0)], 2).ready, false);
  assert.equal(getArticleAudioState([row(0), row(0)], 2).ready, false);
  assert.equal(getArticleAudioState([row(0), row(3)], 2).ready, false);
  assert.equal(getArticleAudioState([row(0, 'ok', { blob: new Blob([], { type: 'audio/mpeg' }) })], 1).failed, 1);
  assert.equal(getArticleAudioState([row(0, 'ok', { blob: new Blob(['error'], { type: 'text/html' }) })], 1).ready, false);
});

test('articles that were never generated wait for the user and are not treated as failures', () => {
  const state = getArticleAudioState([row(0, 'none'), row(1, 'none')], 2);
  assert.deepEqual(state, { ready: false, pending: 0, failed: 0, stopped: 0, idle: 2, completed: 0, error: '' });
  assert.equal(isAudioNotStarted(state), true);
  assert.equal(isAudioNotStarted(getArticleAudioState([row(0), row(1, 'none')], 2)), false);
  assert.equal(isAudioNotStarted(getArticleAudioState([row(0, 'pending'), row(1, 'none')], 2)), false);
  assert.equal(isAudioNotStarted(getArticleAudioState([row(0), row(1)], 2)), false);
});
