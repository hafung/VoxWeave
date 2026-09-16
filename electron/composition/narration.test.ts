import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDraftEditPlan } from '../../shared/edit-plan.js';
import { WavMediaProbe } from '../media/probe.js';
import { NarrationService, narrationCacheKey, type NarrationSynthesizer } from './narration.js';

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true }))));

function wav(milliseconds: number): Buffer {
  const samples = Math.round(24_000 * milliseconds / 1000);
  const data = Buffer.alloc(samples * 2);
  const output = Buffer.alloc(44 + data.length);
  output.write('RIFF'); output.writeUInt32LE(36 + data.length, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22); output.writeUInt32LE(24_000, 24); output.writeUInt32LE(48_000, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(data.length, 40); data.copy(output, 44);
  return output;
}

const voice = {
  language: 'Chinese', temperature: 0.5, topK: 50, topP: 1,
  precision: 'int8' as const, engineVersion: 'test-engine', modelVersion: 'test-model'
};

describe('NarrationService', () => {
  it('generates reusable segments and probes the composed real duration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-narration-')); temporary.push(root);
    const synthesize = vi.fn(async (input: Parameters<NarrationSynthesizer['synthesize']>[0]) => {
      await writeFile(input.outputPath, wav(1200));
    });
    const service = new NarrationService({
      cacheDir: path.join(root, 'cache'), synthesizer: { synthesize }, probe: new WavMediaProbe(), voice
    });
    const plan = createDraftEditPlan({ id: 'narration', script: '第一段。第二段。', voiceId: 'vivian' });
    const first = await service.generate(plan, path.join(root, 'project'));
    const second = await service.generate(plan, path.join(root, 'project-two'));

    expect(first.durationMs).toBe(2400);
    expect(first.segments.map(segment => [segment.startMs, segment.endMs])).toEqual([[0, 1200], [1200, 2400]]);
    expect(second.durationMs).toBe(2400);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it('uses every output-affecting voice option in its stable key', () => {
    const first = narrationCacheKey('  你好\n世界 ', 'vivian', voice);
    const normalized = narrationCacheKey('你好 世界', 'vivian', voice);
    const changed = narrationCacheKey('你好 世界', 'vivian', { ...voice, modelVersion: 'next' });
    expect(first).toBe(normalized);
    expect(changed).not.toBe(first);
  });

  it('stops before spawning synthesis when already cancelled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-narration-')); temporary.push(root);
    const synthesize = vi.fn();
    const service = new NarrationService({
      cacheDir: path.join(root, 'cache'), synthesizer: { synthesize }, probe: new WavMediaProbe(), voice
    });
    const controller = new AbortController(); controller.abort();
    const plan = createDraftEditPlan({ id: 'cancelled', script: '不要启动子进程。', voiceId: 'vivian' });
    await expect(service.generate(plan, path.join(root, 'project'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(synthesize).not.toHaveBeenCalled();
  });
});
