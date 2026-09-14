import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraftEditPlan } from '../../shared/edit-plan.js';
import { EditPlanStore } from './project-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('EditPlanStore', () => {
  it('atomically persists the current plan and an immutable revision', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-plan-store-'));
    temporaryDirectories.push(root);
    const store = new EditPlanStore(root);
    const plan = createDraftEditPlan({ id: 'project-1', script: '生成一个可以恢复的工程。', voiceId: 'vivian' });

    const currentPath = await store.save(plan);
    expect(await store.read('project-1')).toEqual(plan);
    expect(JSON.parse(await readFile(path.join(root, 'project-1', 'revisions', '0001.json'), 'utf8'))).toEqual(plan);
    expect(currentPath).toBe(path.join(root, 'project-1', 'edit-plan.json'));
  });

  it('rejects unsafe project ids', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-plan-store-'));
    temporaryDirectories.push(root);
    const store = new EditPlanStore(root);
    const plan = createDraftEditPlan({ id: '../escape', script: '不能逃出项目目录。', voiceId: 'vivian' });
    await expect(store.save(plan)).rejects.toThrow(/工程 ID/);
  });
});
