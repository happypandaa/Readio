import { Fragment, useMemo } from 'react';
import { tokenize } from '../text.js';
import Icon from './Icon.jsx';

export default function ArticleText({ sentences, current, hover, flash, savedSentences, savedWords,
  expanded, translationStatus, selection, onWord, onSentenceEnter, onSentenceLeave, onRetry, textRef }) {
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
        <span className={['sx', current === sentence.idx && 'cur', hover === sentence.idx && 'hov', flash === sentence.idx && 'flash'].filter(Boolean).join(' ')}
          data-i={sentence.idx} onMouseEnter={() => onSentenceEnter(sentence.idx)}
          onMouseLeave={event => onSentenceLeave(event.relatedTarget)}>
          {tokenize(sentence.text).map((token, tokenIndex) => token.type === 'word'
            ? <span role="button" tabIndex={0} className={['w', wordSet.has(`${sentence.idx}|${token.value.toLowerCase()}`) && 'saved',
              selection?.idx === sentence.idx && selection.tokenIndex === tokenIndex && 'sel'].filter(Boolean).join(' ')}
              data-w={token.value} key={tokenIndex} aria-label={`查词 ${token.value}`}
              onClick={event => onWord({ word: token.value, idx: sentence.idx, tokenIndex, element: event.currentTarget })}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); onWord({ word: token.value, idx: sentence.idx, tokenIndex, element: event.currentTarget }); }
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
