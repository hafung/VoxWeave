import { z } from 'zod';

export const AssetTypeSchema = z.enum(['video', 'image', 'audio']);
export const AssetLicenseSchema = z.object({
  status: z.enum(['user-owned', 'licensed', 'unknown']),
  source: z.string().trim().min(1),
  note: z.string().trim().optional()
}).strict();

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().trim().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  type: AssetTypeSchema,
  name: z.string().trim().min(1),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  hasAudio: z.boolean(),
  thumbnailPath: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)),
  transcript: z.string().default(''),
  license: AssetLicenseSchema,
  createdAt: z.string().datetime()
}).strict();

export const ImportAssetRequestSchema = z.object({
  filePath: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).max(50).default([]),
  license: AssetLicenseSchema.default({ status: 'user-owned', source: 'user-import' })
}).strict();

export const SearchAssetsRequestSchema = z.object({
  query: z.string().trim().max(500).default(''),
  orientation: z.enum(['portrait', 'landscape', 'square']).optional(),
  types: z.array(AssetTypeSchema).max(3).default(['video', 'image']),
  avoidAssetIds: z.array(z.string()).max(100).default([]),
  minDurationMs: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(20)
}).strict();

export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export type ImportAssetRequest = z.infer<typeof ImportAssetRequestSchema>;
export type SearchAssetsRequest = z.infer<typeof SearchAssetsRequestSchema>;
export type AssetLicense = z.infer<typeof AssetLicenseSchema>;
