import { removeSaved, restoreSaved } from '../db.js';
import { tokenize } from '../text.js';
import { usePreviewAudio } from '../usePreviewAudio.js';
import { useToast } from '../toast.jsx';
import Icon from './Icon.jsx';

export default function SavedWordItem({ item, articleExists, compact = false, expanded = false, onToggle }) {
  const toast = useToast();
  const { playingKey, play, stop } = usePreviewAudio();
  const key = `w:${item.word.toLowerCase()}`;
  const playing = playingKey === key;
  async function remove() {
    try {
      const previous = await removeSaved('savedWords', item.id);
      if (playing) stop();
      if (previous) toast('已取消收藏', { label: '撤销', fn: () => restoreSaved('savedWords', previous).catch(error => toast(error.message)) });
    } catch (error) { toast(error.message); }
  }
  const say = (iconOnly = false) => <button className={`${iconOnly ? 'ic' : 'act'}${playing ? ' on' : ''}`} aria-label="发音" onClick={event => { event.stopPropagation(); play(key, item.word); }}>
    <Icon name="speaker" />{!iconOnly && '发音'}
  </button>;
  if (compact && !expanded) return <div className="fav compact" role="button" tabIndex={0} aria-expanded="false" onClick={onToggle} onKeyDown={event => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onToggle(); }
  }}>
    <span className="word-mid">{item.word}</span>{say(true)}
  </div>;
  return <div className="fav">
    <div className="word-line"><span className="word-big">{item.word}</span><span className="phon">{item.phonetic}</span></div>
    <p className="def"><span className="pos">{item.pos}</span>{item.meaning}</p>
    <p className="quote">{tokenize(item.sentence).map((token, index) => token.type === 'word' && token.value.toLowerCase() === item.word.toLowerCase()
      ? <b key={index}>{token.value}</b> : token.value)}</p>
    <p className="fav-src">{articleExists ? `来自《${item.articleTitle}》第 ${item.idx + 1} 句` : `来自《${item.articleTitle}》（原文已删除）`}</p>
    <div className="fav-acts">
      {say()}
      <button className="act" disabled={!articleExists} onClick={() => { stop(); location.hash = `#/study/${item.articleId}?focus=${item.idx}`; }}><Icon name="open" />回到原文</button>
      <button className="act" onClick={remove}><Icon name="starOn" />取消收藏</button>
      {compact && <button className="act" onClick={onToggle}>收起</button>}
    </div>
  </div>;
}
