import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { deleteArticle, renameArticle } from '../db.js';
import { tokenize } from '../text.js';
import { useToast } from '../toast.jsx';
import { usePreviewAudio } from '../usePreviewAudio.js';
import Icon from './Icon.jsx';
import ConfirmDialog, { useDialog } from './ConfirmDialog.jsx';
import { ArticleStatus } from './ArticleRow.jsx';

export default function ArticleDialog({ articleId, onClose }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const titleRef = useRef(null);
  const toast = useToast();
  const { playingKey, play, stop } = usePreviewAudio();
  const ref = useDialog(() => { if (!saving) { if (editing) setEditing(false); else onClose(); } });
  const data = useLiveQuery(async () => {
    const [article, sentences, words, audios] = await Promise.all([
      db.articles.get(articleId),
      db.sentences.where('articleId').equals(articleId).sortBy('idx'),
      db.savedWords.where('[articleId+idx]').between([articleId, -Infinity], [articleId, Infinity]).toArray(),
      db.audios.where('articleId').equals(articleId).toArray(),
    ]);
    const position = word => tokenize(sentences.find(sentence => sentence.idx === word.idx)?.text || '')
      .findIndex(token => token.type === 'word' && token.value.toLowerCase() === word.word.toLowerCase());
    words.sort((left, right) => left.idx - right.idx || position(left) - position(right));
    return { article, sentences, words, audios };
  }, [articleId]);
  useEffect(() => { if (data && !data.article) onClose(); }, [data, onClose]);
  useEffect(() => { if (data?.article) ref.current?.querySelector('button')?.focus({ preventScroll: true }); }, [data?.article?.id]);
  useEffect(() => { if (editing) titleRef.current?.select(); }, [editing]);
  const paragraphs = useMemo(() => {
    const result = [];
    for (const sentence of data?.sentences || []) {
      if (!result.length || sentence.paraStart) result.push([]);
      result.at(-1).push(sentence);
    }
    return result;
  }, [data?.sentences]);
  if (!data?.article) return null;
  const { article, words, audios } = data;
  const saved = new Set(words.map(word => `${word.idx}|${word.word.toLowerCase()}`));
  async function save(event) {
    event.preventDefault();
    if (saving || !title.trim()) return;
    setSaving(true);
    try { await renameArticle(article.id, title); setEditing(false); }
    catch (error) { toast(error.message); }
    finally { setSaving(false); }
  }
  function study(focus) {
    stop(); onClose();
    location.hash = `#/study/${article.id}${focus == null ? '' : `?focus=${focus}`}`;
  }
  const button = article.finished ? '重新学习' : article.lastStudiedAt != null ? `继续学习（第 ${article.lastIndex + 1} 句）` : '开始学习';
  return createPortal(<>
    <div className="scrim" onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="dialog article" role="dialog" aria-modal="true" aria-labelledby="articleTitle" ref={ref} tabIndex={-1}>
        <div className="ad-head">
          <div className="ad-title" id="articleTitle">{editing ? <form key="edit-title" onSubmit={save}>
            <input className="input" maxLength={80} value={title} onChange={event => setTitle(event.target.value)} aria-label="标题" ref={titleRef} disabled={saving} />
            <button type="submit" className="btn primary sm" disabled={!title.trim() || saving}>保存</button>
            <button className="btn ghost sm" type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button>
          </form> : <><h2 className="ad-heading">{article.title}</h2><button className="ic" onClick={() => { setTitle(article.title); setEditing(true); }} aria-label="修改标题" title="修改标题"><Icon name="edit" /></button></>}</div>
          <button className="ic" onClick={onClose} disabled={saving} aria-label="关闭"><Icon name="close" /></button>
        </div>
        <div className="ad-meta"><ArticleStatus article={article} audios={audios} /></div>
        <div className="ad-body">
          <div className="ad-text">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph.map((sentence, at) => <span key={sentence.idx}>
            {at > 0 ? ' ' : ''}{tokenize(sentence.text).map((token, part) => token.type === 'word' && saved.has(`${sentence.idx}|${token.value.toLowerCase()}`)
              ? <span className="saved" key={part}>{token.value}</span> : token.value)}
          </span>)}</p>)}</div>
          <section className="ad-words">
            <h3>本文收藏的生词 <span className="cnt num">{words.length}</span></h3>
            {words.length ? words.map(word => {
              const key = `w:${word.word.toLowerCase()}`;
              return <div className="adw" key={word.id}>
                <div><span className="adw-word">{word.word}</span><span className="phon">{word.phonetic}</span>
                  <p className="def"><span className="pos">{word.pos}</span>{word.meaning}</p></div>
                <div className="adw-acts">
                  <button className={`ic${playingKey === key ? ' speaking' : ''}`} onClick={() => play(key, word.word)} aria-label="发音"><Icon name="speaker" /></button>
                  <button className="ic" onClick={() => study(word.idx)} aria-label="回到原文" title="回到原文"><Icon name="open" /></button>
                </div>
              </div>;
            }) : <p className="ad-empty">还没有收藏生词。学习时点击单词，就可以查看释义并收藏。</p>}
          </section>
        </div>
        <div className="ad-foot">
          <button className="btn danger-text" onClick={() => setConfirm(true)}>删除文章</button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => study()}>{button}</button>
        </div>
      </div>
    </div>
    {confirm && <ConfirmDialog title="删除这篇文章？" desc="文章和音频会被删除，已收藏的句子和生词会保留。" ok="删除" danger onClose={() => setConfirm(false)} onConfirm={async () => {
      stop(); await deleteArticle(article.id); onClose(); toast(`已删除《${article.title}》`);
    }} />}
  </>, document.body);
}
