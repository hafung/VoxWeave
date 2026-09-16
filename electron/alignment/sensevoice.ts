import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RecognizedToken } from './align-text.js';

const require = createRequire(import.meta.url);

const ResourceDescriptorSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional()
}).strict();

const ResourceManifestSchema = z.object({
  version: z.string().min(1),
  source: z.string().url(),
  license: z.string().min(1),
  files: z.object({
    model: ResourceDescriptorSchema,
    tokens: ResourceDescriptorSchema,
    sileroVad: ResourceDescriptorSchema
  }).strict(),
  notices: z.record(z.string(), ResourceDescriptorSchema.extend({ revision: z.string().optional() })).optional()
}).strict();

export interface SenseVoiceResources {
  model: string;
  tokens: string;
  sileroVad: string;
  version: string;
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function verifySenseVoiceResources(root: string): Promise<SenseVoiceResources> {
  const resolvedRoot = path.resolve(root);
  const manifest = ResourceManifestSchema.parse(JSON.parse(await readFile(path.join(resolvedRoot, 'manifest.json'), 'utf8')));
  const entries = Object.entries(manifest.files) as Array<[keyof typeof manifest.files, { path: string; sha256?: string }]>;
  const resolved = {} as Record<keyof typeof manifest.files, string>;
  for (const [name, descriptor] of entries) {
    const file = path.resolve(resolvedRoot, descriptor.path);
    if (file !== resolvedRoot && !file.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`SenseVoice 资源路径越界：${name}`);
    await access(file);
    if (descriptor.sha256 && await sha256(file) !== descriptor.sha256) throw new Error(`SenseVoice 资源校验失败：${name}`);
    resolved[name] = file;
  }
  return { ...resolved, version: manifest.version };
}

interface SherpaResult { tokens: string[]; timestamps: number[]; durations: number[]; ys_log_probs?: number[] }
interface SherpaModule {
  readWave(file: string): { samples: Float32Array; sampleRate: number };
  Vad: new (config: unknown, bufferSizeInSeconds: number) => {
    acceptWaveform(samples: Float32Array): void; isEmpty(): boolean;
    front(): { start: number; samples: Float32Array }; pop(): void; flush(): void;
  };
  OfflineRecognizer: { createAsync(config: unknown): Promise<{
    createStream(): { acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void };
    decodeAsync(stream: unknown): Promise<SherpaResult>;
  }> };
}

export class SenseVoiceAdapter {
  constructor(private readonly resources: SenseVoiceResources) {}

  async transcribe(audioPath: string, signal?: AbortSignal): Promise<RecognizedToken[]> {
    if (signal?.aborted) throw new DOMException('字幕对齐已取消', 'AbortError');
    const sherpa = require('sherpa-onnx-node') as SherpaModule;
    const recognizer = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: this.resources.model, language: 'zh', useInverseTextNormalization: 1 },
        tokens: this.resources.tokens, numThreads: 4, provider: 'cpu', debug: 0
      }
    });
    if (signal?.aborted) throw new DOMException('字幕对齐已取消', 'AbortError');
    const stream = recognizer.createStream();
    stream.acceptWaveform(sherpa.readWave(audioPath));
    const result = await recognizer.decodeAsync(stream);
    return (result.tokens ?? []).map((text, index) => {
      const startSeconds = result.timestamps?.[index] ?? 0;
      const durationSeconds = result.durations?.[index];
      const logProbability = result.ys_log_probs?.[index];
      return {
        text,
        startMs: Math.max(0, Math.round(startSeconds * 1000)),
        endMs: durationSeconds === undefined ? undefined : Math.max(1, Math.round((startSeconds + durationSeconds) * 1000)),
        confidence: logProbability === undefined ? undefined : Math.max(0, Math.min(1, Math.exp(logProbability)))
      };
    });
  }

  async speechEndMs(audioPath: string): Promise<number | undefined> {
    const sherpa = require('sherpa-onnx-node') as SherpaModule;
    const wave = sherpa.readWave(audioPath);
    const sampleRate = 16_000;
    const samples = wave.sampleRate === sampleRate ? wave.samples : resampleLinear(wave.samples, wave.sampleRate, sampleRate);
    const vad = new sherpa.Vad({
      sileroVad: {
        model: this.resources.sileroVad, threshold: 0.5, minSilenceDuration: 0.25,
        minSpeechDuration: 0.1, windowSize: 512, maxSpeechDuration: 30
      },
      sampleRate, numThreads: 1, provider: 'cpu', debug: 0
    }, Math.max(10, Math.ceil(samples.length / sampleRate) + 2));
    for (let offset = 0; offset < samples.length; offset += 512) vad.acceptWaveform(samples.slice(offset, offset + 512));
    vad.flush();
    let endSample: number | undefined;
    while (!vad.isEmpty()) {
      const segment = vad.front();
      endSample = Math.max(endSample ?? 0, segment.start + segment.samples.length);
      vad.pop();
    }
    return endSample === undefined ? undefined : Math.round(endSample / sampleRate * 1000);
  }
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0) throw new Error('无效的音频采样率');
  const output = new Float32Array(Math.max(1, Math.round(input.length * targetRate / sourceRate)));
  for (let index = 0; index < output.length; index++) {
    const position = index * sourceRate / targetRate;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}
