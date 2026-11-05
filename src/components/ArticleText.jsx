import { Fragment, useMemo } from 'react';
import { tokenize } from '../text.js';
import Icon from './Icon.jsx';

export default function ArticleText({ sentences, current, active, flash, savedSentences, savedWords,
  expanded, translationStatus, selection, onWord, onActivate, onRetry, textRef }) {
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

  return <div id="sents" ref={textRef}>
    {paragraphs.map((paragraph, paragraphIndex) => <p className="para" lang="en" key={paragraphIndex}>
      {paragraph.map((sentence, sentenceIndex) => <Fragment key={sentence.idx}>
        {sentenceIndex > 0 ? ' ' : null}
        <span className={['sx', current === sentence.idx && 'cur', active === sentence.idx && 'active', flash === sentence.idx && 'flash'].filter(Boolean).join(' ')}
          data-i={sentence.idx} role={active === sentence.idx ? 'group' : 'button'} tabIndex={0}
          aria-label={`第 ${sentence.idx + 1} 句${active === sentence.idx ? '，已激活，可选择单词查词' : '，点击或按回车激活'}`}
          onClick={() => onActivate(sentence.idx)} onKeyDown={event => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            onActivate(sentence.idx);
          }}>
          {tokenize(sentence.text).map((token, tokenIndex) => token.type === 'word'
            ? <span role={active === sentence.idx ? 'button' : undefined} tabIndex={active === sentence.idx ? 0 : undefined} className={['w', wordSet.has(`${sentence.idx}|${token.value.toLowerCase()}`) && 'saved',
              selection?.idx === sentence.idx && selection.tokenIndex === tokenIndex && 'sel'].filter(Boolean).join(' ')}
              data-w={token.value} key={tokenIndex} aria-label={active === sentence.idx ? `查词 ${token.value}` : undefined}
              onClick={event => {
                if (active !== sentence.idx) return;
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
