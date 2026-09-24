import { expect, it, vi } from 'vitest';
import type { MediaAsset } from '../../shared/library.js';
import { SemanticReranker } from './semantic.js';

it('ranks existing descriptions and reuses cached asset vectors', async () => {
  const city = { id: 'city', fingerprint: 'a'.repeat(64), name: 'city night', tags: ['城市', '夜景'], transcript: '' } as MediaAsset;
  const forest = { id: 'forest', fingerprint: 'b'.repeat(64), name: 'forest', tags: ['森林'], transcript: '' } as MediaAsset;
  const embed = vi.fn(async (texts: string[]) => texts.map(text => text.includes('森林') || text.includes('forest') ? [0, 1] : [1, 0]));
  const ranker = new SemanticReranker({ embed });
  const first = await ranker.rank('城市夜景', [city, forest]);
  expect(first.get('city')).toBeGreaterThan(first.get('forest')!);
  await ranker.rank('城市夜景', [city, forest]);
  expect(embed.mock.calls[1][0]).toHaveLength(1);
});
