import path from 'node:path';
import { expandKeywords } from '../../shared/keywords.js';
import type { MediaAsset } from '../../shared/library.js';

export function automaticTags(asset: Pick<MediaAsset, 'filePath' | 'type' | 'width' | 'height' | 'durationMs' | 'transcript'> & { name?: string }): string[] {
  const filename = path.basename(asset.filePath, path.extname(asset.filePath));
  const directory = path.basename(path.dirname(asset.filePath));
  const tags = expandKeywords(`${filename} ${directory} ${asset.name ?? ''} ${asset.transcript}`).filter(tag => tag.length > 1 && tag.length <= 60);
  tags.push({ video: '视频', image: '图片', audio: '音频' }[asset.type]);
  if (asset.width && asset.height) {
    tags.push(asset.width / asset.height > 1.15 ? '横屏' : asset.height / asset.width > 1.15 ? '竖屏' : '方形');
    if (Math.max(asset.width, asset.height) >= 1920) tags.push('高清');
  }
  return [...new Set(tags)].slice(0, 100);
}
