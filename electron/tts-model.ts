import { open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const DEFAULT_TTS_MODEL = 'qwen3-tts-1.7b-customvoice';
export const CLONE_TTS_MODEL = 'qwen3-tts-1.7b-base';
export const TTS_SETUP_VERSION = '1.7b-v1';

export function narrationModelPath(root: string, saved?: string, environment?: string): string {
  return environment ?? saved ?? path.join(root, 'models', DEFAULT_TTS_MODEL);
}

export async function assertVoiceProfile17B(voicePath: string): Promise<void> {
  const voice = await open(voicePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await voice.read(header, 0, header.length, 0);
    let dimension: number | undefined;
    if (bytesRead >= 8 && header.toString('ascii', 0, 4) === 'QVCE') {
      const version = header.readUInt32LE(4);
      if ((version === 2 || version === 3) && bytesRead >= 12) dimension = header.readUInt32LE(8);
    } else if (path.extname(voicePath).toLowerCase() === '.bin' && (await voice.stat()).size === 2048 * 4) {
      dimension = 2048;
    }
    if (dimension !== 2048) throw new Error('音色文件不属于 1.7B，请用参考音频重新克隆');
  } finally { await voice.close(); }
}

/** One development data reset; subsequent launches keep newly created voices. */
export async function resetTtsDevelopmentData(userData: string, setupVersion?: string): Promise<boolean> {
  if (setupVersion === TTS_SETUP_VERSION) return false;
  await rm(path.join(userData, 'voices'), { recursive: true, force: true });
  await rm(path.join(userData, 'cache', 'narration'), { recursive: true, force: true });
  return true;
}

export async function describeTtsModel(directory: string): Promise<{ instructionControl: boolean; identity: string; modelType: 'base' | 'custom_voice' }> {
  const wsl = process.platform === 'win32' && directory.startsWith('/');
  const read = async (file: string) => wsl
    ? (await promisify(execFile)('wsl.exe', ['--', 'cat', path.posix.join(directory, file)], { windowsHide: true })).stdout
    : readFile(path.join(directory, file), 'utf8');
  const config = JSON.parse(await read('config.json'));
  if (config.talker_config?.hidden_size !== 2048 || !['base', 'custom_voice'].includes(config.tts_model_type)) {
    throw new Error('仅支持 Qwen3-TTS 1.7B Base / CustomVoice 模型');
  }
  let revision = 'unversioned';
  try { revision = JSON.parse(await read('manifest.json')).version ?? revision; } catch { /* User models may have no manifest. */ }
  return {
    instructionControl: config.tts_model_type === 'custom_voice', modelType: config.tts_model_type,
    identity: `${wsl ? directory : path.resolve(directory)}:${revision}`
  };
}
