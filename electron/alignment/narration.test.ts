import { describe, expect, it, vi } from 'vitest';
import { createDraftEditPlan, EditPlanSchema } from '../../shared/edit-plan.js';
import { resolveEditPlan } from '../composition/resolver.js';
import { alignNarration } from './narration.js';

describe('finished narration alignment', () => {
  it('uses grouped audio word times to resolve scenes and keeps captions out of paragraph silence', async () => {
    const plan = createDraftEditPlan({ id: 'grouped', script: '你好。世界。\n再见。', voiceId: 'vivian' });
    const artifact = { audioPath: 'narration.wav', durationMs: 2400, segments: [
      { id: 'speech-001', text: '你好。世界。', sceneIds: ['scene-001', 'scene-002'],
        startMs: 0, endMs: 1820, speechStartMs: 100, speechEndMs: 1400, audioPath: 'group.wav' },
      { id: 'speech-002', text: '再见。', sceneIds: ['scene-003'],
        startMs: 1820, endMs: 2400, speechStartMs: 1820, speechEndMs: 2350, audioPath: 'last.wav' }
    ] };
    const transcribe = vi.fn(async (file: string) => file === 'group.wav' ? { tokens: [
      { text: '你好', startMs: 100, endMs: 400 }, { text: '世界', startMs: 900, endMs: 1400 }
    ] } : { tokens: [{ text: '再见', startMs: 0, endMs: 500 }] });
    const aligned = await alignNarration(artifact, plan.scenes, transcribe);
    const resolved = resolveEditPlan(plan, { narration: aligned });
    expect(resolved.scenes.map(scene => [scene.startMs, scene.endMs])).toEqual([[0, 900], [900, 1820], [1820, 2400]]);
    expect(resolved.captions.map(cue => [cue.startMs, cue.endMs])).toEqual([[100, 400], [900, 1400], [1820, 2320]]);
    expect(EditPlanSchema.safeParse(resolved).success).toBe(true);
  });

  it('falls back only for the failed paragraph and bounds estimates to actual speech', async () => {
    const plan = createDraftEditPlan({ id: 'fallback', script: '你好。\n世界。', voiceId: 'vivian' });
    const artifact = { audioPath: 'narration.wav', durationMs: 2500, segments: [
      { id: 'one', text: '你好。', sceneIds: ['scene-001'], startMs: 0, endMs: 1500,
        speechStartMs: 100, speechEndMs: 800, audioPath: 'one.wav' },
      { id: 'two', text: '世界。', sceneIds: ['scene-002'], startMs: 1500, endMs: 2500,
        speechStartMs: 1600, speechEndMs: 2400, audioPath: 'two.wav' }
    ] };
    const warning = vi.fn();
    const aligned = await alignNarration(artifact, plan.scenes, async file => {
      if (file === 'one.wav') throw new Error('missing resource');
      return { tokens: [{ text: '世界', startMs: 150, endMs: 850 }] };
    }, undefined, warning);
    expect(aligned.captions!.map(cue => [cue.startMs, cue.endMs, cue.tokens[0].source])).toEqual([
      [100, 800, 'estimated'], [1650, 2350, 'aligned']
    ]);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation during alignment', async () => {
    const plan = createDraftEditPlan({ id: 'cancel-align', script: '你好。', voiceId: 'vivian' });
    const controller = new AbortController();
    await expect(alignNarration({ audioPath: 'all.wav', durationMs: 1000, segments: [
      { id: 'scene-001', text: '你好。', startMs: 0, endMs: 1000, audioPath: 'one.wav' }
    ] }, plan.scenes, async () => { controller.abort(); throw new Error('cancel'); }, controller.signal)).rejects.toThrow('cancel');
  });
});
