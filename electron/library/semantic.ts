import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import type { MediaAsset } from '../../shared/library.js';

export interface SemanticEmbedder { embed(texts: string[]): Promise<number[][]> }

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return -1;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1;
}

export class SemanticReranker {
  private readonly cache = new Map<string, number[]>();
  constructor(private readonly embedder: SemanticEmbedder) {}

  clear(): void { this.cache.clear(); }

  async rank(query: string, assets: MediaAsset[]): Promise<Map<string, number>> {
    if (!query.trim() || !assets.length) return new Map();
    if (this.cache.size > 2000) this.cache.clear();
    const limited = assets.slice(0, 60);
    const descriptions = limited.map(asset => `${asset.name} ${asset.tags.join(' ')} ${asset.transcript}`.trim().slice(0, 500));
    const keys = limited.map((asset, index) => `${asset.fingerprint}:${descriptions[index]}`);
    const missing = [...new Set(keys.filter(key => !this.cache.has(key)))];
    const missingTexts = missing.map(key => descriptions[keys.indexOf(key)]);
    const vectors = await this.embedder.embed([`Instruct: Retrieve media descriptions relevant to a video scene.\nQuery: ${query}`, ...missingTexts]);
    if (vectors.length !== missingTexts.length + 1 || vectors.some(vector => !Array.isArray(vector) || !vector.every(Number.isFinite))) {
      throw new Error('语义模型返回了无效向量');
    }
    missing.forEach((key, index) => this.cache.set(key, vectors[index + 1]));
    return new Map(limited.map((asset, index) => [asset.id, cosine(vectors[0], this.cache.get(keys[index])!)]));
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('无法分配本地端口')));
    });
  });
}

export class LocalLlamaEmbedder implements SemanticEmbedder {
  private child?: ChildProcess;
  private endpoint?: string;
  private starting?: Promise<string>;
  constructor(private readonly paths: () => { enginePath?: string; modelPath?: string }) {}

  private async start(): Promise<string> {
    if (this.endpoint && this.child?.exitCode === null) return this.endpoint;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const { enginePath, modelPath } = this.paths();
      if (!enginePath || !modelPath || !existsSync(enginePath) || !existsSync(modelPath)) throw new Error('请先配置本地 llama-server 和 embedding 模型');
      const port = await availablePort();
      const endpoint = `http://127.0.0.1:${port}`;
      const child = spawn(enginePath, ['-m', modelPath, '--embedding', '--pooling', 'last', '--host', '127.0.0.1',
        '--port', String(port), '-ngl', '0', '-c', '1024'], { windowsHide: true, stdio: 'ignore' });
      this.child = child;
      let failed = false;
      child.once('error', () => { failed = true; });
      child.once('exit', () => { failed = true; this.endpoint = undefined; });
      for (let attempt = 0; attempt < 120; attempt++) {
        if (failed) break;
        try {
          const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) });
          if (response.ok) { this.endpoint = endpoint; return endpoint; }
        } catch { /* Loading model. */ }
        await delay(250);
      }
      child.kill();
      throw new Error('本地语义模型启动失败或超时，请检查 llama-server 与模型文件');
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const endpoint = await this.start();
    const response = await fetch(`${endpoint}/v1/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts }), signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`本地语义模型请求失败（${response.status}）`);
    const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    if (!Array.isArray(payload.data) || payload.data.length !== texts.length) throw new Error('本地语义模型返回格式不正确');
    return payload.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
  }

  dispose(): void { this.child?.kill(); this.child = undefined; this.endpoint = undefined; }
}
