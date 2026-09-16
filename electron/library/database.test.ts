import { describe, expect, it } from 'vitest';
import { SearchAssetsRequestSchema, type MediaAsset } from '../../shared/library.js';
import { LibraryDatabase } from './database.js';
import { searchAssets } from './search.js';

function asset(id: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id, filePath: `/media/${id}.mp4`, fingerprint: (id.endsWith('a') ? 'a' : 'b').repeat(64), type: 'video',
    name: `${id}.mp4`, durationMs: 5000, width: 1080, height: 1920, fps: 30, hasAudio: true,
    tags: ['电商', '产品'], transcript: '', license: { status: 'user-owned', source: 'test' },
    createdAt: '2026-09-15T00:00:00.000Z', ...overrides
  };
}

describe('asset library search', () => {
  it('persists metadata in SQLite/FTS5 and applies repeat and license penalties', () => {
    const database = new LibraryDatabase(':memory:');
    database.upsert(asset('asset-a'));
    database.upsert(asset('asset-b', { width: 1920, height: 1080, license: { status: 'unknown', source: 'legacy' } }));
    const results = searchAssets(database, SearchAssetsRequestSchema.parse({
      query: '电商', orientation: 'portrait', avoidAssetIds: ['asset-b'], minDurationMs: 2000
    }));
    expect(results[0].asset.id).toBe('asset-a');
    expect(results[0].reasons).toContain('画幅匹配');
    expect(database.byId('asset-a')?.tags).toEqual(['电商', '产品']);
    database.close();
  });

  it('deduplicates by fingerprint', () => {
    const database = new LibraryDatabase(':memory:');
    database.upsert(asset('asset-a'));
    expect(database.byFingerprint(asset('asset-a').fingerprint)?.id).toBe('asset-a');
    database.close();
  });
});
