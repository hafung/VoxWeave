import path from 'node:path';
import { pathToFileURL } from 'node:url';

const safeId = /^[A-Za-z0-9_-]{1,128}$/;

export class PreviewRegistry {
  private readonly roots = new Map<string, string>();

  register(id: string, workspace: string): string {
    if (!safeId.test(id)) throw new Error('无效的预览 ID');
    this.roots.set(id, path.resolve(workspace));
    return `voxweave-preview://composition/${id}/index.html`;
  }

  unregister(id: string): void { this.roots.delete(id); }

  resolve(requestUrl: string): URL {
    const url = new URL(requestUrl);
    if (url.protocol !== 'voxweave-preview:' || url.hostname !== 'composition') throw new Error('无效的预览 URL');
    const [, id, ...parts] = url.pathname.split('/');
    if (!id || !safeId.test(id)) throw new Error('无效的预览 ID');
    const root = this.roots.get(id);
    if (!root) throw new Error('预览已过期，请重新加载');
    const target = path.resolve(root, ...parts.map(decodeURIComponent));
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('预览资源越界');
    return pathToFileURL(target);
  }
}
