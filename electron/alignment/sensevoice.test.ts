import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifySenseVoiceResources } from './sensevoice.js';

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true }))));

describe('SenseVoice resource closure', () => {
  it('rejects a manifest whose required model files are missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-sensevoice-')); temporary.push(root);
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      version: 'test', source: 'https://example.com/model', license: 'Apache-2.0',
      files: { model: { path: 'model.onnx' }, tokens: { path: 'tokens.txt' }, sileroVad: { path: 'silero.onnx' } }
    }));
    await expect(verifySenseVoiceResources(root)).rejects.toThrow();
  });

  it('accepts a complete pinned manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-sensevoice-')); temporary.push(root);
    await Promise.all(['model.onnx', 'tokens.txt', 'silero.onnx'].map(file => writeFile(path.join(root, file), file)));
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      version: 'test-v1', source: 'https://example.com/model', license: 'Apache-2.0',
      files: { model: { path: 'model.onnx' }, tokens: { path: 'tokens.txt' }, sileroVad: { path: 'silero.onnx' } }
    }));
    expect(await verifySenseVoiceResources(root)).toMatchObject({ version: 'test-v1' });
  });
});
