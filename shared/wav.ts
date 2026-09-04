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
  for (const part of parts) {
    if (part.path) {
      const wav = decodeWav(await readFile(part.path));
      if (!format) format = wav;
      if (wav.sampleRate !== format.sampleRate || wav.channels !== format.channels || wav.bitsPerSample !== format.bitsPerSample) {
        throw new Error('合成片段的采样格式不一致');
      }
      chunks.push(wav.data);
    } else if (part.pauseMs && format) {
      const length = Math.round(format.sampleRate * format.channels * (format.bitsPerSample / 8) * part.pauseMs / 1000);
      chunks.push(Buffer.alloc(length - (length % (format.channels * format.bitsPerSample / 8))));
    }
  }
  if (!format) throw new Error('没有可写入的语音片段');
  await writeFile(outputPath, encodeWav({ ...format, data: Buffer.concat(chunks) }));
}
