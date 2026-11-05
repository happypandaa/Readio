// 「译文」开关打开时，正文上方提示还有多少句没有译文，可以一次翻译其余的句子。
export default function TranslationBar({ sentences, running, failed, onTranslate, onStop }) {
  const total = sentences.length;
  const done = sentences.filter(sentence => sentence.zh).length;
  const rest = total - done;
  if (!total || (!rest && !running)) return null;
  return <div className={`tr-bar${failed && !running ? ' has-error' : ''}`} role="status">
    {running ? <>
      <span className="generation-label"><span className="pulse" /><span className="num">正在翻译 {done} / {total} 句</span></span>
      <button className="link" onClick={onStop}>停止</button>
    </> : <>
      <span className="num">{failed ? `已翻译 ${done} / ${total} 句，${failed} 句翻译失败` : `已翻译 ${done} / ${total} 句`}</span>
      <button className="link" onClick={onTranslate}>{failed ? '重试' : `翻译其余 ${rest} 句`}</button>
    </>}
  </div>;
}
