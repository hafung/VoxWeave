import { describe, expect, it } from 'vitest';
import { createDraftEditPlan, EditPlanSchema } from '../../shared/edit-plan.js';
import type { MediaAsset } from '../../shared/library.js';
import { resolveEditPlan } from '../composition/resolver.js';
import { LibraryDatabase } from './database.js';
import { NoReplacementAssetError, applySceneChoice, replaceSceneAsset } from './replace-scene.js';

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

it('explains whether the only local video is unrelated or already in use', () => {
  const database = new LibraryDatabase(':memory:');
  const draft = createDraftEditPlan({ id: 'hello', script: '你好', voiceId: 'vivian', keywords: () => ['你好'] });
  const plan = resolveEditPlan(draft, { narration: {
    audioPath: '/project/hello.wav', durationMs: 1000,
    segments: [{ id: 'scene-001', text: '你好', startMs: 0, endMs: 1000, audioPath: '/project/one.wav' }]
  }});
  database.upsert({
    id: 'city', filePath: '/media/city.mp4', fingerprint: 'd'.repeat(64), type: 'video', name: 'city night.mp4',
    durationMs: 5000, width: 1920, height: 1080, fps: 30, hasAudio: false,
    tags: ['city', 'night', '城市'], autoTags: ['city', 'night', '城市'], manualTags: [], transcript: '',
    license: { status: 'licensed', source: 'pexels' }, createdAt: '2026-09-15T00:00:00.000Z'
  });
  expect(() => replaceSceneAsset(plan, plan.scenes[0].id, database)).toThrow(/没有与“你好”匹配/);
  const usingCity = EditPlanSchema.parse({ ...plan, scenes: [{ ...plan.scenes[0], visual: {
    ...plan.scenes[0].visual, type: 'video', assetId: 'city', sourceInMs: 0, sourceOutMs: 1000, motion: 'none'
  } }] });
  expect(() => replaceSceneAsset(usingCity, usingCity.scenes[0].id, database)).toThrow(/没有其他可换的画面/);
  expect(() => replaceSceneAsset(usingCity, usingCity.scenes[0].id, database)).toThrow(NoReplacementAssetError);
  database.close();
});

it('applies one video continuously across several narration sentences and rejects a short video', () => {
  const database = new LibraryDatabase(':memory:');
  const draft = createDraftEditPlan({ id: 'range', script: '你好。欢迎来到城市。', voiceId: 'vivian' });
  const plan = resolveEditPlan(draft, { narration: { audioPath: '/narration.wav', durationMs: 4000,
    segments: [
      { id: 'scene-001', text: '你好。', startMs: 0, endMs: 1500, audioPath: '/one.wav' },
      { id: 'scene-002', text: '欢迎来到城市。', startMs: 1500, endMs: 4000, audioPath: '/two.wav' }
    ] } });
  database.upsert({ id: 'long', filePath: '/city.mp4', fingerprint: 'e'.repeat(64), type: 'video', name: 'city',
    durationMs: 8000, width: 1920, height: 1080, fps: 30, hasAudio: false, tags: ['城市'], autoTags: [], manualTags: ['城市'], transcript: '',
    license: { status: 'licensed', source: 'pexels' }, createdAt: '2026-09-15T00:00:00.000Z' });
  const choice = { type: 'asset' as const, assetId: 'long', sourceInMs: 1000, throughSceneId: plan.scenes[1].id };
  const updated = applySceneChoice(plan, plan.scenes[0].id, choice, database);
  expect(updated.scenes.map(scene => [scene.visual.sourceInMs, scene.visual.sourceOutMs]))
    .toEqual([[1000, 2500], [2500, 5000]]);
  expect(() => applySceneChoice(plan, plan.scenes[0].id, { ...choice, sourceInMs: 5000 }, database)).toThrow(/超出视频时长/);
  database.close();
});
