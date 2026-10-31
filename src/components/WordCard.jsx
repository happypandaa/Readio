import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lookupWord } from '../api.js';
import { toggleSavedWord } from '../db.js';
import { errorMessage, useToast } from '../toast.jsx';
import { usePreviewAudio } from '../usePreviewAudio.js';
import Icon from './Icon.jsx';

export default function WordCard({ article, sentence, selection, saved, onClose }) {
  const toast = useToast();
  const { playingKey, play, stop } = usePreviewAudio();
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ loading: true, result: null, failed: false });
  const [position, setPosition] = useState({ visibility: 'hidden' });
  const [saving, setSaving] = useState(false);
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const key = `w:${selection.word.toLowerCase()}`;

  useEffect(() => {
    let alive = true;
    setState({ loading: true, result: null, failed: false });
    lookupWord(selection.word, sentence.text).then(result => {
      if (alive) setState({ loading: false, result, failed: false });
    }).catch(() => { if (alive) setState({ loading: false, result: null, failed: true }); });
    return () => { alive = false; };
  }, [selection.word, sentence.text, requestId]);
  useEffect(() => {
    const outside = event => {
      if (!cardRef.current?.contains(event.target) && !event.target.closest?.('.w')) closeRef.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); stop(); };
  }, [stop]);
  useLayoutEffect(() => {
    let alive = true;
    let frame = null;
    const text = document.getElementById('sents');
    const place = () => {
      const card = cardRef.current;
      if (!alive || !card?.isConnected) return;
      const anchor = selection.element?.isConnected ? selection.element
        : text?.querySelector(`.sx[data-i="${selection.idx}"] .w.sel`);
      if (!anchor?.isConnected) { closeRef.current(); return; }
      if (window.innerWidth <= 640) {
        setPosition(previous => Object.keys(previous).length ? {} : previous);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      let top = rect.bottom + window.scrollY + 8;
      if (rect.bottom + 8 + card.offsetHeight > window.innerHeight - 130) top = rect.top + window.scrollY - card.offsetHeight - 8;
      const next = { top: Math.max(window.scrollY + 64, top), left: Math.max(12, Math.min(rect.left + window.scrollX - 16, window.innerWidth - card.offsetWidth - 12)) };
      setPosition(previous => previous.top === next.top && previous.left === next.left && !previous.visibility ? previous : next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    const observer = new ResizeObserver(schedule);
    if (text) observer.observe(text);
    if (cardRef.current) observer.observe(cardRef.current);
    document.fonts?.ready.then(() => { if (alive) schedule(); });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [selection, state]);

  const save = async () => {
    if (!state.result || saving) return;
    setSaving(true);
    try {
      const added = await toggleSavedWord(article, sentence, selection.word, state.result);
      toast(added ? '已收藏生词' : '已取消收藏');
    } catch (error) { toast(errorMessage(error)); }
    finally { setSaving(false); }
  };
  return <div className="wcard" role="dialog" aria-label="查词" ref={cardRef} style={position}>
    <div className="wc-head"><span className="wc-word" lang="en">{selection.word}</span>
      {state.result && <button className={`ic${playingKey === key ? ' speaking' : ''}`} aria-label="发音" onClick={() => play(key, selection.word)}><Icon name="speaker" /></button>}
    </div>
    {state.loading ? <div aria-label="查询中" role="status"><div className="sk" style={{ width: '40%' }} /><div className="sk" style={{ width: '90%' }} /><div className="sk" style={{ width: '70%' }} /></div>
      : state.failed ? <p className="wc-def" style={{ color: 'var(--ink-3)' }}>查询失败 <button className="link" onClick={() => setRequestId(value => value + 1)}>重试</button></p>
        : <>
          <div className="wc-meta"><span>{state.result.phonetic}</span>{state.result.lemma && state.result.lemma.toLowerCase() !== selection.word.toLowerCase() && <span>原形 {state.result.lemma}</span>}</div>
          <div className="wc-def"><span className="pos">{state.result.pos}</span>{state.result.meaning}</div>
          <div className="wc-acts"><button className={`btn ${saved ? 'ghost' : 'primary'} sm`} disabled={saving} onClick={save}>{saved && <Icon name="starOn" width="15" height="15" />}{saved ? '已收藏' : '收藏生词'}</button></div>
        </>}
  </div>;
}
