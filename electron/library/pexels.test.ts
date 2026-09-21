import { describe, expect, it, vi } from 'vitest';
import { assertPexelsUrl, PexelsClient } from './pexels.js';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Pexels integration', () => {
  it('maps Chinese queries, caches searches, and keeps source/license attribution data', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ photos: [{
      id: 123, width: 1600, height: 900, url: 'https://www.pexels.com/photo/123/', photographer: 'Example author',
      alt: 'Office team', src: { medium: 'https://images.pexels.com/photos/123/small.jpeg', large2x: 'https://images.pexels.com/photos/123/large.jpeg' }
    }] }), { status: 200 }));
    const client = new PexelsClient(() => 'test-key', request);
    const result = await client.search({ query: '办公室', type: 'image' });
    expect(result.query).toBe('office');
    expect(result.items[0].author).toBe('Example author');
    expect(result.items[0].tags).toContain('团队');
    expect(request.mock.calls[0][1]?.headers).toEqual({ Authorization: 'test-key' });
    await client.search({ query: '办公室', type: 'image' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses the current video endpoint and chooses an HD MP4 without taking the 4K file', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ videos: [{
      id: 7, width: 3840, height: 2160, url: 'https://www.pexels.com/video/7/', image: 'https://images.pexels.com/videos/7.jpg',
      duration: 8, user: { name: 'Author' }, video_files: [
        { file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://videos.pexels.com/7-4k.mp4' },
        { file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/7-hd.mp4' }
      ]
    }] })));
    const result = await new PexelsClient(() => 'key', request).search({ query: 'city', type: 'video' });
    expect(String(request.mock.calls[0][0])).toContain('/v1/videos/search');
    expect(result.items[0].downloadUrl).toContain('hd.mp4');
  });
  it('rejects arbitrary download locations and missing credentials', async () => {
    for (const url of ['http://images.pexels.com/a', 'https://127.0.0.1/a', 'https://images.pexels.com.evil.test/a', 'https://user:pass@images.pexels.com/a']) {
      expect(() => assertPexelsUrl(url)).toThrow();
    }
    const client = new PexelsClient(() => '');
    await expect(client.search({ query: '海边', type: 'video' })).rejects.toThrow('API Key');
    await expect(client.download('not-searched', '/tmp')).rejects.toThrow('过期');
  });
  it('reports quota errors without exposing the API key', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    await expect(new PexelsClient(() => 'secret', request).search({ query: 'city', type: 'image' })).rejects.toThrow('额度');
  });
  it('streams only a searched asset to disk without sending the API key to the media CDN', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voxweave-pexels-'));
    try {
      const request = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ photos: [{ id: 8, width: 640, height: 360, url: 'https://www.pexels.com/photo/8/',
          photographer: 'Author', alt: 'City', src: { medium: 'https://images.pexels.com/photos/8/small.jpg', large2x: 'https://images.pexels.com/photos/8/full.jpg' } }] })))
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
      const client = new PexelsClient(() => 'secret', request);
      const { items } = await client.search({ query: '城市', type: 'image' });
      const downloaded = await client.download(items[0].id, directory);
      expect([...await readFile(downloaded.filePath)]).toEqual([1, 2, 3]);
      expect(request.mock.calls[1][1]?.headers).toBeUndefined();
      expect(request.mock.calls[1][1]?.redirect).toBe('error');
      expect((await readdir(directory)).some(name => name.endsWith('.part'))).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
