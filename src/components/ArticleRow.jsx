import { useLiveQuery } from 'dexie-react-hooks';
import db from '../db.js';
import { retryFailed } from '../audioQueue.js';
import { useToast } from '../toast.jsx';

export function ArticleStatus({ article, audios = [] }) {
  const toast = useToast();
  const pending = audios.filter(audio => audio.status === 'pending').length;
  const failed = audios.filter(audio => audio.status === 'fail').length;
  const count = article.sentenceCount;
  if (pending) return <p className="row-meta gen"><span className="pulse" /><span className="num">正在生成音频 {count - pending}/{count}</span></p>;
  if (failed) return <p className="row-meta fail"><span className="num">{failed} 句音频生成失败</span><button className="link" onClick={event => {
    event.stopPropagation();
    retryFailed(article.id).catch(error => toast(error.message));
  }}>重试</button></p>;
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
