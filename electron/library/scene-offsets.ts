import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MediaAsset } from '../../shared/library.js';

const execFileAsync = promisify(execFile);
const cache = new Map<string, number[]>();

export async function sceneOffsets(asset: MediaAsset, sceneDurationMs: number, ffmpegPath?: string): Promise<number[]> {
  const duration = asset.durationMs;
  if (!duration || duration < sceneDurationMs) return [];
  const maxStart = duration - sceneDurationMs;
  const fallback = [0, Math.floor(maxStart / 3), Math.floor(maxStart * 2 / 3), maxStart];
  if (!ffmpegPath || maxStart < 1000) return [...new Set(fallback)];
  const key = `${asset.fingerprint}:${duration}`;
  let cuts = cache.get(key);
  if (!cuts) {
    try {
      const { stderr } = await execFileAsync(ffmpegPath, [
        '-hide_banner', '-nostdin', '-i', asset.filePath, '-t', '90',
        '-vf', "fps=2,scale=160:-2,select='gt(scene,0.35)',showinfo", '-an', '-f', 'null', '-'
      ], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      cuts = [...stderr.matchAll(/pts_time:([\d.]+)/gu)].map(match => Math.round(Number(match[1]) * 1000))
        .filter(ms => Number.isFinite(ms) && ms > 0 && ms <= maxStart);
    } catch { cuts = []; }
    if (cache.size > 300) cache.clear();
    cache.set(key, cuts);
  }
  return [...new Set([0, ...cuts, ...fallback])].sort((a, b) => a - b);
}
