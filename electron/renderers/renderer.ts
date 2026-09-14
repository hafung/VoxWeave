import type { EditPlan } from '../../shared/edit-plan.js';

export interface PreparedComposition {
  entryUrl: string;
  workspace: string;
  durationMs: number;
}

export interface RenderRequest {
  jobId: string;
  composition: PreparedComposition;
  outputPath: string;
}

export interface RenderProgress {
  jobId: string;
  phase: 'preparing' | 'capturing' | 'encoding' | 'complete' | 'error';
  progress: number;
  message: string;
}

export interface RenderResult {
  outputPath: string;
  durationMs: number;
}

export type RenderProgressHandler = (event: RenderProgress) => void;

export interface VideoRenderer {
  prepare(plan: EditPlan, workspace: string): Promise<PreparedComposition>;
  render(request: RenderRequest, onProgress: RenderProgressHandler): Promise<RenderResult>;
  cancel(jobId: string): Promise<void>;
}

export function assertResolvedPlan(plan: EditPlan): asserts plan is EditPlan & {
  status: 'resolved' | 'rendering' | 'complete';
  narration: EditPlan['narration'] & { state: 'ready'; audioPath: string; durationMs: number };
} {
  if (!['resolved', 'rendering', 'complete'].includes(plan.status)) {
    throw new Error('只有 resolved 及后续状态的 EditPlan 可以交给渲染器');
  }
  if (plan.narration.state !== 'ready' || !plan.narration.audioPath || !plan.narration.durationMs) {
    throw new Error('渲染前必须完成旁白并写入真实时长');
  }
}
