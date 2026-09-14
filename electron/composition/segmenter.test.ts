import { describe, expect, it } from 'vitest';
import { extractChineseKeywords, loadProjectDictionary, segmentChinese } from './segmenter.js';

describe('Chinese segmenter', () => {
  it('segments Chinese without returning punctuation', () => {
    const words = segmentChinese('产品很好，却一直卖不出去。');
    expect(words).toContain('产品');
    expect(words).not.toContain('，');
    expect(words).not.toContain('。');
  });

  it('supports project-specific dictionaries', () => {
    loadProjectDictionary(['声织自动成片 100000 n']);
    expect(segmentChinese('声织自动成片很好用')).toContain('声织自动成片');
  });

  it('extracts a bounded keyword list', () => {
    const keywords = extractChineseKeywords('电商产品需要更清晰的产品表达和广告素材', 3);
    expect(keywords.length).toBeLessThanOrEqual(3);
    expect(keywords.every(keyword => keyword.length > 1)).toBe(true);
  });
});
