import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { access, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AudioFormat, EngineStatus, ProgressEvent, SynthesisRequest } from '../shared/types.js';
import { parseMarkedText } from '../shared/markup.js';
import { composeWav } from '../shared/wav.js';

export interface EngineConfig { enginePath?: string; modelDir?: string; ffmpegPath?: string; preferWsl?: boolean }
type Progress = (event: ProgressEvent) => void;

async function exists(file: string): Promise<boolean> {
  try { await access(file, constants.R_OK); return true; } catch { return false; }
}

const execFileAsync = promisify(execFile);
async function wslExists(file: string, executable = false): Promise<boolean> {
  try { await execFileAsync('wsl.exe', ['--', 'test', executable ? '-x' : '-r', file], { windowsHide: true }); return true; }
  catch { return false; }
}

function wslPath(file: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(path.resolve(file));
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}` : file.replaceAll('\\', '/');
}

export class QwenEngine {
  private process?: ChildProcess;
  constructor(private readonly config: EngineConfig) {}

  async status(): Promise<EngineStatus> {
    const engine = this.config.enginePath;
    const model = this.config.modelDir;
    if (!engine) return { state: 'missing', backend: 'none', message: '尚未配置 Qwen3-TTS 引擎' };
    const native = engine.toLowerCase().endsWith('.exe');
    if (!(native ? await exists(engine) : await wslExists(engine, true))) return { state: 'missing', backend: 'none', message: '找不到 Qwen3-TTS 引擎，请检查路径' };
    if (!model) return { state: 'missing', backend: native ? 'native' : 'wsl', enginePath: engine, message: '引擎已找到，尚未配置模型目录' };
    const modelReady = /^[A-Za-z]:\\/.test(model) ? await exists(model) : await wslExists(model);
    if (!modelReady) return { state: 'missing', backend: native ? 'native' : 'wsl', enginePath: engine, message: '找不到模型目录，请检查路径' };
    return { state: 'idle', backend: native ? 'native' : 'wsl', enginePath: engine, modelDir: model, message: '引擎就绪' };
  }

  cancel(): void { if (this.process && !this.process.killed) this.process.kill(); }

  async synthesize(request: SynthesisRequest, progress: Progress): Promise<void> {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'voxweave-export-'));
    try {
      let referenceAudio = request.referenceAudio;
      if (referenceAudio && this.config.ffmpegPath && await exists(this.config.ffmpegPath)) {
        const normalized = path.join(temp, 'reference-24k-mono.wav');
        progress({ phase: 'encoding', progress: 0.02, message: '正在标准化参考音频…' });
        await this.ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', referenceAudio, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', normalized]);
        referenceAudio = normalized;
      }
      const renderedWav = path.join(temp, 'rendered.wav');
      await this.synthesizeWav({ ...request, referenceAudio, outputPath: renderedWav }, event => {
        if (event.phase !== 'complete') progress(event);
      });
      await mkdir(path.dirname(request.outputPath), { recursive: true });
      const format = this.outputFormat(request);
      if (format === 'wav') await copyFile(renderedWav, request.outputPath);
      else {
        progress({ phase: 'encoding', progress: 0.97, message: `正在编码 ${format.toUpperCase()}…` });
        await this.encode(renderedWav, request.outputPath, format);
      }
      progress({ phase: 'complete', progress: 1, message: '合成完成', outputPath: request.outputPath });
    } finally { await rm(temp, { recursive: true, force: true }); }
  }

  private async synthesizeWav(request: SynthesisRequest, progress: Progress): Promise<void> {
    const status = await this.status();
    if (status.state === 'missing') throw new Error(status.message);
    const segments = parseMarkedText(request.text);
    if (!segments.some(segment => segment.kind === 'speech')) throw new Error('请输入要合成的文本');
    const temp = await mkdtemp(path.join(os.tmpdir(), 'voxweave-'));
    const parts: Array<{ path?: string; pauseMs?: number }> = [];
    try {
      progress({ phase: 'preparing', progress: 0.03, message: '正在准备引擎与文本…' });
      const speechSegments = segments.filter(segment => segment.kind === 'speech').length;
      let completed = 0;
      for (const [index, segment] of segments.entries()) {
        if (segment.kind === 'pause') { parts.push({ pauseMs: segment.milliseconds }); continue; }
        const segmentPath = path.join(temp, `segment-${String(index).padStart(3, '0')}.wav`);
        progress({ phase: 'generating', progress: 0.05 + 0.85 * completed / speechSegments, message: `正在生成第 ${completed + 1}/${speechSegments} 段…` });
        await this.run(segment.text, segmentPath, request);
        parts.push({ path: segmentPath }); completed++;
      }
      await mkdir(path.dirname(request.outputPath), { recursive: true });
      progress({ phase: 'composing', progress: 0.94, message: '正在拼接音频与精确停顿…' });
      if (parts.length === 1 && parts[0].path) {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(parts[0].path, request.outputPath);
      } else await composeWav(parts, request.outputPath);
      progress({ phase: 'complete', progress: 1, message: '合成完成', outputPath: request.outputPath });
    } finally { await rm(temp, { recursive: true, force: true }); }
  }

  private outputFormat(request: SynthesisRequest): AudioFormat {
    if (request.outputFormat) return request.outputFormat;
    const ext = path.extname(request.outputPath).toLowerCase();
    if (ext === '.flac') return 'flac';
    if (ext === '.mp3') return 'mp3';
    if (ext === '.ogg' || ext === '.opus') return 'opus';
    if (ext === '.m4a' || ext === '.aac') return 'm4a';
    return 'wav';
  }

  private async encode(input: string, output: string, format: AudioFormat): Promise<void> {
    if (!this.config.ffmpegPath || !await exists(this.config.ffmpegPath)) throw new Error(`输出 ${format.toUpperCase()} 需要内置 FFmpeg，但当前未找到转码器`);
    const codecs: Record<Exclude<AudioFormat, 'wav'>, string[]> = {
      flac: ['-c:a', 'flac', '-compression_level', '8'],
      mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
      opus: ['-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on'],
      m4a: ['-c:a', 'aac', '-b:a', '192k']
    };
    await this.ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...codecs[format as Exclude<AudioFormat, 'wav'>], output]);
  }

  private async ffmpeg(args: string[]): Promise<void> {
    try { await execFileAsync(this.config.ffmpegPath!, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }); }
    catch (error) { throw new Error(`音频转码失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  private async run(text: string, outputPath: string, request: SynthesisRequest): Promise<void> {
    const enginePath = this.config.enginePath!;
    const modelDir = request.modelDir ?? this.config.modelDir!;
    const args = ['-d', modelDir, '--text', text, '-o', outputPath,
      '--temperature', String(request.temperature), '--top-k', String(request.topK), '--top-p', String(request.topP), '-j', String(request.threads), '--silent'];
    if (request.language !== 'Auto') args.push('-l', request.language);
    if (request.speaker) args.push('-s', request.speaker);
    if (request.voicePath) args.push('--load-voice', request.voicePath, '--icl-only');
    if (request.referenceAudio) args.push('--ref-audio', request.referenceAudio);
    if (request.referenceText) args.push('--ref-text', request.referenceText);
    if (request.seed !== undefined) args.push('--seed', String(request.seed));
    if (request.precision === 'int8') args.push('--int8');
    if (request.precision === 'int4') args.push('--int4');

    const native = enginePath.toLowerCase().endsWith('.exe');
    const command = native ? enginePath : 'wsl.exe';
    const spawnArgs = native ? args : ['--', enginePath, ...args.map(arg => /^[A-Za-z]:\\/.test(arg) ? wslPath(arg) : arg)];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, spawnArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.process = child;
      let stderr = '';
      child.stderr?.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 16_384) stderr = stderr.slice(-16_384); });
      child.once('error', reject);
      child.once('exit', code => {
        this.process = undefined;
        code === 0 ? resolve() : reject(new Error(stderr.trim() || `Qwen3-TTS 退出，代码 ${code}`));
      });
    });
  }
}
