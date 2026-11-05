import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { addArticle, setSetting } from '../db.js';
import { estimateAudioSeconds, formatAudioDuration, splitSentences } from '../text.js';
import { useToast } from '../toast.jsx';
import { useDialog } from './ConfirmDialog.jsx';

export default function AddArticleDialog({ onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const textRef = useRef(null);
  const toast = useToast();
  const sentences = useMemo(() => body.trim() ? splitSentences(body) : [], [body]);
  // 默认勾选「保存后生成音频」，并记住上次的选择。
  const autoSetting = useLiveQuery(() => db.settings.get('autoGenerateAudio'), [], null);
  const [autoOverride, setAutoOverride] = useState(null);
  const generateAudio = autoOverride ?? (autoSetting?.value !== false);
  const duration = formatAudioDuration(estimateAudioSeconds(sentences.map(item => item.text)));
  const error = body.trim() && !/[A-Za-z]/.test(body) ? '没有识别到英文内容'
    : sentences.length > 300 ? `文章太长了，最多支持 300 句，当前约 ${sentences.length} 句` : '';
  const requestClose = () => {
    if (busy) return;
    if (body.trim()) setDiscard(true); else onClose();
  };
  const ref = useDialog(requestClose, { initialFocus: textRef });
  async function save(event) {
    event.preventDefault();
    if (busy || discard || !body.trim() || error || !sentences.length) return;
    setBusy(true);
    try {
      void setSetting('autoGenerateAudio', generateAudio).catch(() => {});
      const id = await addArticle(title, body, { generateAudio });
      await onSaved?.(id);
      onClose();
      window.scrollTo({ top: 0 });
    } catch (reason) { toast(reason.message || '保存失败'); setBusy(false); }
  }
  return createPortal(<div className="scrim" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="addTitle" ref={ref} tabIndex={-1} onSubmit={save} aria-busy={busy}>
      <h2 id="addTitle">添加文章</h2>
      <label className="field"><span>标题（选填）</span><input className="input" maxLength={80} placeholder="不填则自动用第一句作为标题" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
      <label className="field"><span>正文</span><textarea className="textarea" rows={12} placeholder="粘贴英文文章" value={body} onChange={event => { setBody(event.target.value); setDiscard(false); }} ref={textRef} disabled={busy} aria-describedby="addHint" aria-invalid={!!error} /></label>
      <div className={`hint num${error ? ' err' : ''}`} id="addHint" aria-live="polite">{error || (body.trim() ? `约 ${sentences.length} 句${duration ? ` · 音频${duration}` : ''}` : '')}</div>
      {discard ? <div className="d-acts" key="discard"><span className="discard-label">放弃这篇文章？</span>
        <button type="button" className="btn ghost" onClick={event => { event.preventDefault(); setDiscard(false); textRef.current?.focus(); }}>继续编辑</button>
        <button type="button" className="btn danger" onClick={event => { event.preventDefault(); onClose(); }}>放弃</button>
      </div> : <div className="d-acts" key="edit">
        <label className="check"><input type="checkbox" checked={generateAudio} disabled={busy}
          onChange={event => setAutoOverride(event.target.checked)} />保存后生成音频</label>
        <button type="button" className="btn ghost" onClick={requestClose} disabled={busy}>取消</button>
        <button type="submit" className="btn primary" disabled={busy || !body.trim() || !!error || !sentences.length}>保存</button>
      </div>}
    </form>
  </div>, document.body);
}
