export function getArticleAudioState(audios = [], count = 0) {
  const completedIndices = new Set();
  let pending = 0;
  let failed = 0;
  let stopped = 0;
  let error = '';
  for (const audio of audios) {
    const match = /^s:\d+:(\d+)$/.exec(audio.key);
    const index = match ? Number(match[1]) : -1;
    const validBlob = audio.blob instanceof Blob && audio.blob.size > 0 && /^audio\//i.test(audio.blob.type);
    if (audio.status === 'ok' && validBlob && index >= 0 && index < count) completedIndices.add(index);
    else if (audio.status === 'pending') pending++;
    else if (audio.status === 'stopped') stopped++;
    else if (audio.status === 'fail' || audio.status === 'ok') failed++;
    if (!error && (audio.status === 'fail' || audio.status === 'stopped')) error = audio.error || '';
  }
  const completed = completedIndices.size;
  if (!error && failed) error = '部分音频不可用，请重试生成';
  return { ready: count > 0 && audios.length === count && completed === count,
    pending, failed, stopped, completed, error };
}
