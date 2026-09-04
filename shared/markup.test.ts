import { describe, expect, it } from 'vitest';
import { estimateDuration, parseMarkedText } from './markup.js';

describe('parseMarkedText', () => {
  it('parses both compact and SSML-like pauses', () => {
    expect(parseMarkedText('你好 [pause:500ms] 世界 <break time="1.2s"/> 完成')).toEqual([
      { kind: 'speech', text: '你好' }, { kind: 'pause', milliseconds: 500 },
      { kind: 'speech', text: '世界' }, { kind: 'pause', milliseconds: 1200 },
      { kind: 'speech', text: '完成' }
    ]);
  });
  it('merges adjacent pauses and clamps unsafe values', () => {
    expect(parseMarkedText('[pause:20ms][pause:20s]')).toEqual([{ kind: 'pause', milliseconds: 10_000 }]);
  });
  it('keeps model performance tags as speech', () => {
    expect(parseMarkedText('[sigh] 好吧')).toEqual([{ kind: 'speech', text: '[sigh] 好吧' }]);
  });
});

describe('estimateDuration', () => {
  it('includes exact pauses', () => expect(estimateDuration('一二三四 [pause:1s]')).toBeGreaterThanOrEqual(1.9));
});
