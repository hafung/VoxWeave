export type TextSegment = { kind: 'speech'; text: string } | { kind: 'pause'; milliseconds: number };

const PAUSE_PATTERN = /(?:\[pause\s*[:=]\s*(\d+(?:\.\d+)?)\s*(ms|s)?\]|<break\s+time=["'](\d+(?:\.\d+)?)(ms|s)["']\s*\/?>)/giu;

export function parseMarkedText(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of input.matchAll(PAUSE_PATTERN)) {
    const index = match.index ?? 0;
    const speech = input.slice(cursor, index).trim();
    if (speech) segments.push({ kind: 'speech', text: speech });
    const raw = Number(match[1] ?? match[3]);
    const unit = (match[2] ?? match[4] ?? 'ms').toLowerCase();
    const milliseconds = Math.round(unit === 's' ? raw * 1000 : raw);
    segments.push({ kind: 'pause', milliseconds: Math.min(10_000, Math.max(50, milliseconds)) });
    cursor = index + match[0].length;
  }
  const tail = input.slice(cursor).trim();
  if (tail) segments.push({ kind: 'speech', text: tail });
  return compactPauses(segments);
}

function compactPauses(segments: TextSegment[]): TextSegment[] {
  const output: TextSegment[] = [];
  for (const segment of segments) {
    const previous = output.at(-1);
    if (segment.kind === 'pause' && previous?.kind === 'pause') {
      previous.milliseconds = Math.min(10_000, previous.milliseconds + segment.milliseconds);
    } else {
      output.push({ ...segment });
    }
  }
  return output;
}

export function estimateDuration(text: string): number {
  const pauseMs = parseMarkedText(text)
    .filter((item): item is Extract<TextSegment, { kind: 'pause' }> => item.kind === 'pause')
    .reduce((sum, item) => sum + item.milliseconds, 0);
  const spoken = text.replace(PAUSE_PATTERN, '').trim();
  const cjk = (spoken.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu) ?? []).length;
  const words = (spoken.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return Math.max(0, Math.round((cjk / 4.2 + words / 2.6 + pauseMs / 1000) * 10) / 10);
}
