import { useState } from 'react';
import { getArticleAudioState, isAudioNotStarted } from '../audioState.js';
import { generateArticle, stopArticle } from '../audioQueue.js';
import { estimateAudioSeconds, formatAudioDuration } from '../text.js';
import { errorMessage, useToast } from '../toast.jsx';

export function useGenerateAudio(articleId) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function run(action = generateArticle) {
    if (busy) return;
    setBusy(true);
    try { await action(articleId); }
    catch (error) { toast(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return { busy, run };
}

export const audioDurationLabel = sentences => formatAudioDuration(estimateAudioSeconds((sentences || []).map(item => item.text)));

export default function AudioGenerationStatus({ article, audios = [], sentences }) {
  const state = getArticleAudioState(audios, article.sentenceCount);
  const { busy, run } = useGenerateAudio(article.id);
  if (state.ready) return null;
  const act = (event, action) => { event.stopPropagation(); void run(action); };
  if (isAudioNotStarted(state)) {
    const duration = audioDurationLabel(sentences);
    return <div className="audio-generation" data-generation-state="none">
      <div className="row-meta">
        <span role="status" className="num">未生成音频 · 共 {article.sentenceCount} 句{duration && ` · 音频${duration}`}</span>
        <button className="link" disabled={busy} onClick={event => act(event, generateArticle)}>生成音频</button>
      </div>
    </div>;
  }
  const status = state.pending ? 'generating' : state.failed ? 'failed' : state.stopped ? 'stopped' : 'incomplete';
  const label = state.pending ? '正在生成音频' : state.failed ? '音频生成失败' : state.stopped ? '已停止生成' : '音频尚未完成';
  return <div className={`audio-generation${state.failed ? ' has-error' : ''}`} data-generation-state={status}>
    <div className={`row-meta${state.pending ? ' gen' : state.failed ? ' fail' : ''}`}>
      <span role="status" className="generation-label">{state.pending > 0 && <span className="pulse" />}<span className="num">{label} {state.completed}/{article.sentenceCount}</span></span>
      {state.pending > 0 ? <button className="link" disabled={busy} onClick={event => act(event, stopArticle)}>停止生成</button>
        : <button className="link" disabled={busy} onClick={event => act(event, generateArticle)}>{state.failed ? '重试生成' : '继续生成'}</button>}
    </div>
    <progress value={state.completed} max={article.sentenceCount} aria-label={`音频已生成 ${state.completed}/${article.sentenceCount}`} />
    {state.error && <p className="generation-error">{state.error}</p>}
  </div>;
}
