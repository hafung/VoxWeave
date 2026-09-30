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
    expect(result.filter(token => token.source === 'estimated').map(token => token.text)).toEqual(['织']);
    expect(result[0].startMs).toBe(100);
    // The recognized extra “呀” occupies the end of the audio; it is not part of the subtitle.
    expect(result.at(-1)?.endMs).toBe(1067);
  });

  it('aggregates aligned characters back into jieba words and bounded cues', () => {
    const cues = alignedCaptionCues('segment-1', '电商产品需要清晰表达', [
      { text: '电商产品', startMs: 0, endMs: 800 },
      { text: '需要清晰表达', startMs: 800, endMs: 1800 }
    ], 0, 1800);
    expect(cues.flatMap(cue => cue.tokens).map(token => token.text).join('')).toBe('电商产品需要清晰表达');
    expect(cues.at(-1)?.endMs).toBe(1800);
  });

  it('preserves acoustic silence instead of stretching the previous word across it', () => {
    const tokens = [{ text: '你好', startMs: 100, endMs: 400 }, { text: '世界', startMs: 900, endMs: 1200 }];
    const aligned = alignTextTokens('你好，世界。', tokens, 0, 1400);
    expect(aligned[1].endMs).toBe(400);
    expect(aligned[2].startMs).toBe(900);
    const cues = alignedCaptionCues('pause', '你好，世界。', tokens, 0, 1400);
    expect(cues.map(cue => [cue.text, cue.startMs, cue.endMs])).toEqual([['你好', 100, 400], ['世界', 900, 1200]]);
  });
});
