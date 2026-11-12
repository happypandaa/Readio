import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { setLastIndex, setSetting, toggleSavedSentence, touchArticle } from '../db.js';
import { translateArticle, translateSentence } from '../api.js';
import { getArticleAudioState } from '../audioState.js';
import usePlayer from '../usePlayer.js';
import { errorMessage, useToast } from '../toast.jsx';
import ArticleText from '../components/ArticleText.jsx';
import SentenceToolbar from '../components/SentenceToolbar.jsx';
import PlayerBar from '../components/PlayerBar.jsx';
import WordCard from '../components/WordCard.jsx';
import Icon from '../components/Icon.jsx';
import AudioGenerationStatus, { audioDurationLabel, useGenerateAudio } from '../components/AudioGenerationStatus.jsx';
import TranslationBar from '../components/TranslationBar.jsx';

// 触屏设备没有悬停：工具条固定显示在当前句上。
const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;
const HOVER_SWITCH_MS = 150;
const HOVER_HIDE_MS = 220;

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
  const showSetting = useLiveQuery(() => db.settings.get('showTranslations'), [], null);
  const showAll = showSetting?.value === true;
  const audioState = getArticleAudioState(data?.audios || [], entry.sentenceCount);
  const { ready } = audioState;
  const generator = useGenerateAudio(articleId);
  const player = usePlayer({ articleId, count: entry.sentenceCount, initialIndex: entry.initialIndex, speed, ready });
  const textRef = useRef(null);
  // expanded：单独展开的句子；collapsed：「译文」开关打开时单独收起的句子。
  const [expanded, setExpanded] = useState(new Set());
  const [collapsed, setCollapsed] = useState(new Set());
  const [translationStatus, setTranslationStatus] = useState({});
  const [batch, setBatch] = useState({ running: false, failed: 0 });
  const batchController = useRef(null);
  const [selection, setSelection] = useState(null);
  const [active, setActive] = useState(null);
  const [flash, setFlash] = useState(entry.focus == null ? null : entry.initialIndex);
  const [follow, setFollow] = useState(true);
  const [scrolled, setScrolled] = useState(window.scrollY > 4);
  const selectionRef = useRef(selection);
  // 工具条的显示来源：hover 鼠标悬停 / focus 键盘焦点。
  const activeRef = useRef(active), activeSource = useRef(null), hoverTimer = useRef(null), pendingIndex = useRef(null);
  activeRef.current = active;
  const followRef = useRef(true), programUntil = useRef(0), lastCur = useRef(null);
  const playingRef = useRef(player.playing);
  const saving = useRef(new Set());
  selectionRef.current = selection;
  playingRef.current = player.playing;

  useEffect(() => {
    if (data && !data.article) location.hash = '#/';
  }, [data]);
  useEffect(() => {
    if (flash == null) return;
    const timer = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(timer);
  }, [flash]);

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
      // 用户滚动页面时收起悬停工具条；程序自动跟随当前句的滚动不收起。
      if (activeSource.current === 'hover' && Date.now() > programUntil.current) hideToolbar();
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

  const clearHoverTimer = () => { clearTimeout(hoverTimer.current); pendingIndex.current = null; };
  const showToolbar = (index, source) => { clearHoverTimer(); activeSource.current = source; setActive(index); };
  const hideToolbar = useCallback(() => {
    clearTimeout(hoverTimer.current);
    pendingIndex.current = null;
    activeSource.current = null;
    setActive(null);
  }, []);
  const activateSentence = index => {
    showToolbar(index, 'focus');
    setSelection(null);
  };
  const hoverSentence = index => {
    if (TOUCH || selectionRef.current) return;
    if (activeRef.current === index) { clearHoverTimer(); return; }
    if (activeRef.current == null) { showToolbar(index, 'hover'); return; }
    // 从一句移到另一句时稍等，方便鼠标经过别的句子移到工具条上。
    if (pendingIndex.current === index) return;
    clearTimeout(hoverTimer.current);
    pendingIndex.current = index;
    hoverTimer.current = setTimeout(() => showToolbar(index, 'hover'), HOVER_SWITCH_MS);
  };
  const leaveHover = related => {
    if (TOUCH || activeSource.current !== 'hover') return;
    if (related?.closest?.('#sbar') || related?.closest?.(`.sx[data-i="${activeRef.current}"]`)) return;
    if (related?.closest?.('.sx')) return; // 移到另一句：由 hoverSentence 处理切换
    clearHoverTimer();
    hoverTimer.current = setTimeout(hideToolbar, HOVER_HIDE_MS);
  };
  const leaveFocus = related => {
    if (activeSource.current !== 'focus') return;
    if (related?.closest?.('#sbar') || related?.closest?.(`.sx[data-i="${activeRef.current}"]`)) return;
    hideToolbar();
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const openWord = item => {
    clearHoverTimer();
    player.pause();
    setSelection(item);
  };
  const closeWord = useCallback(() => {
    selectionRef.current?.element?.focus({ preventScroll: true });
    setSelection(null);
    // 关闭查词卡片后工具条不自动回来，鼠标再次移动到句子上才出现；键盘操作保留当前句。
    if (activeSource.current !== 'focus') hideToolbar();
  }, [hideToolbar]);

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
  const visible = new Set(expanded);
  if (showAll) for (const sentence of data?.sentences || []) if (sentence.zh && !collapsed.has(sentence.idx)) visible.add(sentence.idx);
  const toggleTranslation = index => {
    const wasOpen = visible.has(index);
    const edit = (setter, add) => setter(previous => {
      const next = new Set(previous);
      add ? next.add(index) : next.delete(index);
      return next;
    });
    edit(setExpanded, !wasOpen);
    edit(setCollapsed, wasOpen && showAll);
    if (!wasOpen) void requestTranslation(index);
  };
  const showTranslations = value => {
    setExpanded(new Set());
    setCollapsed(new Set());
    if (value !== showAll) setSetting('showTranslations', value).catch(error => toast(errorMessage(error)));
  };
  const translateRest = async () => {
    if (batchController.current) return;
    showTranslations(true);
    if (data.sentences.every(sentence => sentence.zh)) return;
    const controller = new AbortController();
    batchController.current = controller;
    setBatch({ running: true, failed: 0 });
    try {
      const failed = await translateArticle(articleId, { signal: controller.signal });
      if (batchController.current === controller) setBatch({ running: false, failed });
    } catch (error) {
      if (batchController.current !== controller) return;
      setBatch({ running: false, failed: 0 });
      if (error.name !== 'AbortError') toast(errorMessage(error));
    } finally {
      if (batchController.current === controller) batchController.current = null;
    }
  };
  const stopTranslating = () => { batchController.current?.abort(); };
  useEffect(() => () => {
    batchController.current?.abort();
    batchController.current = null;
  }, []);
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
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (selectionRef.current) { event.preventDefault(); closeWord(); }
        else if (active != null) {
          event.preventDefault();
          hideToolbar();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target.closest?.('input,textarea,select,[contenteditable="true"],.pop') || selectionRef.current) return;
      if (event.key === ' ' && event.target.closest?.('button')) return;
      if (event.key === ' ') { event.preventDefault(); player.toggle(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (event.key.toLowerCase() === 't') { event.preventDefault(); toggleTranslation(active ?? player.cur); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); void toggleSave(active ?? player.cur); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  if (!data?.article) return <main className="wrap"><p className="hint" role="status">加载中…</p></main>;
  const toolbarIndex = selection ? null : TOUCH ? player.cur : active;
  const selectedSentence = selection && data.sentences.find(item => item.idx === selection.idx);
  return <main id="pageStudy">
    <header className={`s-top${scrolled ? ' scrolled' : ''}`} id="studyTop">
      <div className="wrap bar">
        <button className="back" id="backBtn" aria-label="返回文章列表" onClick={() => { location.hash = '#/'; }}><Icon name="back" /><span>返回</span></button>
        <div className="s-title" id="studyTitle">{data.article.title}</div>
        <div className="s-tools">
          <button className={`tr-toggle${showAll ? ' on' : ''}`} aria-pressed={showAll}
            title={showAll ? '隐藏译文' : '显示已有译文'} onClick={() => showTranslations(!showAll)}>译文</button>
          <button className="btn primary sm" disabled={batch.running} onClick={translateRest}>
            {batch.running ? '翻译中…' : '全篇翻译'}
          </button>
        </div>
      </div>
    </header>
    <article className="wrap doc">
      <AudioGenerationStatus article={data.article} audios={data.audios} sentences={data.sentences} />
      {(showAll || batch.running) && <TranslationBar sentences={data.sentences} running={batch.running} failed={batch.failed}
        onTranslate={translateRest} onStop={stopTranslating} />}
      <h1 className="doc-title" id="docTitle" lang="en">{data.article.title}</h1>
      <ArticleText sentences={data.sentences} current={player.cur} active={active} flash={flash}
        savedSentences={data.savedSentences} savedWords={data.savedWords} expanded={visible} translationStatus={translationStatus}
        selection={selection} onWord={openWord} onActivate={activateSentence}
        onHover={hoverSentence} onLeave={leaveHover} onFocusLeave={leaveFocus}
        onRetry={requestTranslation} textRef={textRef} />
      <SentenceToolbar index={toolbarIndex} textRef={textRef} layoutKey={`${[...visible].join(',')}|${data.savedSentences.length}|${data.savedWords.length}|${data.sentences.map(item => Boolean(item.zh)).join('')}`}
        saved={data.savedSentences.some(item => item.idx === toolbarIndex)} expanded={visible.has(toolbarIndex)} audioReady={ready}
        onPlay={playAt} onTranslate={toggleTranslation} onSave={toggleSave}
        onMouseEnter={clearHoverTimer} onMouseLeave={leaveHover} onBlur={leaveFocus} />
    </article>
    {!follow && <button className="follow" id="followBtn" onClick={() => { enableFollow(); scrollCurrent(true, true); }}>回到当前句</button>}
    <PlayerBar current={player.cur} count={entry.sentenceCount} playing={player.playing} waiting={player.waiting}
      audios={data.audios} speed={speed} ready={ready} audioState={audioState} duration={audioDurationLabel(data.sentences)}
      generating={generator.busy} onGenerate={() => void generator.run()} onToggle={player.toggle} onStep={step} onSeek={seek}
      onSpeed={value => setSetting('speed', value).catch(error => toast(errorMessage(error)))} />
    {selection && selectedSentence && <WordCard key={`${selection.idx}|${selection.word.toLowerCase()}`} article={data.article} sentence={selectedSentence}
      selection={selection} audioReady={ready} saved={data.savedWords.some(item => item.idx === selection.idx && item.word.toLowerCase() === selection.word.toLowerCase())} onClose={closeWord} />}
  </main>;
}
