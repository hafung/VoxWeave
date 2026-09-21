import type { MediaAsset, SearchAssetsRequest } from '../../shared/library.js';
import type { LibraryDatabase } from './database.js';
import { expandKeywords } from '../../shared/keywords.js';

export interface RankedAsset { asset: MediaAsset; score: number; reasons: string[] }

function orientationOf(asset: MediaAsset): SearchAssetsRequest['orientation'] | undefined {
  if (!asset.width || !asset.height) return undefined;
  const ratio = asset.width / asset.height;
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}

function scoreAsset(asset: MediaAsset, request: SearchAssetsRequest, fullTextScore: number): RankedAsset {
  let score = fullTextScore;
  const reasons: string[] = [];
  if (request.orientation && orientationOf(asset) === request.orientation) { score += 3; reasons.push('画幅匹配'); }
  else if (request.orientation && orientationOf(asset)) { score -= 1.5; reasons.push('需要裁切'); }
  if (asset.width && asset.height && Math.max(asset.width, asset.height) >= 1080) { score += 1; reasons.push('高清素材'); }
  if (asset.durationMs && asset.durationMs >= request.minDurationMs) { score += 1.5; reasons.push('时长充足'); }
  if (request.avoidAssetIds.includes(asset.id)) { score -= 100; reasons.push('重复惩罚'); }
  if (asset.license.status === 'unknown') { score -= 25; reasons.push('授权未知'); }
  else { score += 1; reasons.push('授权可追踪'); }
  return { asset, score, reasons };
}

export function searchAssets(database: LibraryDatabase, request: SearchAssetsRequest): RankedAsset[] {
  const expression = expandKeywords(request.query).map(term => term.replace(/["'*():]/gu, ' ').trim()).filter(Boolean).map(term => `"${term}"`).join(' OR ');
  const fullText = expression
    ? database.fullText(expression, request.limit * 4)
    : database.list(request.limit * 4).map(asset => ({ asset, bm25: 0 }));
  return fullText
    .filter(({ asset }) => request.types.includes(asset.type))
    .filter(({ asset }) => !asset.durationMs || asset.durationMs >= request.minDurationMs || asset.type === 'image')
    .map(({ asset, bm25 }) => scoreAsset(asset, request, bm25 === 0 ? 0 : Math.min(8, Math.max(0, -bm25))))
    .sort((left, right) => right.score - left.score || left.asset.id.localeCompare(right.asset.id))
    .slice(0, request.limit);
}
