import { EditPlanSchema, type EditPlan } from '../../shared/edit-plan.js';
import { SearchAssetsRequestSchema } from '../../shared/library.js';
import type { LibraryDatabase } from './database.js';
import { searchAssets } from './search.js';
import { sceneSearchIntent } from './scene-candidates.js';
import { isOriginalSourceAsset } from './scene-candidates.js';

export function selectBroll(plan: EditPlan, database: LibraryDatabase, now = new Date()): EditPlan {
  if (plan.status !== 'resolved') throw new Error('只有 resolved EditPlan 可以选择素材');
  const used = new Map<string, Array<{ start: number; end: number }>>();
  const remember = (id: string, start: number, end: number) => used.set(id, [...(used.get(id) ?? []), { start, end }]);
  const freeStart = (id: string, duration: number, assetDuration?: number): number | undefined => {
    if (!assetDuration || assetDuration < duration) return undefined;
    let start = 0;
    for (const range of [...(used.get(id) ?? [])].sort((left, right) => left.start - right.start)) {
      if (start + duration <= range.start) return start;
      if (start < range.end) start = range.end;
    }
    return start + duration <= assetDuration ? start : undefined;
  };
  let changed = false;
  const scenes = [...plan.scenes];
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    if (scene.visual.type !== 'kinetic-text') {
      if (scene.visual.assetId) remember(scene.visual.assetId, scene.visual.sourceInMs ?? 0, scene.visual.sourceOutMs ?? scene.endMs - scene.startMs);
      continue;
    }
    const preferred = scene.visual.intent.preferredTypes.filter(type => type === 'video' || type === 'image');
    if (!preferred.length) continue;
    let last = index;
    const groupWords = new Set(scene.visual.intent.keywords.filter(word => word.length > 1 && !['你好', '您好', '大家好'].includes(word)));
    while (last + 1 < scenes.length && last - index < 2) {
      const next = scenes[last + 1];
      const nextWords = next.visual.intent.keywords.filter(word => word.length > 1 && !['你好', '您好', '大家好'].includes(word));
      if (next.visual.type !== 'kinetic-text' || next.endMs - scene.startMs > 8000 ||
        scenes[last].endMs !== next.startMs ||
        (groupWords.size > 0 && nextWords.length > 0 && !nextWords.some(word => groupWords.has(word)))) break;
      last++;
      nextWords.forEach(word => groupWords.add(word));
    }
    let result: ReturnType<typeof searchAssets>[number] | undefined;
    let chosenLast = index;
    for (let end = last; end >= index; end--) {
      const duration = scenes[end].endMs - scene.startMs;
      result = searchAssets(database, SearchAssetsRequestSchema.parse({
        query: sceneSearchIntent(plan, scene).query, orientation: scene.visual.intent.orientation,
        types: preferred, avoidAssetIds: scene.visual.intent.avoidAssetIds,
        minDurationMs: duration, limit: 10
      })).sort((left, right) => Number(used.has(left.asset.id)) - Number(used.has(right.asset.id)) || right.score - left.score)
        .find(candidate => !isOriginalSourceAsset(plan, candidate.asset) && candidate.asset.license.status !== 'unknown' &&
        (candidate.asset.type === 'image' ? !used.has(candidate.asset.id) :
          freeStart(candidate.asset.id, duration, candidate.asset.durationMs) !== undefined));
      if (result) { chosenLast = end; break; }
    }
    if (!result) continue;
    changed = true;
    const duration = scenes[chosenLast].endMs - scene.startMs;
    const sourceInMs = result.asset.type === 'video' ? freeStart(result.asset.id, duration, result.asset.durationMs)! : undefined;
    remember(result.asset.id, sourceInMs ?? 0, (sourceInMs ?? 0) + duration);
    for (let selected = index; selected <= chosenLast; selected++) {
      const item = scenes[selected];
      scenes[selected] = {
        ...item,
        visual: {
          ...item.visual, type: result.asset.type as 'video' | 'image', assetId: result.asset.id,
          sourceInMs: result.asset.type === 'video' ? sourceInMs! + item.startMs - scene.startMs : undefined,
          sourceOutMs: result.asset.type === 'video' ? sourceInMs! + item.endMs - scene.startMs : undefined,
          motion: result.asset.type === 'image' ? 'slow-zoom-in' as const : 'none' as const
        }
      };
    }
    index = chosenLast;
  }
  if (!changed) return plan;
  return EditPlanSchema.parse({ ...plan, revision: plan.revision + 1, updatedAt: now.toISOString(), scenes });
}
