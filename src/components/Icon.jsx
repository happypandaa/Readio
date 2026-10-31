const paths = {
  play: <path d="M8 5.2v13.6L19 12z" />,
  pause: <><rect x="6.5" y="5" width="3.8" height="14" rx="1" /><rect x="13.7" y="5" width="3.8" height="14" rx="1" /></>,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  star: <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />,
  starOn: <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />,
  more: <><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></>,
  speaker: <><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" /><path d="M15.5 9.2a4 4 0 010 5.6M18.2 6.6a7.6 7.6 0 010 10.8" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  open: <><path d="M4 6.5h10M4 11.5h10M4 16.5h6" /><path d="M15 15l3-3 3 3M18 12v8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  prev: <><rect x="5" y="5.5" width="2.2" height="13" rx="1" /><path d="M19 5.8v12.4L9 12z" /></>,
  next: <><rect x="16.8" y="5.5" width="2.2" height="13" rx="1" /><path d="M5 5.8v12.4L15 12z" /></>,
};
const filled = new Set(['play', 'pause', 'stop', 'starOn', 'more', 'prev', 'next']);

export default function Icon({ name, ...props }) {
  const fill = filled.has(name);
  return <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
    stroke={fill && name !== 'starOn' ? undefined : 'currentColor'}
    strokeWidth={name === 'star' || name === 'starOn' ? 1.7 : 1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>;
}
