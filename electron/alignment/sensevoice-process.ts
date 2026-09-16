import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { RecognizedToken } from './align-text.js';

const execFileAsync = promisify(execFile);
const WorkerResultSchema = z.object({
  tokens: z.array(z.object({
    text: z.string(), startMs: z.number().nonnegative(),
    endMs: z.number().positive().optional(), confidence: z.number().min(0).max(1).optional()
  }).strict()),
  speechEndMs: z.number().positive().optional()
}).strict();

export interface SenseVoiceProcessResult {
  tokens: RecognizedToken[];
  speechEndMs?: number;
}

export async function alignWithSenseVoiceProcess(
  resources: string,
  audioPath: string,
  executable = process.execPath,
  workerPath = fileURLToPath(new URL('./sensevoice-worker.js', import.meta.url))
): Promise<SenseVoiceProcessResult> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'voxweave-sensevoice-'));
  const resultPath = path.join(temp, 'result.json');
  try {
    await execFileAsync(executable, [workerPath, '--resources', resources, '--audio', audioPath, '--result', resultPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    return WorkerResultSchema.parse(JSON.parse(await readFile(resultPath, 'utf8')));
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(`SenseVoice 隔离进程失败${detail ? `：${detail}` : ''}`, { cause: error });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
