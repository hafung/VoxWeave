import { describe, expect, it } from 'vitest';
import { createDraftEditPlan } from '../../shared/edit-plan.js';
import type { MediaAsset } from '../../shared/library.js';
import { resolveEditPlan } from '../composition/resolver.js';
import { LibraryDatabase } from './database.js';
import { selectBroll } from './selector.js';

it('selects licensed B-roll without repeating an asset across consecutive scenes', () => {
  const database = new LibraryDatabase(':memory:');
  for (const id of ['a', 'b']) database.upsert({
    id, filePath: `/media/${id}.mp4`, fingerprint: id.repeat(64), type: 'video', name: `产品-${id}.mp4`,
    durationMs: 5000, width: 1080, height: 1920, fps: 30, hasAudio: false, tags: ['产品'], transcript: '',
    license: { status: 'licensed', source: 'test' }, createdAt: '2026-09-15T00:00:00.000Z'
  } satisfies MediaAsset);
  const draft = createDraftEditPlan({ id: 'select', script: '产品第一句。产品第二句。', voiceId: 'vivian', keywords: () => ['产品'] });
  const plan = resolveEditPlan(draft, { narration: {
    audioPath: '/narration.wav', durationMs: 2400,
    segments: [
      { id: 'scene-001', text: '产品第一句。', startMs: 0, endMs: 1200, audioPath: '/one.wav' },
      { id: 'scene-002', text: '产品第二句。', startMs: 1200, endMs: 2400, audioPath: '/two.wav' }
    ]
  }});
  const selected = selectBroll(plan, database);
  expect(selected.scenes.map(scene => scene.visual.assetId)).toEqual(['a', 'b']);
  database.close();
});
