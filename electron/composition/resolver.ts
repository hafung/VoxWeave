import type { EditPlan, Scene } from '../../shared/edit-plan.js';
import { EditPlanSchema } from '../../shared/edit-plan.js';
import type { MediaMetadata } from '../media/probe.js';
import type { NarrationArtifact } from './narration.js';
import { estimateCaptionCues } from './captions.js';

export interface ResolvePlanOptions {
  narration: NarrationArtifact;
  sourceMetadata?: MediaMetadata;
  now?: Date;
}

function resolvedScenes(plan: EditPlan, narration: NarrationArtifact, sourceMetadata?: MediaMetadata): Scene[] {
  let sourceCursor = 0;
  const scenes: Scene[] = [];
  for (const [index, segment] of narration.segments.entries()) {
    const draft = plan.scenes[index] ?? plan.scenes.at(-1)!;
    const duration = segment.endMs - segment.startMs;
    const sourceAvailable = plan.input.sourceVideoPath && sourceMetadata
      ? Math.max(0, (sourceMetadata.durationMs ?? 0) - sourceCursor)
      : 0;
    const sourceDuration = Math.min(duration, sourceAvailable);
    if (sourceDuration > 0) {
      scenes.push({
        ...draft,
        id: sourceDuration === duration ? draft.id : `${draft.id}-source`,
        startMs: segment.startMs,
        endMs: segment.startMs + sourceDuration,
        visual: {
          ...draft.visual,
          type: 'source',
          assetId: 'source-video',
          sourceInMs: sourceCursor,
          sourceOutMs: sourceCursor + sourceDuration,
          motion: 'none',
          intent: { ...draft.visual.intent, minDurationMs: sourceDuration }
        }
      });
      sourceCursor += sourceDuration;
    }
    if (sourceDuration < duration) {
      scenes.push({
        ...draft,
        id: sourceDuration > 0 ? `${draft.id}-fallback` : draft.id,
        startMs: segment.startMs + sourceDuration,
        endMs: segment.endMs,
        visual: {
          ...draft.visual,
          type: 'kinetic-text',
          assetId: undefined,
          sourceInMs: undefined,
          sourceOutMs: undefined,
          motion: 'slow-zoom-in',
          intent: { ...draft.visual.intent, minDurationMs: duration - sourceDuration }
        },
        transition: sourceDuration > 0 ? 'crossfade' : draft.transition
      });
    }
  }
  return scenes;
}

export function resolveEditPlan(plan: EditPlan, options: ResolvePlanOptions): EditPlan {
  if (plan.status !== 'draft') throw new Error('只有 draft EditPlan 可以解析');
  if (!options.narration.durationMs || !options.narration.audioPath) throw new Error('解析 EditPlan 前必须生成旁白');
  if (plan.input.sourceVideoPath && !options.sourceMetadata) throw new Error('提供原视频时必须先探测媒体时长');
  if (plan.input.sourceVideoPath && !options.sourceMetadata?.durationMs) throw new Error('原视频缺少有效时长');
  const now = (options.now ?? new Date()).toISOString();
  const resolved = {
    ...plan,
    revision: plan.revision + 1,
    updatedAt: now,
    status: 'resolved' as const,
    narration: {
      ...plan.narration,
      state: 'ready' as const,
      audioPath: options.narration.audioPath,
      durationMs: options.narration.durationMs,
      segments: options.narration.segments
    },
    scenes: resolvedScenes(plan, options.narration, options.sourceMetadata),
    captions: estimateCaptionCues(options.narration.segments)
  };
  return EditPlanSchema.parse(resolved);
}
