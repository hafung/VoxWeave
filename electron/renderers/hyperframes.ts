import type { EditPlan } from '../../shared/edit-plan.js';
import type { VideoRenderer, PreparedComposition, RenderProgressHandler, RenderRequest, RenderResult } from './renderer.js';
import { compileFixedTemplate, type AssetPathResolver } from './template-compiler.js';

export class HyperframesPreviewRenderer implements VideoRenderer {
  constructor(private readonly resolveAsset?: AssetPathResolver) {}

  prepare(plan: EditPlan, workspace: string): Promise<PreparedComposition> {
    return compileFixedTemplate(plan, workspace, this.resolveAsset);
  }

  async render(_request: RenderRequest, _onProgress: RenderProgressHandler): Promise<RenderResult> {
    throw new Error('最终 MP4 渲染将在 M3 启用；当前只提供同源 composition 预览');
  }

  async cancel(_jobId: string): Promise<void> {}
}
