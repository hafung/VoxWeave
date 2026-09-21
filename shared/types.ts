export const LANGUAGES = ['Auto', 'Chinese', 'English', 'Japanese', 'Korean', 'German', 'French', 'Russian', 'Portuguese', 'Spanish', 'Italian'] as const;
export type Language = typeof LANGUAGES[number];
export const AUDIO_FORMATS = ['wav', 'flac', 'mp3', 'opus', 'm4a'] as const;
export type AudioFormat = typeof AUDIO_FORMATS[number];

export interface VoiceProfile {
  id: string;
  name: string;
  kind: 'preset' | 'clone';
  path?: string;
  language?: Language;
  createdAt?: string;
}

export interface SynthesisRequest {
  text: string;
  outputPath: string;
  outputFormat?: AudioFormat;
  modelDir?: string;
  language: Language;
  speaker?: string;
  voicePath?: string;
  referenceAudio?: string;
  referenceText?: string;
  temperature: number;
  topK: number;
  topP: number;
  seed?: number;
  threads: number;
  precision: 'bf16' | 'int8' | 'int4';
}

export interface EngineStatus {
  state: 'missing' | 'idle' | 'working' | 'error';
  backend: 'native' | 'wsl' | 'none';
  enginePath?: string;
  modelDir?: string;
  message: string;
}

export interface ProgressEvent {
  phase: 'preparing' | 'encoding' | 'generating' | 'composing' | 'complete' | 'error';
  progress?: number;
  message: string;
  outputPath?: string;
}

export type CompositionPhase = 'drafting' | 'narrating' | 'resolving' | 'aligning' | 'selecting' | 'compiling' | 'complete' | 'cancelled' | 'error';

export interface CompositionProgressEvent {
  jobId: string;
  phase: CompositionPhase;
  progress: number;
  message: string;
  plan?: EditPlan;
  preview?: { entryUrl: string; durationMs: number; width: number; height: number };
  recoverable?: boolean;
}

export interface GenerateCompositionRequest extends DraftPlanRequest {
  language?: Language;
  temperature?: number;
  precision?: SynthesisRequest['precision'];
}

export interface VoxWeaveApi {
  getStatus(): Promise<EngineStatus>;
  configure(config: { enginePath?: string; modelDir?: string }): Promise<EngineStatus>;
  chooseFile(kind: 'audio' | 'video' | 'engine' | 'model'): Promise<string | null>;
  chooseOutput(defaultName: string, format?: AudioFormat): Promise<string | null>;
  createDraftPlan(request: DraftPlanRequest): Promise<EditPlan>;
  generateComposition(request: GenerateCompositionRequest): Promise<{ jobId: string; projectId: string }>;
  cancelComposition(jobId: string): Promise<void>;
  resumeLastProject(): Promise<{ plan: EditPlan; preview?: CompositionProgressEvent['preview'] } | null>;
  replaceScene(projectId: string, sceneId: string): Promise<{ plan: EditPlan; preview: NonNullable<CompositionProgressEvent['preview']> }>;
  importAssets(): Promise<ImportReport>;
  listAssets(): Promise<MediaAsset[]>;
  searchAssets(query: string, type?: MediaAsset['type']): Promise<MediaAsset[]>;
  updateAssetTags(ids: string[], tags: string[], mode: 'replace' | 'append'): Promise<void>;
  autoTagAssets(ids: string[]): Promise<void>;
  removeAssets(ids: string[]): Promise<void>;
  pexelsStatus(): Promise<{ configured: boolean }>;
  configurePexels(key: string): Promise<void>;
  searchPexels(request: { query: string; type: 'video' | 'image'; page: number; orientation?: 'portrait' | 'landscape' | 'square' }): Promise<{ items: OnlineAsset[]; query: string }>;
  downloadPexels(id: string): Promise<MediaAsset>;
  openSource(url: string): Promise<void>;
  updateBgm(projectId: string, bgm: EditPlan['bgm']): Promise<{ plan: EditPlan; preview: NonNullable<CompositionProgressEvent['preview']> }>;
  exportVideo(projectId: string): Promise<{ jobId: string } | null>;
  cancelExport(jobId: string): Promise<void>;
  onExportProgress(listener: (event: ExportProgress) => void): () => void;
  synthesize(request: SynthesisRequest): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<void>;
  reveal(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  onProgress(listener: (event: ProgressEvent & { jobId: string }) => void): () => void;
  onCompositionProgress(listener: (event: CompositionProgressEvent) => void): () => void;
}
import type { DraftPlanRequest, EditPlan } from './edit-plan.js';
import type { MediaAsset, ImportReport, OnlineAsset } from './library.js';
export interface ExportProgress {
  jobId: string; progress: number; phase: 'preparing' | 'capturing' | 'encoding' | 'complete' | 'error' | 'cancelled';
  message: string; outputPath?: string;
}
