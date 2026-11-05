import language from './content/how-language-shapes-the-way-we-think.txt?raw';
import work from './content/saying-no-at-work-can-be-good-for-your-health.txt?raw';

function article(key, source) {
  const [title, ...body] = source.replace(/\r/g, '').trim().split('\n');
  return { key, title: title.trim(), text: body.join('\n').trim() };
}

export const builtinArticles = [
  article('how-language-shapes-the-way-we-think', language),
  article('saying-no-at-work-can-be-good-for-your-health', work),
];
