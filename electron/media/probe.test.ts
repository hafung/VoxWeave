import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WavMediaProbe } from './probe.js';

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true }))));

it('reads WAV duration without trusting a filename extension', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-probe-')); temporary.push(root);
  const output = Buffer.alloc(44 + 48_000);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22); output.writeUInt32LE(24_000, 24); output.writeUInt32LE(48_000, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(48_000, 40);
  const file = path.join(root, 'audio.bin'); await writeFile(file, output);
  expect((await new WavMediaProbe().probe(file)).durationMs).toBe(1000);
});
