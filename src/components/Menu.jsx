import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../toast.jsx';

export default function Menu({ anchor, items, onClose, above = false }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toast = useToast();
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const { width, height } = ref.current.getBoundingClientRect();
      let top = above ? rect.top + scrollY - height - 8 : rect.bottom + scrollY + 6;
      if (top < scrollY + 8) top = rect.bottom + scrollY + 6;
      if (!above && top + height > scrollY + innerHeight - 8) top = Math.max(scrollY + 8, rect.top + scrollY - height - 8);
      setPosition({ top, left: Math.max(12, Math.min(rect.right + scrollX - width, innerWidth - width - 12)) });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place); };
  }, [anchor, above, items.length]);
  useEffect(() => {
    if (!anchor) return;
    ref.current?.querySelector('button')?.focus();
    const outside = event => {
      if (!ref.current?.contains(event.target) && !anchor.contains(event.target)) close.current();
    };
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); anchor.focus(); }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'].includes(event.key)) return;
      if (event.key === 'Tab') { close.current(); return; }
      event.preventDefault(); event.stopPropagation();
      const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown, true); };
  }, [anchor]);
  if (!anchor) return null;
  return createPortal(<div className="pop" role="menu" ref={ref} style={position}>
    {items.map((item, index) => <button key={item.label || index} type="button" role="menuitem" className={item.cls || ''} disabled={item.disabled} onClick={() => {
      onClose();
      anchor.focus({ preventScroll: true });
      try { Promise.resolve(item.fn()).catch(error => toast(error.message || '操作失败')); }
      catch (error) { toast(error.message || '操作失败'); }
    }}>{item.label}</button>)}
  </div>, document.body);
}
