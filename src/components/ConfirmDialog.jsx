import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../toast.jsx';

const stack = [];
let previousOverflow = '';
const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';

export function useDialog(onClose, { initialFocus } = {}) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const token = {};
    const previous = document.activeElement;
    if (!stack.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    stack.push(token);
    const timer = requestAnimationFrame(() => {
      if (stack.at(-1) !== token) return;
      const target = initialFocus?.current || ref.current?.querySelector('[data-autofocus]')
        || ref.current?.querySelector(focusable) || ref.current;
      target?.focus();
    });
    const keydown = event => {
      if (stack.at(-1) !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
      }
      if (event.key !== 'Tab') return;
      const elements = [...(ref.current?.querySelectorAll(focusable) || [])]
        .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
      if (!elements.length) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener('keydown', keydown, true);
      const index = stack.indexOf(token);
      if (index !== -1) stack.splice(index, 1);
      if (!stack.length) document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

export default function ConfirmDialog({ title, desc, ok = '确认', cancel = '取消', danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ref = useDialog(() => { if (!busy) onClose(); });
  async function confirm() {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); onClose(); }
    catch (error) { toast(error.message || '操作失败'); setBusy(false); }
  }
  return createPortal(
    <div className="scrim" style={{ zIndex: 80 }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="dialog small" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" ref={ref} tabIndex={-1} aria-busy={busy}>
        <h2 id="confirmTitle">{title}</h2>
        {desc && <p className="desc">{desc}</p>}
        <div className="d-acts">
          <button className="btn ghost" disabled={busy} onClick={onClose}>{cancel}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={confirm} data-autofocus>{ok}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
