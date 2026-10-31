import { useEffect, useState } from 'react';

export function readRoute(hash = location.hash) {
  const match = hash.match(/^#\/study\/(\d+)(?:\?focus=(\d+))?$/);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return { page: 'list' };
  const focus = match[2] === undefined ? null : Number(match[2]);
  return { page: 'study', articleId: Number(match[1]), focus: Number.isSafeInteger(focus) ? focus : null };
}
export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return route;
}
