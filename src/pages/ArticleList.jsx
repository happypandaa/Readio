import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import db, { setSetting } from '../db.js';
import { exportBackup, readBackup, importBackup } from '../backup.js';
import { useToast } from '../toast.jsx';
import { usePreviewAudio } from '../usePreviewAudio.js';
import Icon from '../components/Icon.jsx';
import Menu from '../components/Menu.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import AddArticleDialog from '../components/AddArticleDialog.jsx';
import ArticleDialog from '../components/ArticleDialog.jsx';
import ArticleRow from '../components/ArticleRow.jsx';
import SavedSentenceItem from '../components/SavedSentenceItem.jsx';
import SavedWordItem from '../components/SavedWordItem.jsx';
import ViewToggle from '../components/ViewToggle.jsx';
import Empty from '../components/Empty.jsx';

const tabs = [['articles', '文章'], ['sentences', '句子'], ['words', '生词']];
const empty = {
  articles: ['还没有文章', '粘贴一段英文，就可以开始逐句听读。'],
  sentences: ['还没有收藏的句子', '在学习页把鼠标移到句子上，点星标即可收藏。'],
  words: ['还没有收藏的生词', '在学习页点击任意单词，即可查看释义并收藏。'],
};

export default function ArticleList() {
  const [adding, setAdding] = useState(false);
  const [articleId, setArticleId] = useState(null);
  const [menu, setMenu] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [backup, setBackup] = useState(null);
  const [readingBackup, setReadingBackup] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();
  const { stop } = usePreviewAudio();
  const data = useLiveQuery(async () => {
    const [articles, sentences, words, settings] = await Promise.all([
      db.articles.orderBy('sortAt').reverse().toArray(),
      db.savedSentences.orderBy('createdAt').reverse().toArray(),
      db.savedWords.orderBy('createdAt').reverse().toArray(),
      db.settings.toArray(),
    ]);
    return { articles, sentences, words, settings: Object.fromEntries(settings.map(setting => [setting.key, setting.value])) };
  }, []);
  const tab = tabs.some(([key]) => key === data?.settings.lastTab) ? data.settings.lastTab : 'articles';
  const views = { sentences: 'full', words: 'full', ...data?.settings.favView };
  const compact = views[tab] === 'compact';
  const ids = new Set(data?.articles.map(article => article.id));
  function openStudy(id) {
    stop();
    location.hash = `#/study/${id}`;
  }
  async function selectTab(next) {
    stop();
    try { await setSetting('lastTab', next); }
    catch (error) { toast(error.message); }
  }
  async function setView(value) {
    setExpanded(new Set());
    try { await setSetting('favView', { ...views, [tab]: value }); }
    catch (error) { toast(error.message); }
  }
  function toggle(key) {
    setExpanded(current => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  async function chooseBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReadingBackup(true);
    try { setBackup(await readBackup(file)); }
    catch (error) { toast(error.message || '这个文件不是 Readio 备份'); }
    finally { setReadingBackup(false); }
  }
  const items = [
    { label: '导出备份', fn: () => exportBackup() },
    { label: '导入备份', disabled: readingBackup, fn: () => fileRef.current?.click() },
  ];
  return <main id="pageList">
    <div className="wrap">
      <header className="l-head">
        <h1 className="wordmark">Readio</h1>
        <div className="right">
          <button className="btn primary" onClick={() => { stop(); setAdding(true); }}><Icon name="plus" width={16} height={16} />添加文章</button>
          <button className="ic" aria-label="更多" aria-haspopup="menu" aria-expanded={!!menu} onClick={event => { const anchor = event.currentTarget; setMenu(current => current ? null : anchor); }}><Icon name="more" /></button>
        </div>
      </header>
      <div className="tabbar">
        <nav className="tabs" role="tablist" aria-label="内容类型">{tabs.map(([key, label]) => <button key={key} className="tab" role="tab" aria-selected={key === tab} aria-controls="listBody" id={`tab-${key}`} onClick={() => selectTab(key)}>
          {label} <span className="cnt num">{data?.[key].length ?? 0}</span>
        </button>)}</nav>
        {tab !== 'articles' && <ViewToggle value={compact ? 'compact' : 'full'} onChange={setView} />}
      </div>
      <section id="listBody" role="tabpanel" aria-labelledby={`tab-${tab}`} aria-busy={!data}>
        {data && !data[tab].length ? <Empty title={empty[tab][0]} description={empty[tab][1]} onAdd={tab === 'articles' ? () => setAdding(true) : null} />
          : data && tab === 'articles' ? <ul className="list">{data.articles.map(article => <ArticleRow key={article.id} article={article} onOpen={id => { stop(); setArticleId(id); }} onStudy={openStudy} />)}</ul>
            : data && tab === 'sentences' ? <div className="list">{data.sentences.map(item => <SavedSentenceItem key={item.id} item={item} articleExists={ids.has(item.articleId)} compact={compact} expanded={expanded.has(`s:${item.id}`)} onToggle={() => toggle(`s:${item.id}`)} />)}</div>
              : data && <div className="list">{data.words.map(item => <SavedWordItem key={item.id} item={item} articleExists={ids.has(item.articleId)} compact={compact} expanded={expanded.has(`w:${item.id}`)} onToggle={() => toggle(`w:${item.id}`)} />)}</div>}
      </section>
      <input type="file" accept=".json,application/json" ref={fileRef} onChange={chooseBackup} hidden aria-label="导入备份文件" />
    </div>
    {menu && <Menu anchor={menu} items={items} onClose={() => setMenu(null)} />}
    {adding && <AddArticleDialog onClose={() => setAdding(false)} onSaved={async () => { await selectTab('articles'); setExpanded(new Set()); }} />}
    {articleId != null && <ArticleDialog articleId={articleId} onClose={() => setArticleId(null)} />}
    {backup && <ConfirmDialog title="导入备份" desc="导入会覆盖当前所有数据，确定吗？" ok="导入" danger onClose={() => setBackup(null)} onConfirm={async () => {
      stop(); await importBackup(backup); setExpanded(new Set()); toast('已导入备份，正在重新生成音频');
    }} />}
  </main>;
}
