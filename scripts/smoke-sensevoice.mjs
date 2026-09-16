import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return path.resolve(index >= 0 ? process.argv[index + 1] : fallback);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const resources = option('--resources', path.join(projectRoot, 'resources', 'models', 'sensevoice-small'));
const audio = option('--audio', path.join(projectRoot, 'engine', 'qwen3-tts-c', 'samples', '10s_back_down_the_road_24k.wav'));
const adapterModule = option('--adapter', path.join(projectRoot, 'dist-electron', 'electron', 'alignment', 'sensevoice.js'));
const { SenseVoiceAdapter, verifySenseVoiceResources } = await import(pathToFileURL(adapterModule).href);

const verified = await verifySenseVoiceResources(resources);
const adapter = new SenseVoiceAdapter(verified);
const tokens = await adapter.transcribe(audio);
const speechEndMs = await adapter.speechEndMs(audio);
if (tokens.length === 0) throw new Error('SenseVoice returned no tokens for the smoke sample.');
if (!Number.isFinite(speechEndMs) || speechEndMs <= 0) throw new Error('Silero VAD returned no speech segment for the smoke sample.');

console.log(JSON.stringify({
  ok: true,
  platform: process.platform,
  arch: process.arch,
  resourceVersion: verified.version,
  tokenCount: tokens.length,
  transcript: tokens.map(token => token.text).join(''),
  speechEndMs
}, null, 2));
