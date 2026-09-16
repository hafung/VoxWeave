import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return path.resolve(index >= 0 ? process.argv[index + 1] : fallback);
}

function stringOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const enginePath = option('--engine', path.join(projectRoot, 'resources', 'engine', 'qwen_tts.exe'));
const modelDir = option('--model', path.join(projectRoot, 'resources', 'models', 'qwen3-tts-0.6b-customvoice'));
const outputPath = option('--output', path.join(projectRoot, '.windows-smoke', 'qwen-engine-adapter.wav'));
const adapterModule = option('--adapter', path.join(projectRoot, 'dist-electron', 'electron', 'engine.js'));
const text = stringOption('--text', '你好。');
const { QwenEngine } = await import(pathToFileURL(adapterModule).href);

const engine = new QwenEngine({ enginePath, modelDir });
const status = await engine.status();
if (status.state !== 'idle' || status.backend !== 'native') {
  throw new Error(`QwenEngine is not ready for native synthesis: ${JSON.stringify(status)}`);
}

const progress = [];
await engine.synthesize({
  text,
  outputPath,
  outputFormat: 'wav',
  language: 'Chinese',
  speaker: 'vivian',
  temperature: 0.5,
  topK: 50,
  topP: 1,
  seed: 42,
  threads: 4,
  precision: 'int8'
}, event => progress.push(event));

const info = await stat(outputPath);
const header = await readFile(outputPath).then(buffer => buffer.subarray(0, 12));
if (info.size <= 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
  throw new Error('QwenEngine did not produce a non-empty WAV file.');
}

console.log(JSON.stringify({
  ok: true,
  platform: process.platform,
  arch: process.arch,
  backend: status.backend,
  text,
  outputPath,
  bytes: info.size,
  phases: [...new Set(progress.map(event => event.phase))]
}, null, 2));
