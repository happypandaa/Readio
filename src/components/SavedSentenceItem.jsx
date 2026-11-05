import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { removeSaved, restoreSaved } from '../db.js';
import { getArticleAudioState } from '../audioState.js';
import { translateSavedSentence } from '../api.js';
import { usePreviewAudio } from '../usePreviewAudio.js';
import { useToast } from '../toast.jsx';
import Icon from './Icon.jsx';

export default function SavedSentenceItem({ item, articleExists, compact = false, expanded = false, onToggle }) {
  const toast = useToast();
  const { playingKey, play, stop } = usePreviewAudio();
  const [retrying, setRetrying] = useState(false);
  const key = articleExists ? `s:${item.articleId}:${item.idx}` : `f:${item.id}`;
  const playing = playingKey === key;
  const ready = useLiveQuery(async () => {
    if (!articleExists) return true;
    const [article, audios] = await Promise.all([
      db.articles.get(item.articleId), db.audios.where('articleId').equals(item.articleId).toArray(),
    ]);
    return Boolean(article && getArticleAudioState(audios, article.sentenceCount).ready);
  }, [articleExists, item.articleId], false);
  const canPlay = !articleExists || ready;
  async function remove() {
    try {
      const previous = await removeSaved('savedSentences', item.id);
      if (playing) stop();
      if (previous) toast('已取消收藏', { label: '撤销', fn: () => restoreSaved('savedSentences', previous).catch(error => toast(error.message)) });
    } catch (error) { toast(error.message); }
  }
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try { await translateSavedSentence(item); }
    catch (error) { toast(error.message); }
    finally { setRetrying(false); }
  }
  const playButton = (iconOnly = false) => <button className={`${iconOnly ? 'ic' : 'act'}${playing ? ' on' : ''}`} disabled={!canPlay && !playing} title={!canPlay && !playing ? '文章音频全部生成后可播放' : playing ? '停止' : '播放'} onClick={event => { event.stopPropagation(); if (canPlay || playing) play(key, item.text); }} aria-label={playing ? '停止' : '播放'}>
    <Icon name={playing ? 'stop' : 'play'} />{!iconOnly && (playing ? '停止' : '播放')}
  </button>;
  if (compact && !expanded) return <div className="fav compact" role="button" tabIndex={0} aria-expanded="false" onClick={onToggle} onKeyDown={event => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onToggle(); }
  }}>
    <p className="fav-en">{item.text}</p>{playButton(true)}
  </div>;
  return <div className="fav">
    <p className="fav-en">{item.text}</p>
    {item.zhStatus === 'ok' && item.zh ? <p className="fav-zh">{item.zh}</p>
      : item.zhStatus === 'fail' && !retrying ? <p className="fav-zh muted">翻译失败 <button className="link" onClick={retry}>重试</button></p>
        : <p className="fav-zh muted">翻译中…</p>}
    <p className="fav-src">{articleExists ? `来自《${item.articleTitle}》第 ${item.idx + 1} 句` : `来自《${item.articleTitle}》（原文已删除）`}</p>
    <div className="fav-acts">
      {playButton()}
      <button className="act" disabled={!articleExists} onClick={() => { stop(); location.hash = `#/study/${item.articleId}?focus=${item.idx}`; }}><Icon name="open" />回到原文</button>
      <button className="act" onClick={remove}><Icon name="starOn" />取消收藏</button>
      {compact && <button className="act" onClick={onToggle}>收起</button>}
    </div>
  </div>;
}
