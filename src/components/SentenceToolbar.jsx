import { useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export default function SentenceToolbar({ index, textRef, saved, expanded, audioReady, layoutKey, onPlay, onTranslate, onSave }) {
  const barRef = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (index == null) { setPosition(null); return; }
    const place = () => {
      const bar = barRef.current;
      const sentence = textRef.current?.querySelector(`.sx[data-i="${index}"]`);
      if (!bar || !sentence) return;
      const rects = sentence.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first) return;
      const column = textRef.current.getBoundingClientRect();
      let top = first.top + window.scrollY - bar.offsetHeight - 4;
      if (first.top - bar.offsetHeight - 4 < 64) top = last.bottom + window.scrollY + 4;
      const left = Math.max(column.left + window.scrollX - 6,
        Math.min(first.left + window.scrollX - 6, column.right + window.scrollX - bar.offsetWidth));
      setPosition({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    const observer = new ResizeObserver(place);
    if (textRef.current) observer.observe(textRef.current);
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) place(); });
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [index, layoutKey, textRef]);
  if (index == null) return null;
  return <div className="sbar" id="sbar" ref={barRef} role="toolbar" aria-label={`第 ${index + 1} 句操作`}
    style={position || { visibility: 'hidden' }}>
    <button className="ic" disabled={!audioReady} aria-label="从这句开始播放" title={audioReady ? '从这句开始播放' : '全部音频生成完成后可播放'} onClick={() => onPlay(index)}><Icon name="play" /></button>
    <button className={`ic tr${expanded ? ' on' : ''}`} aria-label="翻译" aria-pressed={expanded} title="翻译 (T)" onClick={() => onTranslate(index)}>译</button>
    <button className={`ic star${saved ? ' on' : ''}`} aria-label={saved ? '取消收藏' : '收藏句子'} aria-pressed={saved} title="收藏句子 (S)" onClick={() => onSave(index)}><Icon name={saved ? 'starOn' : 'star'} /></button>
  </div>;
}
