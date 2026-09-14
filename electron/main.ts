import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import Store from 'electron-store';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { QwenEngine, type EngineConfig } from './engine.js';
import { planDraft } from './composition/planner.js';
import { EditPlanStore } from './composition/project-store.js';
import type { AudioFormat, SynthesisRequest } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);
const store = new Store<EngineConfig>({ name: 'settings', defaults: {} });
const jobs = new Map<string, QwenEngine>();

function asWslPath(file: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(path.resolve(file));
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}` : file;
}

function configuredEngine(): QwenEngine {
  const resourceRoot = isDev ? path.resolve(__dirname, '..', '..', 'resources') : process.resourcesPath;
  const nativeEngine = path.join(resourceRoot, 'engine', 'qwen_tts.exe');
  const bundledModel = path.join(resourceRoot, 'models', 'qwen3-tts-0.6b-base');
  const ffmpegPath = path.join(resourceRoot, 'ffmpeg', 'ffmpeg.exe');
  return new QwenEngine({
    enginePath: store.get('enginePath') ?? process.env.VOXWEAVE_ENGINE ?? nativeEngine,
    modelDir: store.get('modelDir') ?? process.env.VOXWEAVE_MODEL ?? bundledModel,
    ffmpegPath: existsSync(ffmpegPath) ? ffmpegPath : process.env.VOXWEAVE_FFMPEG
  });
}

function createWindow(): void {
  const splash = new BrowserWindow({
    width: 430, height: 270, frame: false, resizable: false, show: false,
    alwaysOnTop: true, center: true, backgroundColor: '#0c0d10',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const splashHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
    body{font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:#f4f4f2;background:radial-gradient(circle at 50% 25%,#202817 0,#11140f 35%,#0c0d10 72%);display:grid;place-items:center}
    .shell{text-align:center;transform:translateY(-3px)}.logo{width:74px;height:74px;margin:0 auto 19px;border-radius:22px;background:#d9ff69;color:#111;display:grid;place-items:center;box-shadow:0 0 0 0 rgba(217,255,105,.3);animation:pulse 1.8s ease-out infinite}
    .bars{height:29px;display:flex;align-items:center;gap:4px}.bars i{display:block;width:4px;border-radius:4px;background:#111;animation:wave 1s ease-in-out infinite}.bars i:nth-child(1),.bars i:nth-child(5){height:12px}.bars i:nth-child(2),.bars i:nth-child(4){height:21px;animation-delay:.12s}.bars i:nth-child(3){height:29px;animation-delay:.24s}
    h1{font-size:20px;letter-spacing:.04em;margin:0 0 6px}h1 span{color:#82868d;font-size:11px;font-weight:500;letter-spacing:.12em;margin-left:7px}p{margin:0;color:#858990;font-size:11px}
    .loader{width:178px;height:3px;margin:22px auto 0;background:#24272b;border-radius:5px;overflow:hidden}.loader:after{content:"";display:block;width:45%;height:100%;border-radius:5px;background:#d9ff69;animation:load 1.25s ease-in-out infinite}
    @keyframes wave{0%,100%{transform:scaleY(.58)}50%{transform:scaleY(1)}}@keyframes pulse{65%,100%{box-shadow:0 0 0 22px rgba(217,255,105,0)}}@keyframes load{0%{transform:translateX(-105%)}100%{transform:translateX(325%)}}
  </style></head><body><div class="shell"><div class="logo"><div class="bars"><i></i><i></i><i></i><i></i><i></i></div></div><h1>声织 <span>VOXWEAVE</span></h1><p>正在唤醒本地声音引擎…</p><div class="loader"></div></div></body></html>`;
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
  splash.once('ready-to-show', () => splash.show());
  const splashStarted = Date.now();
  const window = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1120, minHeight: 720,
    backgroundColor: '#0c0d10', titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c0d10', symbolColor: '#92959d', height: 42 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.once('ready-to-show', () => {
    const remaining = Math.max(0, 650 - (Date.now() - splashStarted));
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.close();
      window.show(); window.focus();
    }, remaining);
  });
  window.on('closed', () => { if (!splash.isDestroyed()) splash.close(); });
  if (devServerUrl) window.loadURL(devServerUrl);
  else window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
}

const cliMode = process.argv.includes('--cli');
if (cliMode) {
  process.argv.splice(process.argv.indexOf('--cli'), 1);
  process.env.VOXWEAVE_ENGINE ??= path.join(process.resourcesPath, 'engine', 'qwen_tts.exe');
  process.env.VOXWEAVE_MODEL ??= path.join(process.resourcesPath, 'models', 'qwen3-tts-0.6b-base');
  process.env.VOXWEAVE_FFMPEG ??= path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  void import('../cli/voxweave.js');
} else app.whenReady().then(() => {
  const editPlans = new EditPlanStore(path.join(app.getPath('userData'), 'projects'));
  ipcMain.handle('engine:status', () => configuredEngine().status());
  ipcMain.handle('engine:configure', async (_event, config: EngineConfig) => {
    if (config.enginePath !== undefined) store.set('enginePath', config.enginePath);
    if (config.modelDir !== undefined) store.set('modelDir', config.modelDir);
    return configuredEngine().status();
  });
  ipcMain.handle('dialog:choose-file', async (_event, kind: 'audio' | 'video' | 'engine' | 'model') => {
    if (kind === 'model') {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择 Qwen3-TTS 模型目录' });
      return result.canceled ? null : result.filePaths[0];
    }
    const filters = kind === 'audio'
      ? [{ name: '音频', extensions: ['wav', 'flac', 'mp3', 'ogg', 'opus', 'm4a', 'aac'] }]
      : kind === 'video'
        ? [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }]
        : [{ name: 'Qwen3-TTS 引擎', extensions: ['exe', 'bin', '*'] }];
    const title = kind === 'audio' ? '选择参考音频' : kind === 'video' ? '选择原始视频' : '选择 qwen_tts 引擎';
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters, title });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('dialog:choose-output', async (_event, defaultName: string, format: AudioFormat = 'wav') => {
    const labels: Record<AudioFormat, string> = { wav: 'WAV 无损音频', flac: 'FLAC 无损音频', mp3: 'MP3 音频', opus: 'Ogg Opus 音频', m4a: 'M4A / AAC 音频' };
    const result = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: labels[format], extensions: [format === 'opus' ? 'ogg' : format] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('composition:create-draft', async (_event, request: unknown) => {
    const plan = planDraft(request);
    await editPlans.save(plan);
    return plan;
  });
  ipcMain.handle('engine:synthesize', (event, request: SynthesisRequest) => {
    const jobId = randomUUID(); const engine = configuredEngine(); jobs.set(jobId, engine);
    void engine.synthesize(request, progress => event.sender.send('engine:progress', { ...progress, jobId }))
      .catch(error => event.sender.send('engine:progress', { jobId, phase: 'error', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => jobs.delete(jobId));
    return { jobId };
  });
  ipcMain.handle('engine:cancel', (_event, jobId: string) => { jobs.get(jobId)?.cancel(); jobs.delete(jobId); });
  ipcMain.handle('shell:reveal', (_event, target: string) => shell.showItemInFolder(path.resolve(target)));
  ipcMain.handle('shell:open', async (_event, target: string) => { await shell.openPath(path.resolve(target)); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

if (!cliMode) app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
