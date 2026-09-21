import { describe, expect, it } from 'vitest';
import { createDraftEditPlan } from '../../shared/edit-plan.js';
import type { MediaAsset } from '../../shared/library.js';
import { resolveEditPlan } from '../composition/resolver.js';
import { LibraryDatabase } from './database.js';
import { replaceSceneAsset } from './replace-scene.js';

it('replaces one scene in a new immutable revision while retaining the original intent', () => {
  const database = new LibraryDatabase(':memory:');
  const draft = createDraftEditPlan({ id: 'replace', script: '电商产品展示。', voiceId: 'vivian', keywords: () => ['电商', '产品'] });
  const plan = resolveEditPlan(draft, { narration: {
    audioPath: '/project/narration.wav', durationMs: 1500,
    segments: [{ id: 'scene-001', text: '电商产品展示。', startMs: 0, endMs: 1500, audioPath: '/project/one.wav' }]
  }});
  const candidate: MediaAsset = {
    id: 'candidate', filePath: '/media/candidate.mp4', fingerprint: 'c'.repeat(64), type: 'video', name: '产品展示.mp4',
    durationMs: 3000, width: 1080, height: 1920, fps: 30, hasAudio: false, tags: ['电商', '产品'], autoTags: [], manualTags: ['电商', '产品'], transcript: '',
    license: { status: 'licensed', source: 'brand-library' }, createdAt: '2026-09-15T00:00:00.000Z'
  };
  database.upsert(candidate);
  const updated = replaceSceneAsset(plan, plan.scenes[0].id, database, new Date('2026-09-15T01:00:00Z'));
  expect(updated.revision).toBe(plan.revision + 1);
  expect(updated.scenes[0].visual.assetId).toBe('candidate');
  expect(updated.scenes[0].visual.intent.keywords).toEqual(plan.scenes[0].visual.intent.keywords);
  expect(plan.scenes[0].visual.type).toBe('kinetic-text');
  database.close();
});
