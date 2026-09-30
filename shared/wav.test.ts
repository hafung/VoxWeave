import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composeSpeechWav, composeWav } from './wav.js';

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

  it('counts natural edge silence toward a paragraph gap and never removes quiet speech', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'voxweave-natural-gap-')); temporary.push(dir);
    const first = path.join(dir, 'first.wav'); const second = path.join(dir, 'second.wav'); const output = path.join(dir, 'out.wav');
    const a = new Int16Array(24_000); a.fill(1000, 0, 19_200);
    const b = new Int16Array(24_000); b.fill(-1000, 4_800);
    await writeFile(first, pcmWav(a)); await writeFile(second, pcmWav(b));
    const intervals = await composeSpeechWav([{ path: first, pauseAfterMs: 420 }, { path: second, pauseAfterMs: 0 }], output);
    expect(intervals[0]).toMatchObject({ speechEndMs: 820, endMs: 1060 });
    expect(intervals[1]).toMatchObject({ startMs: 1060, speechStartMs: 1240, endMs: 2060 });
    const result = await readFile(output);
    expect(result.readUInt32LE(40)).toBe(2060 * 48);
    expect(result.readInt16LE(44)).toBe(1000);
    expect(result.readInt16LE(result.length - 2)).toBe(-1000);
  });

  it('writes leading silence instead of silently dropping it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'voxweave-leading-pause-')); temporary.push(dir);
    const input = path.join(dir, 'input.wav'); const output = path.join(dir, 'output.wav');
    await writeFile(input, pcmWav(new Int16Array(2400).fill(1000)));
    await composeWav([{ pauseMs: 300 }, { path: input }], output);
    const result = await readFile(output);
    expect(result.readUInt32LE(40)).toBe(400 * 48);
    expect(result.readInt16LE(44)).toBe(0);
    expect(result.readInt16LE(44 + 300 * 48)).toBe(1000);
  });
});
