import { EditPlanSchema, type EditPlan } from '../../shared/edit-plan.js';
import { SearchAssetsRequestSchema } from '../../shared/library.js';
import type { LibraryDatabase } from './database.js';
import { searchAssets } from './search.js';

export function replaceSceneAsset(plan: EditPlan, sceneId: string, database: LibraryDatabase, now = new Date()): EditPlan {
  if (plan.status !== 'resolved') throw new Error('只有 resolved 工程可以替换分镜素材');
  const sceneIndex = plan.scenes.findIndex(scene => scene.id === sceneId);
  if (sceneIndex < 0) throw new Error('找不到要替换的分镜');
  const scene = plan.scenes[sceneIndex];
  const candidates = searchAssets(database, SearchAssetsRequestSchema.parse({
    query: scene.visual.intent.keywords.join(' '), orientation: scene.visual.intent.orientation,
    types: scene.visual.intent.preferredTypes.filter(type => type === 'video' || type === 'image'),
    avoidAssetIds: [...scene.visual.intent.avoidAssetIds, ...(scene.visual.assetId ? [scene.visual.assetId] : [])],
    minDurationMs: scene.endMs - scene.startMs, limit: 20
  })).filter(candidate => !candidate.reasons.includes('重复惩罚') && candidate.asset.license.status !== 'unknown');
  const selected = candidates[0]?.asset;
  if (!selected) throw new Error('没有找到可替换且授权可追踪的素材');
  const updatedScenes = plan.scenes.map((item, index) => index !== sceneIndex ? item : ({
    ...item,
    visual: {
      ...item.visual, type: selected.type as 'video' | 'image', assetId: selected.id,
      sourceInMs: selected.type === 'video' ? 0 : undefined,
      sourceOutMs: selected.type === 'video' ? item.endMs - item.startMs : undefined,
      motion: selected.type === 'image' ? 'slow-zoom-in' as const : 'none' as const,
      intent: { ...item.visual.intent, avoidAssetIds: [...new Set([...item.visual.intent.avoidAssetIds, ...(item.visual.assetId ? [item.visual.assetId] : [])])] }
    }
  }));
  return EditPlanSchema.parse({ ...plan, revision: plan.revision + 1, updatedAt: now.toISOString(), scenes: updatedScenes });
}
