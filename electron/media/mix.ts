import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function mixArguments(narration: string, output: string, durationMs: number,
  bgm?: { path: string; volume: number; ducking: boolean }): string[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('无效的旁白时长');
  if (bgm && (!Number.isFinite(bgm.volume) || bgm.volume < 0 || bgm.volume > 1)) throw new Error('无效的配乐音量');
  const duration = durationMs / 1000;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', narration];
  let graph = '[0:a]aresample=48000,aformat=channel_layouts=stereo,apad[n]';
  if (bgm) {
    args.push('-stream_loop', '-1', '-i', bgm.path);
    graph += `;[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${bgm.volume},afade=t=in:d=${Math.min(.5, duration / 4)},afade=t=out:st=${Math.max(0, duration - 1)}:d=${Math.min(1, duration)}[b]`;
    graph += bgm.ducking
      ? ';[n]asplit=2[voice][side];[b][side]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=350[duck];[voice][duck]amix=inputs=2:duration=first:normalize=0[m]'
      : ';[n][b]amix=inputs=2:duration=first:normalize=0[m]';
  }
  graph += `;[${bgm ? 'm' : 'n'}]atrim=duration=${duration},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  return [...args, '-filter_complex', graph, '-map', '[out]', '-t', String(duration), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output];
}

export async function mixNarration(ffmpeg: string, narration: string, output: string, durationMs: number,
  bgm?: { path: string; volume: number; ducking: boolean }, signal?: AbortSignal): Promise<void> {
  await run(ffmpeg, mixArguments(narration, output, durationMs, bgm), { windowsHide: true, signal, maxBuffer: 4 * 1024 * 1024 });
}
