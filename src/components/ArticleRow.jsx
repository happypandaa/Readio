import { useLiveQuery } from 'dexie-react-hooks';
import db from '../db.js';
import { getArticleAudioState } from '../audioState.js';
import AudioGenerationStatus from './AudioGenerationStatus.jsx';

export function ArticleStatus({ article, audios = [] }) {
  const count = article.sentenceCount;
  if (!getArticleAudioState(audios, count).ready) return <AudioGenerationStatus article={article} audios={audios} />;
  const status = article.finished ? `已学完 · 共 ${count} 句` : article.lastStudiedAt != null
    ? `上次学到第 ${article.lastIndex + 1} 句 · 共 ${count} 句` : `未开始 · 共 ${count} 句`;
  return <p className="row-meta num">{status}</p>;
}

export default function ArticleRow({ article, onOpen }) {
  const data = useLiveQuery(async () => {
    const [sentences, audios] = await Promise.all([
      db.sentences.where('articleId').equals(article.id).sortBy('idx'),
      db.audios.where('articleId').equals(article.id).toArray(),
    ]);
    return { sentences, audios };
  }, [article.id]);
  return <li className="row">
    <div className="row-main" role="button" tabIndex={0} onClick={() => onOpen(article.id)} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(article.id); }
    }}>
      <h3 className="row-title">{article.title}</h3>
      <p className="row-prev">{data?.sentences.map(sentence => sentence.text).join(' ')}</p>
      <ArticleStatus article={article} audios={data?.audios} />
    </div>
  </li>;
}
