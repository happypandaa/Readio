import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { setLastIndex, setSetting, toggleSavedSentence, touchArticle } from '../db.js';
import { translateSentence } from '../api.js';
import { retryFailed } from '../audioQueue.js';
import usePlayer from '../usePlayer.js';
import { errorMessage, useToast } from '../toast.jsx';
import ArticleText from '../components/ArticleText.jsx';
import SentenceToolbar from '../components/SentenceToolbar.jsx';
import PlayerBar from '../components/PlayerBar.jsx';
import WordCard from '../components/WordCard.jsx';
import Icon from '../components/Icon.jsx';

export default function Study({ articleId, focus = null }) {
  const [entry, setEntry] = useState(null);
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    setEntry(null);
    touchArticle(articleId).then(async article => {
      if (!alive) return;
      if (!article) { location.hash = '#/'; return; }
      const index = Math.max(0, Math.min(article.sentenceCount - 1, focus ?? article.lastIndex));
      if (index !== article.lastIndex) await setLastIndex(articleId, index);
      if (alive) setEntry({ ...article, initialIndex: index, focus });
    }).catch(error => {
      if (!alive) return;
      toast(errorMessage(error));
      location.hash = '#/';
    });
    return () => { alive = false; };
  }, [articleId, focus, toast]);
  return entry ? <StudyContent key={`${articleId}:${focus ?? 'resume'}`} entry={entry} />
    : <main className="wrap"><p className="hint" role="status">加载中…</p></main>;
}

