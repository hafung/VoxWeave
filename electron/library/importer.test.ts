import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryDatabase } from './database.js';
import { AssetImporter } from './importer.js';

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true }))));

describe('AssetImporter', () => {
  it('indexes a file once and generates derived metadata without copying original media', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-library-')); temporary.push(root);
    const file = path.join(root, '商品 展示.mp4'); await writeFile(file, 'fake-media');
    const database = new LibraryDatabase(path.join(root, 'library.sqlite'));
    const probe = { probe: vi.fn(async () => ({ durationMs: 3200, width: 1080, height: 1920, fps: 30, hasAudio: true })) };
    const thumbnailer = { create: vi.fn(async (_input: string, output: string) => writeFile(output, 'jpg')) };
    const importer = new AssetImporter(database, probe, path.join(root, 'derived'), thumbnailer);
    const first = await importer.import({ filePath: file, tags: ['电商'], license: { status: 'user-owned', source: 'user-import' } });
    const second = await importer.import({ filePath: file, tags: ['ignored'], license: { status: 'user-owned', source: 'user-import' } });
    expect(second.id).toBe(first.id);
    expect(first.filePath).toBe(file);
    expect(first.tags).toEqual(expect.arrayContaining(['电商', '商品', '展示']));
    expect(thumbnailer.create).toHaveBeenCalledTimes(1);
    database.close();
  });
});
