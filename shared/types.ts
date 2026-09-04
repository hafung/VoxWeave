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

export interface VoxWeaveApi {
  getStatus(): Promise<EngineStatus>;
  configure(config: { enginePath?: string; modelDir?: string }): Promise<EngineStatus>;
  chooseFile(kind: 'audio' | 'engine' | 'model'): Promise<string | null>;
  chooseOutput(defaultName: string, format?: AudioFormat): Promise<string | null>;
  synthesize(request: SynthesisRequest): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<void>;
  reveal(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  onProgress(listener: (event: ProgressEvent & { jobId: string }) => void): () => void;
}