function StudyContent({ entry }) {
  const articleId = entry.id;
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const [article, sentences, audios, savedSentences, savedWords] = await Promise.all([
      db.articles.get(articleId), db.sentences.where('articleId').equals(articleId).toArray(),
      db.audios.where('articleId').equals(articleId).toArray(),
      db.savedSentences.where('[articleId+idx]').between([articleId, 0], [articleId, Infinity], true, true).toArray(),
      db.savedWords.where('[articleId+idx]').between([articleId, 0], [articleId, Infinity], true, true).toArray(),
    ]);
    return { article, sentences: sentences.sort((a, b) => a.idx - b.idx), audios, savedSentences, savedWords };
  }, [articleId], null);
  const savedSpeed = useLiveQuery(() => db.settings.get('speed'), [], null);
  const speed = savedSpeed?.value || 1;
  const player = usePlayer({ articleId, count: entry.sentenceCount, initialIndex: entry.initialIndex, speed });
  const textRef = useRef(null);
  const [expanded, setExpanded] = useState(new Set());
  const [translationStatus, setTranslationStatus] = useState({});
  const [selection, setSelection] = useState(null);
  const [hover, setHover] = useState(null);
  const [flash, setFlash] = useState(entry.focus == null ? null : entry.initialIndex);
  const [touchToolbar, setTouchToolbar] = useState(() => matchMedia('(hover: none), (max-width: 640px)').matches);
  const [follow, setFollow] = useState(true);
  const [scrolled, setScrolled] = useState(window.scrollY > 4);
  const hoverRef = useRef(null);
  const hideTimer = useRef(null), switchTimer = useRef(null);
  const selectionRef = useRef(selection);
  const followRef = useRef(true), programUntil = useRef(0), lastCur = useRef(null);
  const playingRef = useRef(player.playing);
  const saving = useRef(new Set());
  selectionRef.current = selection;
  playingRef.current = player.playing;

  useEffect(() => {
    if (data && !data.article) location.hash = '#/';
  }, [data]);
  useEffect(() => {
    const media = matchMedia('(hover: none), (max-width: 640px)');
    const change = () => setTouchToolbar(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (flash == null) return;
    const timer = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(switchTimer.current); }, []);

  const scrollCurrent = useCallback((smooth = true, force = false) => {
    const sentence = textRef.current?.querySelector(`.sx[data-i="${player.cur}"]`);
    if (!sentence) return;
    const rect = sentence.getBoundingClientRect();
    const playerHeight = document.querySelector('.player')?.getBoundingClientRect().height || 112;
    if (!force && smooth && rect.top >= 70 && rect.bottom <= window.innerHeight - playerHeight - 12) return;
    programUntil.current = Date.now() + 950;
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.3), behavior: smooth ? 'smooth' : 'auto' });
  }, [player.cur]);
  const enableFollow = () => { followRef.current = true; setFollow(true); };
  useLayoutEffect(() => {
    if (!data?.article || !textRef.current) return;
    const first = lastCur.current == null;
    const changed = lastCur.current !== player.cur;
    lastCur.current = player.cur;
    if (!followRef.current || (!first && !changed)) return;
    if (first && player.cur === 0 && entry.focus == null) {
      programUntil.current = Date.now() + 950;
      window.scrollTo(0, 0);
    } else scrollCurrent(!first, first);
  }, [data?.article?.id, entry.focus, player.cur, scrollCurrent]);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => { if (alive && followRef.current && entry.initialIndex > 0) scrollCurrent(false, true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const manual = () => {
      if (!playingRef.current) return;
      followRef.current = false;
      setFollow(false);
    };
    const onScroll = () => {
      setScrolled(window.scrollY > 4);
      if (playingRef.current && followRef.current && Date.now() > programUntil.current) manual();
    };
    const onKey = event => {
      if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) manual();
    };
    window.addEventListener('wheel', manual, { passive: true });
    window.addEventListener('touchmove', manual, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', manual); window.removeEventListener('touchmove', manual);
      window.removeEventListener('scroll', onScroll); window.removeEventListener('keydown', onKey);
    };
  }, []);

  const clearHover = () => { hoverRef.current = null; setHover(null); };
  const enterSentence = index => {
    if (touchToolbar || selectionRef.current) return;
    clearTimeout(hideTimer.current); clearTimeout(switchTimer.current);
    if (hoverRef.current == null) { hoverRef.current = index; setHover(index); }
    else if (hoverRef.current !== index) switchTimer.current = setTimeout(() => { hoverRef.current = index; setHover(index); }, 160);
  };
  const leaveSentence = target => {
    if (touchToolbar || selectionRef.current) return;
    if (target?.closest?.('#sbar') || target?.closest?.(`.sx[data-i="${hoverRef.current}"]`)) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(clearHover, 220);
  };
  const openWord = item => {
    player.pause();
    clearTimeout(hideTimer.current); clearTimeout(switchTimer.current);
    clearHover();
    setSelection(item);
  };
  const closeWord = useCallback(() => {
    selectionRef.current?.element?.focus({ preventScroll: true });
    setSelection(null);
  }, []);

  const requestTranslation = async index => {
    const sentence = data?.sentences.find(item => item.idx === index);
    if (!sentence || sentence.zh) return;
    setTranslationStatus(previous => ({ ...previous, [index]: 'pending' }));
    try {
      await translateSentence(sentence);
      setTranslationStatus(previous => ({ ...previous, [index]: 'ok' }));
    } catch (error) {
      setTranslationStatus(previous => ({ ...previous, [index]: 'fail' }));
      toast(errorMessage(error));
    }
  };
  const toggleTranslation = index => {
    const wasOpen = expanded.has(index);
    setExpanded(previous => {
      const next = new Set(previous);
      wasOpen ? next.delete(index) : next.add(index);
      return next;
    });
    if (!wasOpen) void requestTranslation(index);
  };
  const toggleSave = async index => {
    if (!data?.article || saving.current.has(index)) return;
    const sentence = data.sentences.find(item => item.idx === index);
    if (!sentence) return;
    saving.current.add(index);
    try { toast(await toggleSavedSentence(data.article, sentence) ? '已收藏句子' : '已取消收藏'); }
    catch (error) { toast(errorMessage(error)); }
    finally { saving.current.delete(index); }
  };
  const playAt = index => { enableFollow(); setSelection(null); player.playFrom(index); };
  const seek = index => { enableFollow(); setSelection(null); player.seek(index); };
  const step = direction => { enableFollow(); setSelection(null); player.step(direction); };
  useEffect(() => {
    const keydown = event => {
      if (event.key === 'Escape') { if (selectionRef.current) { event.preventDefault(); closeWord(); } return; }
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target.closest?.('input,textarea,select,[contenteditable="true"],.pop') || selectionRef.current) return;
      if (event.key === ' ') { event.preventDefault(); player.toggle(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (event.key.toLowerCase() === 't') { event.preventDefault(); toggleTranslation(player.cur); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); void toggleSave(player.cur); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  if (!data?.article) return <main className="wrap"><p className="hint" role="status">加载中…</p></main>;
  const pending = data.audios.filter(item => item.status === 'pending').length;
  const failed = data.audios.filter(item => item.status === 'fail').length;
  const toolbarIndex = selection ? null : touchToolbar ? player.cur : hover;
  const selectedSentence = selection && data.sentences.find(item => item.idx === selection.idx);
  return <main id="pageStudy">
    <header className={`s-top${scrolled ? ' scrolled' : ''}`} id="studyTop">
      <div className="wrap bar">
        <button className="back" id="backBtn" aria-label="返回文章列表" onClick={() => { location.hash = '#/'; }}><Icon name="back" /><span>返回</span></button>
        <div className="s-title" id="studyTitle">{data.article.title}</div>
        <div className="s-audio num" id="studyAudio">{pending ? `音频 ${entry.sentenceCount - pending}/${entry.sentenceCount}`
          : failed ? <button className="link" style={{ color: 'var(--danger)' }} title={`${failed} 句音频生成失败`} onClick={() => retryFailed(articleId).catch(error => toast(errorMessage(error)))}>重试音频</button> : null}</div>
      </div>
    </header>
    <article className="wrap doc">
      <h1 className="doc-title" id="docTitle" lang="en">{data.article.title}</h1>
      <ArticleText sentences={data.sentences} current={player.cur} hover={selection ? null : hover} flash={flash}
        savedSentences={data.savedSentences} savedWords={data.savedWords} expanded={expanded} translationStatus={translationStatus}
        selection={selection} onWord={openWord} onSentenceEnter={enterSentence} onSentenceLeave={leaveSentence}
        onRetry={requestTranslation} textRef={textRef} />
      <SentenceToolbar index={toolbarIndex} textRef={textRef} layoutKey={`${[...expanded].join(',')}|${data.savedSentences.length}|${data.savedWords.length}|${data.sentences.map(item => Boolean(item.zh)).join('')}`}
        saved={data.savedSentences.some(item => item.idx === toolbarIndex)} expanded={expanded.has(toolbarIndex)}
        onPlay={playAt} onTranslate={toggleTranslation} onSave={toggleSave}
        onEnter={() => { clearTimeout(hideTimer.current); clearTimeout(switchTimer.current); }} onLeave={leaveSentence} />
    </article>
    {!follow && <button className="follow" id="followBtn" onClick={() => { enableFollow(); scrollCurrent(true, true); }}>回到当前句</button>}
    <PlayerBar current={player.cur} count={entry.sentenceCount} playing={player.playing} waiting={player.waiting}
      audios={data.audios} speed={speed} onToggle={player.toggle} onStep={step} onSeek={seek}
      onSpeed={value => setSetting('speed', value).catch(error => toast(errorMessage(error)))} />
    {selection && selectedSentence && <WordCard key={`${selection.idx}|${selection.word.toLowerCase()}`} article={data.article} sentence={selectedSentence}
      selection={selection} saved={data.savedWords.some(item => item.idx === selection.idx && item.word.toLowerCase() === selection.word.toLowerCase())} onClose={closeWord} />}
  </main>;
}
