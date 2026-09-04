import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeWav } from './wav.js';

const temporary: string[] = [];
function pcmWav(samples: Int16Array, sampleRate = 24_000): Buffer {
  const data = Buffer.from(samples.buffer);
  const out = Buffer.alloc(44 + data.length);
  out.write('RIFF'); out.writeUInt32LE(36 + data.length, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(data.length, 40); data.copy(out, 44); return out;
}

afterEach(async () => Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true }))));

describe('composeWav', () => {
  it('inserts sample-accurate silence between compatible PCM clips', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'voxweave-wav-test-')); temporary.push(dir);
    const first = path.join(dir, 'first.wav'); const second = path.join(dir, 'second.wav'); const output = path.join(dir, 'out.wav');
    await writeFile(first, pcmWav(new Int16Array(2_400).fill(100)));
    await writeFile(second, pcmWav(new Int16Array(2_400).fill(-100)));
    await composeWav([{ path: first }, { pauseMs: 650 }, { path: second }], output);
    const result = await readFile(output); const dataSize = result.readUInt32LE(40);
    expect(dataSize / 2).toBe(2_400 + 15_600 + 2_400);
    expect(result.readInt16LE(44 + 2_400 * 2)).toBe(0);
    expect(result.readInt16LE(44 + (2_400 + 15_600) * 2)).toBe(-100);
  });
});
