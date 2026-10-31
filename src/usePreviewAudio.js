import { useCallback, useSyncExternalStore } from 'react';
import { ensureAudio } from './audioQueue.js';
import { getSetting } from './db.js';
import { errorMessage, useToast } from './toast.jsx';

let audio;
let objectUrl;
let playingKey = null;
let revision = 0;
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export function stopPreview() {
  revision++;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  playingKey = null;
  notify();
}
async function playPreview(key, text, onError) {
  if (playingKey === key) { stopPreview(); return; }
  stopPreview();
  const current = revision;
  playingKey = key;
  notify();
  try {
    const [blob, speed] = await Promise.all([ensureAudio(key, text), getSetting('speed', 1)]);
    if (current !== revision) return;
    audio ||= new Audio();
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    audio.playbackRate = speed;
    audio.onended = () => { if (current === revision) stopPreview(); };
    audio.onerror = () => {
      if (current !== revision) return;
      stopPreview();
      onError(new Error('音频无法播放，请重试'));
    };
    await audio.play();
  } catch (error) {
    if (current !== revision) return;
    stopPreview();
    onError(error);
  }
}
export function usePreviewAudio() {
  const active = useSyncExternalStore(subscribe, () => playingKey);
  const toast = useToast();
  const play = useCallback((key, text) => playPreview(key, text, error => toast(errorMessage(error))), [toast]);
  return { playingKey: active, play, stop: stopPreview };
}
