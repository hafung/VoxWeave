// Run with Windows Node after `pnpm build`; uses the bundled Windows FFmpeg.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { mixNarration } from '../dist-electron/electron/media/mix.js';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const ffmpeg = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe');
const output = path.join(root, '.windows-smoke', 'audio-mix-check');
await mkdir(output, { recursive: true });
const file = name => path.join(output, name);
const ff = (...args) => run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

await ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-af', "volume=enable='between(t,1,2)':volume=0", '-ar', '48000', file('narration.wav'));
await ff('-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2',
  '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file('source.mp4'));
await ff('-f', 'lavfi', '-i', 'sine=frequency=180:duration=1', file('bgm.wav'));
const input = file('narration.wav');
const original = (volume, ducking) => ({ path: file('source.mp4'), volume, ducking });
await mixNarration(ffmpeg, input, file('voice.wav'), 3000);
await mixNarration(ffmpeg, input, file('half-voice.wav'), 3000, { narrationVolume: .5 });
await mixNarration(ffmpeg, input, file('original.wav'), 3000, { original: original(.35, false) });
await mixNarration(ffmpeg, input, file('double-original.wav'), 3000, { original: original(.7, false) });
await mixNarration(ffmpeg, input, file('ducked.wav'), 3000, { original: original(.35, true) });
await mixNarration(ffmpeg, input, file('all-tracks.wav'), 3000, {
  original: original(.35, true), bgm: { path: file('bgm.wav'), volume: .2, ducking: true }
});

async function tone(name, second, frequency) {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', file(name), '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  let real = 0; let imaginary = 0;
  const count = 4800;
  for (let index = 0; index < count; index++) {
    const sample = stdout.readFloatLE((Math.round(second * 48000) + index) * 4);
    const phase = 2 * Math.PI * frequency * index / 48000;
    real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) / count;
}

const voiceRatio = await tone('half-voice.wav', .4, 440) / await tone('voice.wav', .4, 440);
const originalRatio = await tone('double-original.wav', 1.4, 220) / await tone('original.wav', 1.4, 220);
const endRatio = await tone('original.wav', 1.4, 220) / Math.max(1e-7, await tone('original.wav', 2.4, 220));
const duckRatio = await tone('original.wav', .4, 220) / await tone('ducked.wav', .4, 220);
const bgmTail = await tone('all-tracks.wav', 2.4, 180);
assert.ok(voiceRatio > .4 && voiceRatio < .6, `Narration level: ${voiceRatio}`);
assert.ok(originalRatio > 1.7 && originalRatio < 2.3, `Original level: ${originalRatio}`);
assert.ok(endRatio > 20, `Original audio should end without looping: ${endRatio}`);
assert.ok(duckRatio > 1.5, `Original audio should duck under narration: ${duckRatio}`);
assert.ok(bgmTail > .001, `BGM should continue after original audio ends: ${bgmTail}`);
console.log('Audio mix smoke passed', { voiceRatio, originalRatio, endRatio, duckRatio, bgmTail });
