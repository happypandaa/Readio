const wordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

export function splitSentences(text) {
  const sentences = [];
  for (const paragraph of String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const normalized = paragraph.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    let first = true;
    for (const { segment } of sentenceSegmenter.segment(normalized)) {
      const value = segment.trim();
      if (!value) continue;
      sentences.push({ text: value, paraStart: first && sentences.length > 0 });
      first = false;
    }
  }
  return sentences;
}

export function tokenize(sentence) {
  const text = String(sentence ?? '');
  const tokens = [];
  let offset = 0;
  for (const match of text.matchAll(wordPattern)) {
    if (match.index > offset) tokens.push({ type: 'text', value: text.slice(offset, match.index) });
    tokens.push({ type: 'word', value: match[0] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) tokens.push({ type: 'text', value: text.slice(offset) });
  return tokens;
}

// 1.0 倍速下英文朗读约每分钟 150 词，另加句间停顿约 0.3 秒。
const WORDS_PER_MINUTE = 150;
const SENTENCE_GAP_SECONDS = 0.3;

export function estimateAudioSeconds(texts = []) {
  let words = 0;
  for (const text of texts) words += String(text ?? '').match(wordPattern)?.length || 0;
  if (!words) return 0;
  return Math.round(words / WORDS_PER_MINUTE * 60 + texts.length * SENTENCE_GAP_SECONDS);
}

export function formatAudioDuration(seconds) {
  if (!seconds) return '';
  if (seconds < 60) return '不到 1 分钟';
  return `约 ${Math.round(seconds / 60)} 分钟`;
}

export function autoTitle(firstSentence) {
  const text = String(firstSentence ?? '').trim().replace(/[\p{P}\s]+$/u, '');
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : text;
}
