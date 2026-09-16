import { EditPlanSchema, type EditPlan } from '../../shared/edit-plan.js';
import { SearchAssetsRequestSchema } from '../../shared/library.js';
import type { LibraryDatabase } from './database.js';
import { searchAssets } from './search.js';

export function selectBroll(plan: EditPlan, database: LibraryDatabase, now = new Date()): EditPlan {
  if (plan.status !== 'resolved') throw new Error('只有 resolved EditPlan 可以选择素材');
  const used: string[] = [];
  let changed = false;
  const scenes = plan.scenes.map(scene => {
    if (scene.visual.type !== 'kinetic-text') {
      if (scene.visual.assetId) used.push(scene.visual.assetId);
      return scene;
    }
    const preferred = scene.visual.intent.preferredTypes.filter(type => type === 'video' || type === 'image');
    if (!preferred.length) return scene;
    const result = searchAssets(database, SearchAssetsRequestSchema.parse({
      query: scene.visual.intent.keywords.join(' '), orientation: scene.visual.intent.orientation,
      types: preferred, avoidAssetIds: [...scene.visual.intent.avoidAssetIds, ...used],
      minDurationMs: scene.endMs - scene.startMs, limit: 10
    })).find(candidate => candidate.asset.license.status !== 'unknown' && !used.includes(candidate.asset.id));
    if (!result) return scene;
    changed = true;
    used.push(result.asset.id);
    const duration = scene.endMs - scene.startMs;
    return {
      ...scene,
      visual: {
        ...scene.visual, type: result.asset.type as 'video' | 'image', assetId: result.asset.id,
        sourceInMs: result.asset.type === 'video' ? 0 : undefined,
        sourceOutMs: result.asset.type === 'video' ? duration : undefined,
        motion: result.asset.type === 'image' ? 'slow-zoom-in' as const : 'none' as const,
        intent: { ...scene.visual.intent, avoidAssetIds: [...new Set([...scene.visual.intent.avoidAssetIds, ...used.slice(0, -1)])] }
      }
    };
  });
  if (!changed) return plan;
  return EditPlanSchema.parse({ ...plan, revision: plan.revision + 1, updatedAt: now.toISOString(), scenes });
}
