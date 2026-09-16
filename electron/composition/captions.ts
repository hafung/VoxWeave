import type { CaptionCue } from '../../shared/edit-plan.js';
import { segmentChinese } from './segmenter.js';

const punctuation = /^[\p{P}\p{S}\s]+$/u;

function tokenWeight(token: string): number {
  return Math.max(1, Array.from(token).filter(character => !punctuation.test(character)).length);
}

function groupTokens(tokens: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let characters = 0;
  for (const token of tokens) {
    const size = tokenWeight(token);
    if (current.length && characters + size > 10) {
      groups.push(current);
      current = [];
      characters = 0;
    }
    current.push(token);
    characters += size;
    if (characters >= 4) {
      groups.push(current);
      current = [];
      characters = 0;
    }
  }
  if (current.length) {
    if (groups.length && groups.at(-1)!.reduce((sum, token) => sum + tokenWeight(token), 0) + characters <= 10) {
      groups.at(-1)!.push(...current);
    } else groups.push(current);
  }
  return groups;
}

function weightedBoundaries(weights: number[], startMs: number, endMs: number): number[] {
  const duration = endMs - startMs;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const boundaries = [startMs];
  let accumulated = 0;
  for (let index = 0; index < weights.length - 1; index++) {
    accumulated += weights[index];
    const ideal = startMs + Math.round(duration * accumulated / total);
    boundaries.push(Math.max(boundaries[index] + 1, Math.min(endMs - (weights.length - index - 1), ideal)));
  }
  boundaries.push(endMs);
  return boundaries;
}

export function estimateCaptionCues(
  segments: Array<{ id: string; text: string; startMs: number; endMs: number }>
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const segment of segments) {
    const words = segmentChinese(segment.text).filter(token => !punctuation.test(token));
    if (!words.length) continue;
    if (segment.endMs - segment.startMs < words.length) throw new Error(`旁白分段 ${segment.id} 过短，无法分配字幕 token`);
    const wordBoundaries = weightedBoundaries(words.map(tokenWeight), segment.startMs, segment.endMs);
    const timed = words.map((text, index) => ({
      text,
      startMs: wordBoundaries[index],
      endMs: wordBoundaries[index + 1],
      source: 'estimated' as const
    }));
    const groups = groupTokens(words);
    let cursor = 0;
    for (const [groupIndex, group] of groups.entries()) {
      const groupTokensWithTime = timed.slice(cursor, cursor + group.length);
      cursor += group.length;
      cues.push({
        id: `${segment.id}-cue-${String(groupIndex + 1).padStart(2, '0')}`,
        text: group.join(''),
        startMs: groupTokensWithTime[0].startMs,
        endMs: groupTokensWithTime.at(-1)!.endMs,
        tokens: groupTokensWithTime,
        emphasis: []
      });
    }
  }
  return cues;
}
