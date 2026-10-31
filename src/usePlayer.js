import { useCallback, useEffect, useRef, useState } from 'react';
import db, { setFinished, setLastIndex } from './db.js';
import { retryFailed } from './audioQueue.js';
import { stopPreview } from './usePreviewAudio.js';
import { errorMessage, useToast } from './toast.jsx';

export default function usePlayer({ articleId, count, initialIndex = 0, speed = 1 }) {
  const toast = useToast();
  const [state, setState] = useState({ cur: initialIndex, playing: false, waiting: false });
  const runtime = useRef({ cur: initialIndex, playing: false, sequence: 0, alive: true, audio: null, url: null, timer: null });
  const attemptRef = useRef(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const clearTimer = useCallback(() => {
    clearTimeout(runtime.current.timer);
    runtime.current.timer = null;
  }, []);
  const update = useCallback(patch => {
    Object.assign(runtime.current, patch);
    if (runtime.current.alive) setState(previous => ({ ...previous, ...patch }));
  }, []);
  const pause = useCallback(() => {
    const current = runtime.current;
    current.sequence++;
    clearTimer();
    current.audio?.pause();
    update({ playing: false, waiting: false });
  }, [clearTimer, update]);
  const move = useCallback(index => {
    if (index < 0 || index >= count) return;
    update({ cur: index });
    void setLastIndex(articleId, index).catch(error => toast(errorMessage(error)));
  }, [articleId, count, toast, update]);

  const playFrom = useCallback(index => {
    if (index < 0 || index >= count) return;
    const current = runtime.current;
    const sequence = ++current.sequence;
    clearTimer();
    current.audio?.pause();
    stopPreview();
    move(index);
    update({ playing: true, waiting: false });
    void attemptRef.current(index, sequence);
  }, [clearTimer, count, move, update]);

  attemptRef.current = async (index, sequence) => {
    const current = runtime.current;
    const valid = () => current.alive && sequence === current.sequence && current.playing;
    try {
      const record = await db.audios.get(`s:${articleId}:${index}`);
      if (!valid()) return;
      if (!record) { pause(); return; }
      if (record.status === 'pending') {
        update({ waiting: true });
        current.timer = setTimeout(() => { void attemptRef.current(index, sequence); }, 500);
        return;
      }
      const next = () => {
        if (!valid()) return;
        if (index + 1 < count) current.timer = setTimeout(() => playFrom(index + 1), 300);
        else pause();
      };
      if (record.status === 'fail' || !record.blob) {
        update({ waiting: false });
        toast(`第 ${index + 1} 句音频生成失败`, {
          label: '重试', fn: () => { void retryFailed(articleId).catch(error => toast(errorMessage(error))); },
        });
        next();
        return;
      }
      const audio = current.audio ||= new Audio();
      if (current.url) URL.revokeObjectURL(current.url);
      current.url = URL.createObjectURL(record.blob);
      audio.src = current.url;
      audio.playbackRate = speedRef.current;
      audio.onended = () => {
        if (!valid()) return;
        if (index + 1 < count) next();
        else {
          pause();
          void setFinished(articleId).then(() => toast('已读完这篇文章'))
            .catch(error => toast(errorMessage(error)));
        }
      };
      audio.onerror = () => {
        if (!valid()) return;
        toast(`第 ${index + 1} 句音频无法播放`, {
          label: '重试', fn: () => {
            void db.audios.update(record.key, { status: 'fail', blob: null })
              .then(() => retryFailed(articleId)).catch(error => toast(errorMessage(error)));
          },
        });
        next();
      };
      update({ waiting: false });
      try { await audio.play(); }
      catch (error) {
        if (!valid()) return;
        pause();
        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') toast('生成失败：无法播放音频');
      }
    } catch (error) {
      if (!valid()) return;
      pause();
      toast(errorMessage(error));
    }
  };

  const seek = useCallback(index => {
    if (runtime.current.playing) playFrom(index);
    else { pause(); move(index); }
  }, [move, pause, playFrom]);
  const toggle = useCallback(() => runtime.current.playing ? pause() : playFrom(runtime.current.cur), [pause, playFrom]);
  const step = useCallback(direction => seek(runtime.current.cur + direction), [seek]);

  useEffect(() => {
    runtime.current.alive = true;
    return () => {
      const current = runtime.current;
      current.alive = false;
      current.sequence++;
      clearTimer();
      if (current.audio) {
        current.audio.onended = null;
        current.audio.onerror = null;
        current.audio.pause();
        current.audio.removeAttribute('src');
        current.audio.load();
        current.audio = null;
      }
      if (current.url) URL.revokeObjectURL(current.url);
      current.url = null;
    };
  }, [articleId, clearTimer]);
  useEffect(() => {
    if (runtime.current.audio) runtime.current.audio.playbackRate = speed;
  }, [speed]);

  return { ...state, playFrom, pause, toggle, seek, step };
}
