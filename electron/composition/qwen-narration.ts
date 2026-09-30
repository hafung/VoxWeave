import type { QwenEngine } from '../engine.js';
import type { SynthesisRequest } from '../../shared/types.js';
import type { NarrationSynthesizer, SegmentSynthesisInput } from './narration.js';

export class QwenNarrationSynthesizer implements NarrationSynthesizer {
  constructor(private readonly engine: QwenEngine, private readonly voicePaths: ReadonlyMap<string, string> = new Map()) {}

  async synthesize(input: SegmentSynthesisInput): Promise<void> {
    if (input.signal?.aborted) throw new DOMException('旁白生成已取消', 'AbortError');
    const onAbort = () => this.engine.cancel();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const request: SynthesisRequest = {
        text: input.text,
        outputPath: input.outputPath,
        outputFormat: 'wav',
        language: input.language as SynthesisRequest['language'],
        speaker: this.voicePaths.has(input.voiceId) ? undefined : input.voiceId,
        voicePath: this.voicePaths.get(input.voiceId),
        temperature: input.temperature,
        topK: input.topK,
        topP: input.topP,
        seed: input.seed,
        threads: 4,
        precision: input.precision,
        automaticProsody: false,
        instruct: input.instruct
      };
      await this.engine.synthesize(request, () => undefined);
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
  }
}
