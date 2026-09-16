import type { AcousticToken, CaptionCue } from '../../shared/edit-plan.js';
import { segmentChinese } from '../composition/segmenter.js';

export interface RecognizedToken {
  text: string;
  startMs: number;
  endMs?: number;
  confidence?: number;
}

type CharacterToken = Omit<RecognizedToken, 'endMs'> & { character: string; endMs: number };

const ignored = /^[\p{P}\p{S}\s]+$/u;

function characters(value: string): string[] {
  return Array.from(value.normalize('NFKC').toLocaleLowerCase('zh-CN')).filter(character => !ignored.test(character));
}

function expandRecognized(tokens: RecognizedToken[], fallbackEndMs: number): CharacterToken[] {
  return tokens.flatMap((token, tokenIndex) => {
    const chars = characters(token.text);
    if (!chars.length) return [];
    const nextStart = tokens[tokenIndex + 1]?.startMs;
    const endMs = token.endMs ?? nextStart ?? fallbackEndMs;
    const duration = Math.max(chars.length, endMs - token.startMs);
    return chars.map((character, index) => ({
      ...token,
      character,
      startMs: token.startMs + Math.round(duration * index / chars.length),
      endMs: token.startMs + Math.round(duration * (index + 1) / chars.length)
    }));
  });
}

function alignment(reference: string[], recognized: CharacterToken[]): Array<number | undefined> {
  const rows = reference.length + 1;
  const columns = recognized.length + 1;
  const costs = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let row = 0; row < rows; row++) costs[row][0] = row;
  for (let column = 0; column < columns; column++) costs[0][column] = column;
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const substitution = costs[row - 1][column - 1] + (reference[row - 1] === recognized[column - 1].character ? 0 : 1);
      costs[row][column] = Math.min(costs[row - 1][column] + 1, costs[row][column - 1] + 1, substitution);
    }
  }
  const result: Array<number | undefined> = Array(reference.length).fill(undefined);
  let row = reference.length;
  let column = recognized.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0) {
      const penalty = reference[row - 1] === recognized[column - 1].character ? 0 : 1;
      if (costs[row][column] === costs[row - 1][column - 1] + penalty) {
        if (penalty === 0) result[row - 1] = column - 1;
        row--; column--; continue;
      }
    }
    if (row > 0 && costs[row][column] === costs[row - 1][column] + 1) row--;
    else column--;
  }
  return result;
}

export function alignTextTokens(
  originalText: string,
  recognizedTokens: RecognizedToken[],
  startMs: number,
  endMs: number
): AcousticToken[] {
  const reference = characters(originalText);
  if (!reference.length) return [];
  if (endMs - startMs < reference.length) throw new Error('声学区间过短，无法映射原文字符');
  const recognized = expandRecognized(recognizedTokens, endMs);
  const matches = alignment(reference, recognized);
  const anchors = matches.map((matched, index) => matched === undefined ? undefined : ({
    index, startMs: recognized[matched].startMs, endMs: recognized[matched].endMs,
    confidence: recognized[matched].confidence
  }));
  const boundaries = new Array<number>(reference.length + 1);
  boundaries[0] = startMs;
  boundaries[reference.length] = endMs;
  for (const anchor of anchors) {
    if (!anchor) continue;
    boundaries[anchor.index] = Math.max(startMs, Math.min(endMs - 1, anchor.startMs));
    boundaries[anchor.index + 1] = Math.max(boundaries[anchor.index] + 1, Math.min(endMs, anchor.endMs));
  }
  let knownIndex = 0;
  while (knownIndex < boundaries.length - 1) {
    if (boundaries[knownIndex] === undefined) { knownIndex++; continue; }
    let next = knownIndex + 1;
    while (next < boundaries.length && boundaries[next] === undefined) next++;
    const from = boundaries[knownIndex];
    const to = boundaries[next];
    for (let offset = 1; offset < next - knownIndex; offset++) {
      boundaries[knownIndex + offset] = Math.round(from + (to - from) * offset / (next - knownIndex));
    }
    knownIndex = next;
  }
  for (let index = 1; index < boundaries.length; index++) {
    boundaries[index] = Math.max(boundaries[index - 1] + 1, boundaries[index]);
  }
  boundaries[boundaries.length - 1] = endMs;
  return reference.map((text, index) => ({
    text, startMs: boundaries[index], endMs: boundaries[index + 1],
    confidence: anchors[index]?.confidence, source: 'aligned' as const
  }));
}

export function alignedCaptionCues(
  id: string,
  originalText: string,
  recognizedTokens: RecognizedToken[],
  startMs: number,
  endMs: number
): CaptionCue[] {
  const aligned = alignTextTokens(originalText, recognizedTokens, startMs, endMs);
  if (!aligned.length) return [];
  const words = segmentChinese(originalText).filter(word => !ignored.test(word));
  const cues: CaptionCue[] = [];
  let characterCursor = 0;
  let cueTokens: AcousticToken[] = [];
  for (const word of words) {
    const size = characters(word).length;
    const pieces = aligned.slice(characterCursor, characterCursor + size);
    characterCursor += size;
    if (!pieces.length) continue;
    cueTokens.push({
      text: word,
      startMs: pieces[0].startMs,
      endMs: pieces.at(-1)!.endMs,
      confidence: pieces.every(piece => piece.confidence !== undefined)
        ? pieces.reduce((sum, piece) => sum + piece.confidence!, 0) / pieces.length
        : undefined,
      source: 'aligned'
    });
    const count = cueTokens.reduce((sum, token) => sum + characters(token.text).length, 0);
    if (count >= 4) {
      cues.push({
        id: `${id}-aligned-${String(cues.length + 1).padStart(2, '0')}`,
        text: cueTokens.map(token => token.text).join(''),
        startMs: cueTokens[0].startMs,
        endMs: cueTokens.at(-1)!.endMs,
        tokens: cueTokens,
        emphasis: []
      });
      cueTokens = [];
    }
  }
  if (cueTokens.length) {
    cues.push({
      id: `${id}-aligned-${String(cues.length + 1).padStart(2, '0')}`,
      text: cueTokens.map(token => token.text).join(''),
      startMs: cueTokens[0].startMs,
      endMs: cueTokens.at(-1)!.endMs,
      tokens: cueTokens,
      emphasis: []
    });
  }
  return cues;
}
