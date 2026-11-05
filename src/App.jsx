import { useEffect } from 'react';
import { useHashRoute } from './router.js';
import { ToastProvider, useToast } from './toast.jsx';
import { start } from './audioQueue.js';
import { resumeTranslations } from './api.js';
import { stopPreview } from './usePreviewAudio.js';
import ArticleList from './pages/ArticleList.jsx';
import Study from './pages/Study.jsx';
import { ensureBuiltinArticles } from './db.js';
import { builtinArticles } from './builtinArticles.js';

let initialized = false;
function Application() {
  const route = useHashRoute();
  const toast = useToast();
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    navigator.storage?.persist?.().catch(() => {});
    ensureBuiltinArticles(builtinArticles).then(() => {
      void start().catch(error => toast(`读取数据失败：${error.message}`));
      void resumeTranslations().catch(error => toast(error.message));
    }).catch(error => toast(`读取数据失败：${error.message}`));
  }, [toast]);
  useEffect(() => {
    stopPreview();
    document.body.classList.toggle('on-study', route.page === 'study');
    if (route.page === 'list') window.scrollTo(0, 0);
    return stopPreview;
  }, [route.page, route.articleId, route.focus]);
  return route.page === 'study'
    ? <Study key={route.articleId} articleId={route.articleId} focus={route.focus} />
    : <ArticleList />;
}
export default function App() {
  return <ToastProvider><Application /></ToastProvider>;
}
