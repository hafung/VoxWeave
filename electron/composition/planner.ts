import { randomUUID } from 'node:crypto';
import { createDraftEditPlan, DraftPlanRequestSchema, type EditPlan } from '../../shared/edit-plan.js';
import { extractChineseKeywords } from './segmenter.js';

export function planDraft(input: unknown, now = new Date()): EditPlan {
  const request = DraftPlanRequestSchema.parse(input);
  return createDraftEditPlan({
    ...request,
    id: randomUUID(),
    keywords: text => extractChineseKeywords(text, 5),
    now
  });
}
