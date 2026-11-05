import { useState } from 'react';
import { getArticleAudioState } from '../audioState.js';
import { retryFailed, stopArticle } from '../audioQueue.js';
import { errorMessage, useToast } from '../toast.jsx';

export default function AudioGenerationStatus({ article, audios = [] }) {
  const state = getArticleAudioState(audios, article.sentenceCount);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (state.ready) return null;
  async function act(event, action) {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await action(article.id); }
    catch (error) { toast(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const status = state.pending ? 'generating' : state.failed ? 'failed' : state.stopped ? 'stopped' : 'incomplete';
  const label = state.pending ? '正在生成音频' : state.failed ? '音频生成失败' : state.stopped ? '已停止生成' : '音频尚未就绪';
  return <div className={`audio-generation${state.failed ? ' has-error' : ''}`} data-generation-state={status}>
    <div className={`row-meta${state.pending ? ' gen' : state.failed ? ' fail' : ''}`}>
      <span role="status" className="generation-label">{state.pending > 0 && <span className="pulse" />}<span className="num">{label} {state.completed}/{article.sentenceCount}</span></span>
      {state.pending > 0 ? <button className="link" disabled={busy} onClick={event => act(event, stopArticle)}>停止生成</button>
        : (state.failed > 0 || state.stopped > 0) && <button className="link" disabled={busy} onClick={event => act(event, retryFailed)}>{state.failed ? '重试生成' : '继续生成'}</button>}
    </div>
    <progress value={state.completed} max={article.sentenceCount} aria-label={`音频已生成 ${state.completed}/${article.sentenceCount}`} />
    {state.error && <p className="generation-error">{state.error}</p>}
  </div>;
}
