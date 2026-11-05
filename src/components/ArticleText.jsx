import { Fragment, useMemo } from 'react';
import { tokenize } from '../text.js';
import Icon from './Icon.jsx';

export default function ArticleText({ sentences, current, active, flash, savedSentences, savedWords,
  expanded, translationStatus, selection, onWord, onActivate, onHover, onLeave, onFocusLeave, onRetry, textRef }) {
  const paragraphs = useMemo(() => {
    const result = [];
    for (const sentence of sentences) {
      if (!result.length || sentence.paraStart) result.push([]);
      result.at(-1).push(sentence);
    }
    return result;
  }, [sentences]);
  const sentenceSet = new Set(savedSentences.map(item => item.idx));
  const wordSet = new Set(savedWords.map(item => `${item.idx}|${item.word.toLowerCase()}`));

  // 工具条：鼠标悬停句子时出现（onHover / onLeave），键盘 Tab 到句子时出现（onActivate / onFocusLeave）。
  return <div id="sents" ref={textRef}
    onMouseMove={event => { const sentence = event.target.closest?.('.sx'); if (sentence) onHover(Number(sentence.dataset.i)); }}
    onMouseOut={event => { if (event.target.closest?.('.sx')) onLeave(event.relatedTarget); }}>
    {paragraphs.map((paragraph, paragraphIndex) => <p className="para" lang="en" key={paragraphIndex}>
      {paragraph.map((sentence, sentenceIndex) => <Fragment key={sentence.idx}>
        {sentenceIndex > 0 ? ' ' : null}
        <span className={['sx', current === sentence.idx && 'cur', active === sentence.idx && 'active', flash === sentence.idx && 'flash'].filter(Boolean).join(' ')}
          data-i={sentence.idx} role="group" tabIndex={0}
          aria-label={`第 ${sentence.idx + 1} 句${active === sentence.idx ? '，可按 Tab 选择单词查词，T 翻译，S 收藏' : ''}`}
          onFocus={event => {
            // 只响应键盘焦点；鼠标点击句子获得的焦点不弹出工具条（鼠标用悬停）。
            if (event.target === event.currentTarget && event.currentTarget.matches(':focus-visible')) onActivate(sentence.idx);
          }}
          onBlur={event => onFocusLeave(event.relatedTarget)}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            onActivate(sentence.idx);
          }}>
          {tokenize(sentence.text).map((token, tokenIndex) => token.type === 'word'
            ? <span role={active === sentence.idx ? 'button' : undefined} tabIndex={active === sentence.idx ? 0 : undefined} className={['w', wordSet.has(`${sentence.idx}|${token.value.toLowerCase()}`) && 'saved',
              selection?.idx === sentence.idx && selection.tokenIndex === tokenIndex && 'sel'].filter(Boolean).join(' ')}
              data-w={token.value} key={tokenIndex} aria-label={active === sentence.idx ? `查词 ${token.value}` : undefined}
              onClick={event => {
                event.stopPropagation();
                onWord({ word: token.value, idx: sentence.idx, tokenIndex, element: event.currentTarget });
              }}
              onKeyDown={event => {
                if (active !== sentence.idx || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                onWord({ word: token.value, idx: sentence.idx, tokenIndex, element: event.currentTarget });
              }}>{token.value}</span>
            : <Fragment key={tokenIndex}>{token.value}</Fragment>)}
          {sentenceSet.has(sentence.idx) && <span className="mini-star" aria-label="已收藏"><Icon name="starOn" /></span>}
        </span>
        {expanded.has(sentence.idx) && <span lang="zh-CN" className={`sx-zh${sentence.zh ? '' : ' muted'}`} aria-live="polite">
          {sentence.zh || (translationStatus[sentence.idx] === 'fail'
            ? <>翻译失败 <button className="link" onClick={() => onRetry(sentence.idx)}>重试</button></>
            : '翻译中…')}
        </span>}
      </Fragment>)}
    </p>)}
  </div>;
}
