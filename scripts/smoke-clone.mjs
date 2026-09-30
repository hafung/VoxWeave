import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const root = path.resolve(import.meta.dirname, '..');
const resources = path.resolve(option('--resources', path.join(root, 'resources')));
const output = path.resolve(option('--output', path.join(root, 'clone-check')));
const load = file => import(pathToFileURL(path.join(root, 'dist-electron', file)).href);
const { QwenEngine } = await load('electron/engine.js');
const { CLONE_TTS_MODEL, DEFAULT_TTS_MODEL, assertVoiceProfile17B, describeTtsModel } = await load('electron/tts-model.js');
const { readWavTiming } = await load('shared/wav.js');
const { alignWithSenseVoiceProcess } = await load('electron/alignment/sensevoice-process.js');
const { alignTextTokens, alignedCaptionCues } = await load('electron/alignment/align-text.js');
await mkdir(output, { recursive: true });
const base = path.join(resources, 'models', CLONE_TTS_MODEL);
const custom = path.join(resources, 'models', DEFAULT_TTS_MODEL);
const engine = new QwenEngine({ enginePath: path.join(resources, 'engine', 'qwen_tts.exe'),
  modelDir: custom, ffmpegPath: path.join(resources, 'ffmpeg', 'ffmpeg.exe') });
const parameters = { outputFormat: 'wav', language: 'Chinese', temperature: .5, topK: 50, topP: 1,
  seed: 42, threads: 4, precision: 'int8' };
const suppliedReference = option('--reference-audio');
const reference = path.resolve(suppliedReference ?? path.join(output, 'reference.wav'));
if (!suppliedReference) {
  console.log('Generating a synthetic male reference with Uncle Fu.');
  await engine.synthesize({ ...parameters, text: '你好，这是用来验证音色克隆的参考声音。让我们开始今天的故事。',
    speaker: 'uncle_fu', automaticProsody: false, outputPath: reference }, () => undefined);
}
const voice = path.join(output, 'cloned.qvoice');
console.log('Extracting the 1.7B Base voice profile.');
let start = performance.now();
await engine.createVoiceProfile(reference, base, voice);
const extractionMs = Math.round(performance.now() - start);
await assertVoiceProfile17B(voice);
const script = option('--text', '你以为，事情就这样结束了？其实，真正的转机才刚刚开始。\n终于，我们做到了！这份喜悦，值得好好记住。');
const narration = path.join(output, 'narration.wav');
console.log('Reading the cloned voice with 1.7B CustomVoice automatic prosody.');
start = performance.now();
await engine.synthesize({ ...parameters, text: script, voicePath: voice, outputPath: narration }, () => undefined);
const synthesisMs = Math.round(performance.now() - start);
const timing = await readWavTiming(narration);
const result = await alignWithSenseVoiceProcess(path.join(resources, 'models/sensevoice-small'), narration);
const tokens = alignTextTokens(script, result.tokens, timing.speechStartMs, timing.speechEndMs);
const aligned = tokens.filter(token => token.source === 'aligned').length;
if (!tokens.length || aligned / tokens.length < .8) throw new Error(`Clone transcript alignment is too low: ${aligned}/${tokens.length}`);
const captions = alignedCaptionCues('clone', script, result.tokens, timing.speechStartMs, timing.speechEndMs);
const comparison = path.join(output, 'output-identity.qvoice');
console.log('Measuring voice identity with the same 1.7B speaker encoder (sample diagnostic).');
await engine.createVoiceProfile(narration, base, comparison);
const vectors = await Promise.all([voice, comparison].map(async file => {
  const bytes = await readFile(file);
  return Array.from({ length: 2048 }, (_, index) => bytes.readFloatLE(12 + index * 4));
}));
let dot = 0, firstNorm = 0, secondNorm = 0;
for (let index = 0; index < 2048; index++) {
  dot += vectors[0][index] * vectors[1][index];
  firstNorm += vectors[0][index] ** 2; secondNorm += vectors[1][index] ** 2;
}
const voiceSimilarityCosine = dot / Math.sqrt(firstNorm * secondNorm);
const report = { ok: true, cpu: os.cpus()[0]?.model, precision: 'int8', threads: 4,
  baseModel: (await describeTtsModel(base)).identity, narrationModel: (await describeTtsModel(custom)).identity,
  reference, referenceSource: suppliedReference ? 'provided' : 'synthetic-uncle-fu', voice, embeddingDimensions: 2048, narration, script,
  extractionMs, synthesisMs, durationMs: timing.durationMs, alignedTokens: aligned, tokenCount: tokens.length,
  voiceSimilarityCosine, captions };
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, captions: undefined }));
