import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBatchTranslations } from '../src/api.js';

test('batch translations must match the input count and order', () => {
  assert.deepEqual(parseBatchTranslations('{"translations": [" 第一句 ", "第二句"]}', 2), ['第一句', '第二句']);
  for (const content of ['not json', '{"translations": ["只有一句"]}', '{"translations": ["一", ""]}', '{"translations": "一"}', '[]']) {
    assert.throws(() => parseBatchTranslations(content, 2), /翻译结果格式不正确/);
  }
});
