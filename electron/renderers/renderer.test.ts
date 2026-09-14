import { describe, expect, it } from 'vitest';
import { createDraftEditPlan } from '../../shared/edit-plan.js';
import { assertResolvedPlan } from './renderer.js';

describe('assertResolvedPlan', () => {
  it('keeps draft plans away from renderer adapters', () => {
    const plan = createDraftEditPlan({ id: 'draft', script: '先完成旁白，再开始渲染。', voiceId: 'vivian' });
    expect(() => assertResolvedPlan(plan)).toThrow(/resolved/);
  });
});
