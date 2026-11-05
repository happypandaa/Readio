import { useState } from 'react';
import Icon from './Icon.jsx';
import Menu from './Menu.jsx';

function AudioHint({ state, duration, generating, onGenerate }) {
  if (state.ready) return null;
  if (state.pending) return <small role="status">生成中 {state.completed}/{state.completed + state.pending + state.failed + state.stopped + state.idle}</small>;
  if (state.idle && !state.completed && !state.failed && !state.stopped) return <small>
    <button className="link" disabled={generating} onClick={onGenerate}>生成音频{duration && <span className="p-dur">（{duration}）</span>}</button></small>;
  return <small>
    <button className="link" disabled={generating} onClick={onGenerate}>{state.failed ? '重试生成音频' : '继续生成音频'}</button></small>;
}

export default function PlayerBar({ current, count, playing, waiting, audios, ready = false, audioState, duration, generating, onGenerate,
  speed, onToggle, onStep, onSeek, onSpeed }) {
  const [anchor, setAnchor] = useState(null);
  const statuses = new Map(audios.map(item => [Number(item.key.split(':').at(-1)), item.status]));
  return <footer className="player" id="player">
    <div className="wrap">
      <div className="ticks" id="ticks" role="group" aria-label="句子进度" style={{ gap: count > 80 ? 0 : 2 }}>
        {Array.from({ length: count }, (_, index) => <button key={index}
          className={['tk', statuses.get(index) !== 'ok' && (statuses.get(index) === 'fail' ? 'fail' : 'pend'), current === index && 'cur'].filter(Boolean).join(' ')}
          title={`第 ${index + 1} 句`} aria-label={`跳到第 ${index + 1} 句`} aria-pressed={current === index} onClick={() => onSeek(index)}><i /></button>)}
      </div>
      <div className="p-row">
        <div className="p-pos num" id="pPos">{current + 1} / {count}{!ready ? <AudioHint state={audioState} duration={duration} generating={generating} onGenerate={onGenerate} /> : waiting && <small role="status">加载音频…</small>}</div>
        <div className="p-ctrl">
          <button className="ic" id="prevBtn" aria-label="上一句" disabled={current === 0} onClick={() => onStep(-1)}><Icon name="prev" /></button>
          <button className="p-play" id="playBtn" disabled={!ready} title={!ready ? (audioState?.pending ? '音频全部生成后可播放' : '生成音频后可以播放') : playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'} onClick={onToggle}><Icon name={playing ? 'pause' : 'play'} /></button>
          <button className="ic" id="nextBtn" aria-label="下一句" disabled={current >= count - 1} onClick={() => onStep(1)}><Icon name="next" /></button>
        </div>
        <div className="p-speed"><button className="speed-btn num" id="speedBtn" aria-label={`语速 ${Number(speed).toFixed(1)} 倍`} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(event.currentTarget)}>{Number(speed).toFixed(1)}×</button></div>
      </div>
    </div>
    <Menu anchor={anchor} above onClose={() => setAnchor(null)} items={[0.6, 0.8, 1, 1.2, 1.5].map(value => ({
      label: `${value.toFixed(1)}×`, cls: value === speed ? 'sel' : '', fn: () => onSpeed(value),
    }))} />
  </footer>;
}
