// Run the compiled file with Windows Node. Generates its own fixtures; no TTS model required.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDraftEditPlan, EditPlanSchema } from '../../shared/edit-plan.js';
import { resolveEditPlan } from '../composition/resolver.js';
import { HyperframesPreviewRenderer } from './hyperframes.js';
import { FfprobeMediaProbe } from '../media/probe.js';

const run = promisify(execFile);
const root = path.resolve(process.argv[2] || 'resources');
const output = path.resolve(process.argv[3] || '.windows-smoke/export-check');
await mkdir(output, { recursive: true });
const tools = { ffmpegPath: path.join(root, 'ffmpeg', 'ffmpeg.exe'), ffprobePath: path.join(root, 'ffmpeg', 'ffprobe.exe'),
  chromePath: path.join(root, 'browser', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') };
const ff = (...args: string[]) => run(tools.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
const audio = path.join(output, 'narration.wav');
const bgm = path.join(output, 'bgm.wav');
const video = path.join(output, 'source.mp4');
const image = path.join(output, 'image.jpg');
await ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-af', "volume=enable='between(t,1,2)':volume=0", '-ar', '24000', audio);
await ff('-f', 'lavfi', '-i', 'sine=frequency=180:duration=1', bgm);
await ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1', '-c:v', 'libx264', video);
await ff('-f', 'lavfi', '-i', 'color=c=steelblue:size=640x360', '-frames:v', '1', image);
const draft = createDraftEditPlan({ id: 'export-smoke', script: '字幕渲染验证。', voiceId: 'vivian', sourceVideoPath: video, aspectRatio: '16:9' });
const resolved = resolveEditPlan(draft, { sourceMetadata: { durationMs: 1000, hasAudio: false }, narration: {
  audioPath: audio, durationMs: 3000, segments: [{ id: 'scene-001', text: '字幕渲染验证。', startMs: 0, endMs: 3000, audioPath: audio }]
} });
resolved.canvas.width = 640; resolved.canvas.height = 360;
const fallback = resolved.scenes[1];
resolved.scenes = [resolved.scenes[0], { ...fallback, id: 'image', endMs: 2000, visual: { ...fallback.visual, type: 'image', assetId: 'image' } },
  { ...fallback, id: 'kinetic', startMs: 2000 }];
const renderer = new HyperframesPreviewRenderer(id => id === 'source-video' ? video : id === 'image' ? image : bgm, tools);
const checks = [];
for (const withBgm of [false, true]) {
  const plan = EditPlanSchema.parse({ ...resolved, bgm: { enabled: withBgm, assetId: withBgm ? 'bgm' : undefined, volume: .2, ducking: true } });
  const workspace = path.join(output, withBgm ? 'with-bgm' : 'voice-only');
  const composition = await renderer.prepare(plan, workspace);
  const outputPath = path.join(output, withBgm ? 'with-bgm.mp4' : 'voice-only.mp4');
  let lastProgress = -1;
  await renderer.render({ jobId: randomUUID(), composition, outputPath }, event => {
    const bucket = Math.floor(event.progress * 10);
    if (bucket !== lastProgress) { console.log(event.phase, event.progress.toFixed(2), event.message); lastProgress = bucket; }
  });
  const info = await new FfprobeMediaProbe(tools.ffprobePath).probe(outputPath);
  assert.equal(info.width, 640); assert.equal(info.height, 360); assert.equal(info.fps, 30);
  assert.equal(info.videoCodec, 'h264'); assert.equal(info.audioCodec, 'aac');
  assert.ok(Math.abs(info.durationMs! - 3000) < 150);
  await ff('-ss', '1.5', '-i', outputPath, '-frames:v', '1', path.join(output, withBgm ? 'with-bgm-frame.png' : 'voice-frame.png'));
  checks.push({ withBgm, ...info, outputPath });
}
const { stdout: pcm } = await run(tools.ffmpegPath, ['-v', 'error', '-i', path.join(output, 'with-bgm', 'mixed.wav'),
  '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { encoding: 'buffer', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
function amplitudeAt(time: number): number {
  let re = 0, im = 0; const count = 9600;
  for (let index = 0; index < count; index++) {
    const sample = pcm.readFloatLE((Math.round(time * 48000) + index) * 4);
    re += sample * Math.cos(2 * Math.PI * 180 * index / 48000);
    im += sample * Math.sin(2 * Math.PI * 180 * index / 48000);
  }
  return Math.hypot(re, im) / count;
}
const duckingRatio = amplitudeAt(1.6) / amplitudeAt(.6);
assert.ok(duckingRatio > 1.5, `BGM should recover during narration silence; ratio=${duckingRatio}`);
const protectedPath = path.join(output, 'cancel-protected.mp4');
await writeFile(protectedPath, 'keep original');
const composition = await renderer.prepare(resolved, path.join(output, 'cancel'));
const jobId = randomUUID();
let cancelled = false;
await assert.rejects(renderer.render({ jobId, composition, outputPath: protectedPath }, event => {
  if (!cancelled && event.phase === 'capturing' && event.progress > .3) { cancelled = true; void renderer.cancel(jobId); }
}), /取消/);
assert.equal(await readFile(protectedPath, 'utf8'), 'keep original');
assert.equal((await readdir(output)).some(file => file.endsWith('.partial.mp4')), false);
await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks, cancellation: true, duckingRatio }, null, 2));
console.log('Export smoke passed', output);
