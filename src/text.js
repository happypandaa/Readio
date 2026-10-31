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

export function autoTitle(firstSentence) {
  const text = String(firstSentence ?? '').trim().replace(/[\p{P}\s]+$/u, '');
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : text;
}
