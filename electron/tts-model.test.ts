import path from 'node:path';
import os from 'node:os';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { TTS_SETUP_VERSION, assertVoiceProfile17B, describeTtsModel, narrationModelPath, resetTtsDevelopmentData } from './tts-model.js';

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))));
async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-tts-'));
  temporary.push(root); return root;
}

describe('1.7B TTS setup', () => {
  it('defaults to CustomVoice and honors explicitly selected paths', () => {
    const root = path.resolve('resources');
    expect(narrationModelPath(root)).toBe(path.join(root, 'models', 'qwen3-tts-1.7b-customvoice'));
    expect(narrationModelPath(root, '/custom/model')).toBe('/custom/model');
    expect(narrationModelPath(root, undefined, '/environment/model')).toBe('/environment/model');
  });

  it('accepts 1.7B profiles and rejects mismatched or unrecognized embeddings', async () => {
    const root = await workspace();
    const file = path.join(root, 'profile.qvoice');
    const header = Buffer.alloc(12);
    header.write('QVCE'); header.writeUInt32LE(3, 4); header.writeUInt32LE(2048, 8);
    await writeFile(file, header);
    await expect(assertVoiceProfile17B(file)).resolves.toBeUndefined();
    header.writeUInt32LE(1024, 8); await writeFile(file, header);
    await expect(assertVoiceProfile17B(file)).rejects.toThrow('重新克隆');
    const raw = path.join(root, 'profile.bin');
    await writeFile(raw, Buffer.alloc(8192));
    await expect(assertVoiceProfile17B(raw)).resolves.toBeUndefined();
    await writeFile(raw, Buffer.alloc(4096));
    await expect(assertVoiceProfile17B(raw)).rejects.toThrow('重新克隆');
  });

  it('deletes discarded voices and narration cache once, then preserves new voices', async () => {
    const root = await workspace();
    const voices = path.join(root, 'voices');
    const cache = path.join(root, 'cache', 'narration');
    await mkdir(voices, { recursive: true }); await mkdir(cache, { recursive: true });
    await writeFile(path.join(voices, 'discarded.qvoice'), 'discarded');
    await writeFile(path.join(cache, 'discarded.wav'), 'discarded');
    expect(await resetTtsDevelopmentData(root)).toBe(true);
    await expect(access(voices)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(cache)).rejects.toMatchObject({ code: 'ENOENT' });
    await mkdir(voices, { recursive: true });
    const current = path.join(voices, 'current.qvoice'); await writeFile(current, 'current');
    expect(await resetTtsDevelopmentData(root, TTS_SETUP_VERSION)).toBe(false);
    await expect(access(current)).resolves.toBeUndefined();
  });

  it('allows only 1.7B Base and CustomVoice models', async () => {
    const root = await workspace();
    const file = path.join(root, 'config.json');
    await writeFile(file, JSON.stringify({ tts_model_type: 'custom_voice', talker_config: { hidden_size: 2048 } }));
    expect((await describeTtsModel(root)).instructionControl).toBe(true);
    await writeFile(file, JSON.stringify({ tts_model_type: 'base', talker_config: { hidden_size: 2048 } }));
    expect(await describeTtsModel(root)).toMatchObject({ modelType: 'base', instructionControl: false });
    await writeFile(file, JSON.stringify({ tts_model_type: 'custom_voice', talker_config: { hidden_size: 1024 } }));
    await expect(describeTtsModel(root)).rejects.toThrow('仅支持');
  });
});
