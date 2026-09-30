import { readFile, writeFile } from 'node:fs/promises';

interface PcmWav { sampleRate: number; channels: number; bitsPerSample: number; data: Buffer }

function decodeWav(buffer: Buffer): PcmWav {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('只支持标准 RIFF/WAVE 音频');
  }
  let offset = 12;
  let format: Omit<PcmWav, 'data'> | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(start);
      if (audioFormat !== 1) throw new Error('合成片段不是 PCM WAV');
      format = {
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    } else if (id === 'data') {
      data = buffer.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw new Error('WAV 缺少 fmt 或 data 区块');
  return { ...format, data };
}

function encodeWav(wav: PcmWav): Buffer {
  const byteRate = wav.sampleRate * wav.channels * wav.bitsPerSample / 8;
  const blockAlign = wav.channels * wav.bitsPerSample / 8;
  const output = Buffer.allocUnsafe(44 + wav.data.length);
  output.write('RIFF', 0); output.writeUInt32LE(36 + wav.data.length, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20);
  output.writeUInt16LE(wav.channels, 22); output.writeUInt32LE(wav.sampleRate, 24);
  output.writeUInt32LE(byteRate, 28); output.writeUInt16LE(blockAlign, 32); output.writeUInt16LE(wav.bitsPerSample, 34);
  output.write('data', 36); output.writeUInt32LE(wav.data.length, 40); wav.data.copy(output, 44);
  return output;
}

export async function composeWav(parts: Array<{ path?: string; pauseMs?: number }>, outputPath: string): Promise<void> {
  let format: Omit<PcmWav, 'data'> | undefined;
  const chunks: Buffer[] = [];
  let leadingPauseMs = 0;
  for (const part of parts) {
    if (part.path) {
      const wav = decodeWav(await readFile(part.path));
      if (!format) format = wav;
      if (wav.sampleRate !== format.sampleRate || wav.channels !== format.channels || wav.bitsPerSample !== format.bitsPerSample) {
        throw new Error('合成片段的采样格式不一致');
      }
      if (leadingPauseMs) {
        const frames = Math.round(format.sampleRate * leadingPauseMs / 1000);
        chunks.push(Buffer.alloc(frames * format.channels * format.bitsPerSample / 8));
        leadingPauseMs = 0;
      }
      chunks.push(wav.data);
    } else if (part.pauseMs && format) {
      const length = Math.round(format.sampleRate * format.channels * (format.bitsPerSample / 8) * part.pauseMs / 1000);
      chunks.push(Buffer.alloc(length - (length % (format.channels * format.bitsPerSample / 8))));
    } else if (part.pauseMs) leadingPauseMs += part.pauseMs;
  }
  if (!format) throw new Error('没有可写入的语音片段');
  await writeFile(outputPath, encodeWav({ ...format, data: Buffer.concat(chunks) }));
}

export interface WavTiming { durationMs: number; speechStartMs: number; speechEndMs: number }

/** Conservative energy bounds used only for padding/estimated captions, never to cut speech. */
export async function readWavTiming(file: string): Promise<WavTiming> {
  const wav = decodeWav(await readFile(file));
  const frameBytes = wav.channels * wav.bitsPerSample / 8;
  const frames = Math.floor(wav.data.length / frameBytes);
  const durationMs = frames * 1000 / wav.sampleRate;
  if (wav.bitsPerSample !== 16) return { durationMs, speechStartMs: 0, speechEndMs: durationMs };
  const windowFrames = Math.max(1, Math.round(wav.sampleRate / 100));
  const energies: number[] = [];
  for (let start = 0; start < frames; start += windowFrames) {
    let sum = 0;
    const end = Math.min(frames, start + windowFrames);
    for (let frame = start; frame < end; frame++) {
      for (let channel = 0; channel < wav.channels; channel++) {
        const sample = wav.data.readInt16LE(frame * frameBytes + channel * 2) / 32768;
        sum += sample * sample;
      }
    }
    energies.push(Math.sqrt(sum / Math.max(1, (end - start) * wav.channels)));
  }
  const peak = energies.reduce((maximum, value) => Math.max(maximum, value), 0);
  const threshold = Math.max(0.001, peak * 0.015);
  const first = energies.findIndex(value => value > threshold);
  let last = energies.length - 1;
  while (last >= 0 && energies[last] <= threshold) last--;
  if (first < 0) return { durationMs, speechStartMs: 0, speechEndMs: durationMs };
  return {
    durationMs,
    speechStartMs: Math.max(0, Math.round(first * windowFrames * 1000 / wav.sampleRate) - 20),
    speechEndMs: Math.min(durationMs, Math.round((last + 1) * windowFrames * 1000 / wav.sampleRate) + 20)
  };
}

export async function composeSpeechWav(
  clips: Array<{ path: string; pauseBeforeMs?: number; pauseAfterMs: number }>, outputPath: string
): Promise<Array<WavTiming & { startMs: number; endMs: number }>> {
  const timing = await Promise.all(clips.map(clip => readWavTiming(clip.path)));
  const parts: Array<{ path?: string; pauseMs?: number }> = [];
  const intervals: Array<WavTiming & { startMs: number; endMs: number }> = [];
  let cursor = 0;
  for (const [index, clip] of clips.entries()) {
    const before = clip.pauseBeforeMs ?? 0;
    if (before) { parts.push({ pauseMs: before }); cursor += before; }
    const current = timing[index];
    const nextLeading = timing[index + 1]?.speechStartMs ?? 0;
    const naturalGap = current.durationMs - current.speechEndMs + nextLeading;
    // Existing TTS silence already contributes to the paragraph break.
    const padding = Math.max(0, Math.ceil(clip.pauseAfterMs - naturalGap));
    parts.push({ path: clip.path });
    if (padding) parts.push({ pauseMs: padding });
    const startMs = cursor;
    cursor += current.durationMs + padding;
    intervals.push({ durationMs: Math.round(current.durationMs), startMs: Math.round(startMs), endMs: Math.round(cursor),
      speechStartMs: Math.round(startMs + current.speechStartMs), speechEndMs: Math.round(startMs + current.speechEndMs) });
  }
  await composeWav(parts, outputPath);
  return intervals;
}
