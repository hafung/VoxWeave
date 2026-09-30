import { describe, expect, it } from 'vitest';
import { planSpeech, spokenCharacterCount } from './prosody.js';

describe('automatic narration planning', () => {
  it('keeps short sentences together for context and separates paragraphs without user tags', () => {
    const chunks = planSpeech('终于等到你了！我们成功了。\n接下来，慢慢说清楚。');
    expect(chunks.map(chunk => chunk.text)).toEqual(['终于等到你了！我们成功了。', '接下来，慢慢说清楚。']);
    expect(chunks[0]).toMatchObject({ sentences: ['终于等到你了！', '我们成功了。'], pauseAfterMs: 420 });
    expect(chunks[1].pauseAfterMs).toBe(0);
  });

  it('bounds long requests without losing text or splitting decimal numbers into scenes', () => {
    const script = 'The price is 3.14 dollars. It works! ' + '这段文案包含很多细节，'.repeat(40);
    const chunks = planSpeech(script);
    expect(chunks.every(chunk => Array.from(chunk.text).length <= 160)).toBe(true);
    expect(spokenCharacterCount(chunks.map(chunk => chunk.text).join(''))).toBe(spokenCharacterCount(script));
    expect(chunks[0].sentences[0]).toBe('The price is 3.14 dollars.');
  });

  it('preserves legacy explicit pauses including a leading pause', () => {
    const chunks = planSpeech('[pause:300ms]第一句。[pause:800ms]第二句。');
    expect(chunks.map(chunk => [chunk.pauseBeforeMs, chunk.pauseAfterMs])).toEqual([[300, 800], [0, 0]]);
    expect(chunks.map(chunk => chunk.text).join('')).toBe('第一句。第二句。');
  });
});
