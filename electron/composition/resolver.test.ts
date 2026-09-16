import { describe, expect, it } from 'vitest';
import { createDraftEditPlan, EditPlanSchema } from '../../shared/edit-plan.js';
import { resolveEditPlan } from './resolver.js';

function narration(durationMs = 3000) {
  return {
    audioPath: 'D:\\projects\\narration.wav', durationMs,
    segments: [
      { id: 'scene-001', text: '产品很好。', startMs: 0, endMs: 1200, audioPath: 'D:\\projects\\one.wav' },
      { id: 'scene-002', text: '表达更重要。', startMs: 1200, endMs: durationMs, audioPath: 'D:\\projects\\two.wav' }
    ]
  };
}

describe('resolveEditPlan', () => {
  it('creates a new resolved revision with continuous scenes and bounded estimated captions', () => {
    const draft = createDraftEditPlan({ id: 'resolved', script: '产品很好。表达更重要。', voiceId: 'vivian' });
    const plan = resolveEditPlan(draft, { narration: narration(), now: new Date('2026-09-15T00:00:00Z') });
    expect(plan.revision).toBe(2);
    expect(plan.status).toBe('resolved');
    expect(plan.scenes[0].startMs).toBe(0);
    expect(plan.scenes.at(-1)?.endMs).toBe(3000);
    expect(plan.captions.flatMap(cue => cue.tokens).every(token => token.source === 'estimated')).toBe(true);
    expect(EditPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('uses source video first and inserts a controlled fallback when it is shorter than narration', () => {
    const draft = createDraftEditPlan({
      id: 'source', script: '产品很好。表达更重要。', voiceId: 'vivian', sourceVideoPath: 'D:\\clips\\source.mp4'
    });
    const plan = resolveEditPlan(draft, {
      narration: narration(), sourceMetadata: { durationMs: 1700, hasAudio: true }
    });
    expect(plan.scenes.map(scene => scene.visual.type)).toEqual(['source', 'source', 'kinetic-text']);
    expect(plan.scenes.at(-1)).toMatchObject({ startMs: 1700, endMs: 3000 });
  });
});
