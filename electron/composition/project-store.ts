import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EditPlanSchema, type EditPlan } from '../../shared/edit-plan.js';

function safeProjectId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error('无效的工程 ID');
  return id;
}

export class EditPlanStore {
  constructor(private readonly root: string) {}

  async save(input: EditPlan): Promise<string> {
    const plan = EditPlanSchema.parse(input);
    const projectDir = path.join(this.root, safeProjectId(plan.id));
    const revisionsDir = path.join(projectDir, 'revisions');
    await mkdir(revisionsDir, { recursive: true });

    const json = `${JSON.stringify(plan, null, 2)}\n`;
    const revisionPath = path.join(revisionsDir, `${String(plan.revision).padStart(4, '0')}.json`);
    const currentPath = path.join(projectDir, 'edit-plan.json');
    const temporaryPath = path.join(projectDir, `.edit-plan.${process.pid}.${Date.now()}.tmp`);

    try {
      await writeFile(revisionPath, json, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
      const existing = await readFile(revisionPath, 'utf8');
      if (existing !== json) throw new Error(`工程修订版 ${plan.revision} 已存在且内容不同`);
    }

    try {
      await writeFile(temporaryPath, json, 'utf8');
      await rename(temporaryPath, currentPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return currentPath;
  }

  async read(id: string): Promise<EditPlan> {
    const file = path.join(this.root, safeProjectId(id), 'edit-plan.json');
    const json: unknown = JSON.parse(await readFile(file, 'utf8'));
    return EditPlanSchema.parse(json);
  }
}
