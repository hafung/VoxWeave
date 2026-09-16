import { describe, expect, it } from 'vitest';
import { alignTextTokens, alignedCaptionCues } from './align-text.js';

describe('known-text alignment', () => {
  it('keeps the original text while mapping acoustic token time through insertions and deletions', () => {
    const result = alignTextTokens('声织，自动成片！', [
      { text: '声', startMs: 100, endMs: 220, confidence: 0.9 },
      { text: '职', startMs: 220, endMs: 340, confidence: 0.8 },
      { text: '自动', startMs: 500, endMs: 800 },
      { text: '成片呀', startMs: 800, endMs: 1200 }
    ], 100, 1200);
    expect(result.map(token => token.text).join('')).toBe('声织自动成片');
    expect(result.every(token => token.source === 'aligned')).toBe(true);
    expect(result[0].startMs).toBe(100);
    expect(result.at(-1)?.endMs).toBe(1200);
  });

  it('aggregates aligned characters back into jieba words and bounded cues', () => {
    const cues = alignedCaptionCues('segment-1', '电商产品需要清晰表达', [
      { text: '电商产品', startMs: 0, endMs: 800 },
      { text: '需要清晰表达', startMs: 800, endMs: 1800 }
    ], 0, 1800);
    expect(cues.flatMap(cue => cue.tokens).map(token => token.text).join('')).toBe('电商产品需要清晰表达');
    expect(cues.at(-1)?.endMs).toBe(1800);
  });
});
