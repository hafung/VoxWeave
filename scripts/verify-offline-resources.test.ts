import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporary: string[] = [];
const required = [
  'engine/qwen_tts.exe',
  'engine/libopenblas.dll',
  'engine/libwinpthread-1.dll',
  'engine/QWEN3-TTS-C-LICENSE',
  'engine/INGOT-LICENSE',
  'engine/OPENBLAS-LICENSE',
  'engine/LZ4-LICENSE',
  'engine/WINPTHREADS-LICENSE',
  'engine/THIRD-PARTY-NOTICES.txt',
  'engine/build-info.json',
  'engine/manifest.json',
  'models/qwen3-tts-0.6b-customvoice/config.json',
  'models/qwen3-tts-0.6b-customvoice/generation_config.json',
  'models/qwen3-tts-0.6b-customvoice/tokenizer_config.json',
  'models/qwen3-tts-0.6b-customvoice/preprocessor_config.json',
  'models/qwen3-tts-0.6b-customvoice/model.safetensors',
  'models/qwen3-tts-0.6b-customvoice/vocab.json',
  'models/qwen3-tts-0.6b-customvoice/merges.txt',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/config.json',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/configuration.json',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/preprocessor_config.json',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/model.safetensors',
  'models/qwen3-tts-0.6b-customvoice/MODEL-LICENSE.txt',
  'models/qwen3-tts-0.6b-customvoice/manifest.json',
  'models/qwen3-tts-0.6b-base/config.json',
  'models/qwen3-tts-0.6b-base/generation_config.json',
  'models/qwen3-tts-0.6b-base/tokenizer_config.json',
  'models/qwen3-tts-0.6b-base/preprocessor_config.json',
  'models/qwen3-tts-0.6b-base/model.safetensors',
  'models/qwen3-tts-0.6b-base/vocab.json',
  'models/qwen3-tts-0.6b-base/merges.txt',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/config.json',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/configuration.json',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/preprocessor_config.json',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/model.safetensors',
  'models/qwen3-tts-0.6b-base/MODEL-LICENSE.txt',
  'models/qwen3-tts-0.6b-base/manifest.json',
  'models/sensevoice-small/model.int8.onnx',
  'models/sensevoice-small/tokens.txt',
  'models/sensevoice-small/silero_vad.onnx',
  'models/sensevoice-small/SENSEVOICE-LICENSE',
  'models/sensevoice-small/SENSEVOICE-MODEL-LICENSE',
  'models/sensevoice-small/SILERO-LICENSE',
  'models/sensevoice-small/manifest.json',
  'ffmpeg/ffmpeg.exe',
  'ffmpeg/ffprobe.exe',
  'ffmpeg/LICENSE.txt',
  'ffmpeg/manifest.json',
  'cli/voxweave.cmd'
];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-offline-'));
  temporary.push(root);
  for (const relative of required) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, relative.endsWith('manifest.json') ? '{"files":{}}\n' : `fixture:${relative}`);
  }
  return root;
}

describe('offline resource verifier', () => {
  it('writes a hash manifest for a complete external resource directory', async () => {
    const root = await fixture();
    await execFileAsync(process.execPath, [
      path.resolve('scripts/verify-offline-resources.mjs'), '--root', root, '--write-manifest'
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'offline-manifest.json'), 'utf8'));
    expect(manifest.layout).toBe('directory-portable');
    expect(manifest.files).toHaveLength(required.length);
    expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fails before packaging when a required binary is absent', async () => {
    const root = await fixture();
    await rm(path.join(root, 'engine/qwen_tts.exe'));
    await expect(execFileAsync(process.execPath, [
      path.resolve('scripts/verify-offline-resources.mjs'), '--root', root
    ])).rejects.toMatchObject({ code: 1 });
  });

  it('rejects a changed bundled model notice', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'models/sensevoice-small/manifest.json'), JSON.stringify({
      files: {},
      notices: {
        modelTerms: {
          path: 'SENSEVOICE-MODEL-LICENSE',
          sha256: '0'.repeat(64)
        }
      }
    }));
    await expect(execFileAsync(process.execPath, [
      path.resolve('scripts/verify-offline-resources.mjs'), '--root', root
    ])).rejects.toMatchObject({ code: 1 });
  });
});
