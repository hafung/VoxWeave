import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { EditPlan } from '../../shared/edit-plan.js';
import { composeWav } from '../../shared/wav.js';
import type { MediaProbe } from '../media/probe.js';

export interface NarrationVoiceOptions {
  language: string;
  temperature: number;
  topK: number;
  topP: number;
  seed?: number;
  precision: 'bf16' | 'int8' | 'int4';
  engineVersion: string;
  modelVersion: string;
}

export interface NarrationProgress {
  phase: 'preparing' | 'generating' | 'composing' | 'probing';
  progress: number;
  message: string;
}

export interface SegmentSynthesisInput extends NarrationVoiceOptions {
  text: string;
  voiceId: string;
  outputPath: string;
  signal?: AbortSignal;
}

export interface NarrationSynthesizer {
  synthesize(input: SegmentSynthesisInput): Promise<void>;
}

export interface NarrationArtifact {
  audioPath: string;
  durationMs: number;
  segments: EditPlan['narration']['segments'];
}

export interface NarrationServiceOptions {
  cacheDir: string;
  synthesizer: NarrationSynthesizer;
  probe: MediaProbe;
  voice: NarrationVoiceOptions;
}

function abortError(): Error {
  return new DOMException('旁白生成已取消', 'AbortError');
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export function narrationCacheKey(text: string, voiceId: string, options: NarrationVoiceOptions): string {
  const normalizedText = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return createHash('sha256').update(JSON.stringify({ normalizedText, voiceId, ...options })).digest('hex');
}

export class NarrationService {
  constructor(private readonly options: NarrationServiceOptions) {}

  async generate(
    plan: EditPlan,
    workspace: string,
    signal?: AbortSignal,
    onProgress: (event: NarrationProgress) => void = () => undefined
  ): Promise<NarrationArtifact> {
    if (plan.status !== 'draft') throw new Error('只有 draft EditPlan 可以生成旁白');
    if (signal?.aborted) throw abortError();
    await mkdir(this.options.cacheDir, { recursive: true });
    const narrationDir = path.join(workspace, 'narration');
    await mkdir(narrationDir, { recursive: true });
    onProgress({ phase: 'preparing', progress: 0.02, message: '正在准备分段旁白…' });

    const generated: Array<{ id: string; text: string; file: string; durationMs: number }> = [];
    for (const [index, scene] of plan.scenes.entries()) {
      if (signal?.aborted) throw abortError();
      const key = narrationCacheKey(scene.script, plan.narration.voiceId, this.options.voice);
      const cached = path.join(this.options.cacheDir, `${key}.wav`);
      if (!await exists(cached)) {
        const pending = path.join(this.options.cacheDir, `.${key}.${process.pid}.wav`);
        try {
          await this.options.synthesizer.synthesize({
            ...this.options.voice,
            text: scene.script,
            voiceId: plan.narration.voiceId,
            outputPath: pending,
            signal
          });
          if (signal?.aborted) throw abortError();
          try { await copyFile(pending, cached, 1); } catch (error) {
            const code = error instanceof Error && 'code' in error ? error.code : undefined;
            if (code !== 'EEXIST') throw error;
          }
        } finally { await rm(pending, { force: true }); }
      }
      const segmentFile = path.join(narrationDir, `${scene.id}.wav`);
      await copyFile(cached, segmentFile);
      const metadata = await this.options.probe.probe(segmentFile);
      if (!metadata.durationMs) throw new Error(`旁白分段 ${scene.id} 缺少有效时长`);
      generated.push({ id: scene.id, text: scene.script, file: segmentFile, durationMs: metadata.durationMs });
      onProgress({
        phase: 'generating',
        progress: 0.05 + 0.8 * (index + 1) / plan.scenes.length,
        message: `已完成第 ${index + 1}/${plan.scenes.length} 段旁白`
      });
    }

    if (signal?.aborted) throw abortError();
    const audioPath = path.join(narrationDir, 'narration.wav');
    onProgress({ phase: 'composing', progress: 0.9, message: '正在拼接旁白…' });
    await composeWav(generated.map(segment => ({ path: segment.file })), audioPath);
    if (signal?.aborted) throw abortError();
    onProgress({ phase: 'probing', progress: 0.96, message: '正在读取真实音频时长…' });
    const total = await this.options.probe.probe(audioPath);
    if (!total.durationMs) throw new Error('拼接旁白缺少有效时长');

    let cursor = 0;
    const segments = generated.map((segment, index) => {
      const endMs = index === generated.length - 1 ? total.durationMs! : cursor + segment.durationMs;
      const result = { id: segment.id, text: segment.text, startMs: cursor, endMs, audioPath: segment.file };
      cursor = endMs;
      return result;
    });
    return { audioPath, durationMs: total.durationMs, segments };
  }
}
