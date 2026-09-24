import type { EditPlan, Scene } from '../../shared/edit-plan.js';

export function sceneRange(plan: EditPlan, sceneId: string, throughSceneId?: string): { scenes: Scene[]; durationMs: number } {
  const start = plan.scenes.findIndex(scene => scene.id === sceneId);
  if (start < 0) throw new Error('找不到要替换的分镜');
  const end = throughSceneId ? plan.scenes.findIndex(scene => scene.id === throughSceneId) : start;
  if (end < start) throw new Error('请选择当前分镜或之后的结束位置');
  const scenes = plan.scenes.slice(start, end + 1);
  return { scenes, durationMs: scenes.at(-1)!.endMs - scenes[0].startMs };
}
