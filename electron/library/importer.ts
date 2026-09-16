import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ImportAssetRequestSchema, MediaAssetSchema, type ImportAssetRequest, type MediaAsset } from '../../shared/library.js';
import type { MediaProbe } from '../media/probe.js';
import type { LibraryDatabase } from './database.js';

const execFileAsync = promisify(execFile);
const extensions = {
  video: new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']),
  image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']),
  audio: new Set(['.wav', '.flac', '.mp3', '.ogg', '.opus', '.m4a', '.aac'])
};

async function fingerprint(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function mediaType(file: string): MediaAsset['type'] {
  const extension = path.extname(file).toLowerCase();
  for (const [type, values] of Object.entries(extensions)) if (values.has(extension)) return type as MediaAsset['type'];
  throw new Error(`不支持的素材格式：${extension || '无扩展名'}`);
}

export interface Thumbnailer { create(input: string, output: string, type: MediaAsset['type']): Promise<void> }

export class FfmpegThumbnailer implements Thumbnailer {
  constructor(private readonly ffmpegPath: string) {}
  async create(input: string, output: string, type: MediaAsset['type']): Promise<void> {
    if (type === 'audio') return;
    const seek = type === 'video' ? ['-ss', '0.3'] : [];
    await execFileAsync(this.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...seek, '-i', input,
      '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", output], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  }
}

export class AssetImporter {
  constructor(
    private readonly database: LibraryDatabase,
    private readonly probe: MediaProbe,
    private readonly derivedDir: string,
    private readonly thumbnailer?: Thumbnailer
  ) {}

  async import(inputValue: ImportAssetRequest): Promise<MediaAsset> {
    const input = ImportAssetRequestSchema.parse(inputValue);
    await access(input.filePath);
    const hash = await fingerprint(input.filePath);
    const existing = this.database.byFingerprint(hash);
    if (existing) return existing;
    const type = mediaType(input.filePath);
    const metadata = await this.probe.probe(input.filePath);
    const id = randomUUID();
    await mkdir(this.derivedDir, { recursive: true });
    const thumbnailPath = type === 'audio' || !this.thumbnailer ? undefined : path.join(this.derivedDir, `${id}.jpg`);
    if (thumbnailPath) await this.thumbnailer!.create(input.filePath, thumbnailPath, type);
    const filenameTags = path.basename(input.filePath, path.extname(input.filePath)).split(/[\s_\-.]+/u).filter(tag => tag.length > 1);
    return this.database.upsert(MediaAssetSchema.parse({
      id, filePath: path.resolve(input.filePath), fingerprint: hash, type,
      name: path.basename(input.filePath), durationMs: metadata.durationMs,
      width: metadata.width, height: metadata.height, fps: metadata.fps,
      hasAudio: metadata.hasAudio, thumbnailPath,
      tags: [...new Set([...input.tags, ...filenameTags])], transcript: '', license: input.license,
      createdAt: new Date().toISOString()
    }));
  }
}
