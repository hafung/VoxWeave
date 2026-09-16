import '@hyperframes/player';
import type { HyperframesPlayer } from '@hyperframes/player';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AudioLines, Check, ChevronDown, Film, FolderOpen, Image, Library,
  Play, Plus, RefreshCw, Settings2, Sparkles, Square, Upload, Video, WandSparkles, X
} from 'lucide-react';
import { estimateDuration } from '../shared/markup';
import type { EditPlan } from '../shared/edit-plan';
import type { MediaAsset } from '../shared/library';
import type { CompositionProgressEvent, EngineStatus, GenerateCompositionRequest } from '../shared/types';

const api = () => window.voxweave;
const voices = [
  { id: 'vivian', name: 'Vivian', note: '中文女声 · 清晰自然' },
  { id: 'serena', name: 'Serena', note: '中文女声 · 沉稳温暖' },
  { id: 'ryan', name: 'Ryan', note: '英文男声 · 叙事感' }
];
const stages: Array<{ phase: CompositionProgressEvent['phase']; label: string }> = [
  { phase: 'drafting', label: '分镜' }, { phase: 'narrating', label: '旁白' },
  { phase: 'resolving', label: '时间轴' }, { phase: 'aligning', label: '字幕' },
  { phase: 'selecting', label: '素材' }, { phase: 'compiling', label: '预览' }
];

type Preview = NonNullable<CompositionProgressEvent['preview']>;

export function App() {
  const [script, setScript] = useState('产品很好，却一直卖不出去？问题也许不在产品，而在表达。让声织帮你把文案、旁白和画面，自动编成一条完整视频。');
  const [voiceId, setVoiceId] = useState('vivian');
  const [aspectRatio, setAspectRatio] = useState<NonNullable<GenerateCompositionRequest['aspectRatio']>>('9:16');
  const [captionStyle, setCaptionStyle] = useState<NonNullable<GenerateCompositionRequest['captionStyle']>>('commerce-bold');
  const [sourceVideoPath, setSourceVideoPath] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<EngineStatus>({ state: 'missing', backend: 'none', message: '正在检测本地引擎…' });
  const [enginePath, setEnginePath] = useState('');
  const [modelDir, setModelDir] = useState('');
  const [jobId, setJobId] = useState<string>();
  const jobRef = useRef<string | undefined>(undefined);
  const [projectId, setProjectId] = useState<string>();
  const [progress, setProgress] = useState<CompositionProgressEvent>();
  const [plan, setPlan] = useState<EditPlan>();
  const [preview, setPreview] = useState<Preview>();
  const [previewError, setPreviewError] = useState<string>();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [replacingScene, setReplacingScene] = useState<string>();
  const playerRef = useRef<HyperframesPlayer>(null);

  useEffect(() => {
    const desktop = api();
    if (!desktop) return;
    let receivedCompositionProgress = false;
    void desktop.getStatus().then(result => {
      setStatus(result); setEnginePath(result.enginePath ?? ''); setModelDir(result.modelDir ?? '');
    });
    void desktop.listAssets().then(setAssets);
    void desktop.resumeLastProject().then(last => {
      if (!last || receivedCompositionProgress) return;
      setPlan(last.plan); setProjectId(last.plan.id); setScript(last.plan.input.script);
      setSourceVideoPath(last.plan.input.sourceVideoPath); setVoiceId(last.plan.narration.voiceId);
      if (last.preview) setPreview(last.preview);
    }).catch(() => undefined);
    return desktop.onCompositionProgress(event => {
      receivedCompositionProgress = true;
      if (jobRef.current && event.jobId !== jobRef.current) return;
      setProgress(event);
      if (event.plan) setPlan(event.plan);
      if (event.preview) { setPreview(event.preview); setPreviewError(undefined); }
      if (event.phase === 'complete' || event.phase === 'error' || event.phase === 'cancelled') {
        jobRef.current = undefined; setJobId(undefined);
      }
    });
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const ready = () => setPreviewError(undefined);
    const failed = (event: Event) => setPreviewError((event as CustomEvent<{ message?: string }>).detail?.message ?? '预览加载失败');
    player.addEventListener('ready', ready); player.addEventListener('error', failed);
    return () => { player.removeEventListener('ready', ready); player.removeEventListener('error', failed); };
  }, [preview?.entryUrl]);

  const estimatedSeconds = useMemo(() => estimateDuration(script), [script]);
  const working = Boolean(jobId);
  const activeStage = stages.findIndex(stage => stage.phase === progress?.phase);

  async function generate() {
    const desktop = api();
    if (!desktop) {
      setProgress({ jobId: 'browser', phase: 'error', progress: 0, message: '请在 VoxWeave 桌面应用中运行。', recoverable: true });
      return;
    }
    if (status.state === 'missing') { setSettingsOpen(true); return; }
    setPreviewError(undefined); setPreview(undefined); setPlan(undefined);
    setProgress({ jobId: 'pending', phase: 'drafting', progress: 0.01, message: '正在创建本地工程…' });
    try {
      const result = await desktop.generateComposition({ script, voiceId, aspectRatio, captionStyle, sourceVideoPath, language: voiceId === 'ryan' ? 'English' : 'Chinese', precision: 'int8' });
      jobRef.current = result.jobId; setJobId(result.jobId); setProjectId(result.projectId);
    } catch (error) {
      setProgress({ jobId: 'failed', phase: 'error', progress: 0, message: error instanceof Error ? error.message : String(error), recoverable: true });
    }
  }

  async function chooseSource() {
    const selected = await api()?.chooseFile('video');
    if (selected) setSourceVideoPath(selected);
  }

  async function importAssets() {
    const imported = await api()?.importAssets();
    if (imported?.length) setAssets(await api()!.listAssets());
  }

  async function replaceScene(sceneId: string) {
    if (!projectId) return;
    setReplacingScene(sceneId);
    try {
      const result = await api()?.replaceScene(projectId, sceneId);
      if (result) { setPlan(result.plan); setPreview(result.preview); setPreviewError(undefined); }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally { setReplacingScene(undefined); }
  }

  async function configure() {
    const next = await api()?.configure({ enginePath, modelDir });
    if (next) { setStatus(next); if (next.state === 'idle') setSettingsOpen(false); }
  }

  return <div className="app-shell">
    <header className="topbar drag-region">
      <div className="brand no-drag"><span className="brand-mark"><AudioLines size={19}/></span><strong>声织</strong><small>VOXWEAVE</small></div>
      <div className="top-actions no-drag">
        <button className="library-button" aria-label={`素材库，${assets.length} 个素材`} onClick={importAssets}><Library size={16}/> <em>素材库</em> <span>{assets.length}</span></button>
        <button className={`engine-pill ${status.state}`} onClick={() => setSettingsOpen(true)}><i/>{status.state === 'idle' ? '本地引擎就绪' : '配置引擎'}</button>
        <button className="icon-button" aria-label="打开引擎设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18}/></button>
      </div>
    </header>

    <main className="creator-layout">
      <section className="create-pane" aria-labelledby="create-title">
        <div className="pane-heading"><span>AUTO COMPOSITION</span><h1 id="create-title">一段文案，自动成为一条片。</h1><p>旁白是真实时钟。字幕、画面和素材会跟着声音重新排好。</p></div>

        <label className="script-field">
          <span>视频文案</span>
          <textarea value={script} maxLength={8000} onChange={event => setScript(event.target.value)} placeholder="输入推广文案或观点内容…" disabled={working}/>
          <small><b>约 {estimatedSeconds || '—'} 秒</b>{script.length.toLocaleString()} / 8,000</small>
        </label>

        <div className="source-card">
          <div className="source-copy"><span className="source-icon"><Video size={18}/></span><div><b>原始视频</b><small>可选；不添加也能用素材与动效完成视频</small></div></div>
          {sourceVideoPath ? <div className="source-selected"><span title={sourceVideoPath}>{sourceVideoPath.split(/[\\/]/u).at(-1)}</span><button aria-label="移除原始视频" onClick={() => setSourceVideoPath(undefined)} disabled={working}><X size={15}/></button></div>
            : <button className="secondary-button" onClick={chooseSource} disabled={working}><Upload size={15}/> 添加视频</button>}
        </div>

        <button className="more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><Settings2 size={15}/> 更多设置 <ChevronDown size={15}/></button>
        {moreOpen && <div className="settings-grid">
          <label><span>音色</span><select value={voiceId} onChange={event => setVoiceId(event.target.value)}>{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.note}</option>)}</select></label>
          <label><span>画幅</span><select value={aspectRatio} onChange={event => setAspectRatio(event.target.value as typeof aspectRatio)}><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
          <label><span>字幕风格</span><select value={captionStyle} onChange={event => setCaptionStyle(event.target.value as typeof captionStyle)}><option value="commerce-bold">电商强调</option><option value="opinion-clean">观点口播</option><option value="brand-minimal">品牌极简</option><option value="info-card">信息卡片</option></select></label>
        </div>}

        {progress && <div className={`job-status ${progress.phase}`} role="status" aria-live="polite">
          <div className="status-line"><span className="status-symbol">{working ? <Activity size={18}/> : progress.phase === 'complete' ? <Check size={18}/> : progress.phase === 'error' ? <X size={18}/> : <Sparkles size={18}/>}</span><div><b>{progress.message}</b><small>{Math.round(progress.progress * 100)}% · 工程会随阶段自动保存</small></div></div>
          <div className="progress-track"><span style={{ width: `${Math.max(2, progress.progress * 100)}%` }}/></div>
          <ol className="stage-list">{stages.map((stage, index) => <li key={stage.phase} className={index < activeStage || progress.phase === 'complete' ? 'done' : index === activeStage ? 'active' : ''}>{stage.label}</li>)}</ol>
        </div>}

        <div className="primary-row">
          {working && <button className="cancel-button" onClick={() => jobId && api()?.cancelComposition(jobId)}><Square size={14} fill="currentColor"/> 取消</button>}
          <button className="generate-button" disabled={working || !script.trim()} onClick={generate}><WandSparkles size={18}/>{working ? '正在自动成片…' : progress?.phase === 'error' || progress?.phase === 'cancelled' ? '重新生成' : '生成视频'}</button>
        </div>
      </section>

      <section className="preview-pane" aria-labelledby="preview-title">
        <div className="preview-heading"><div><span>PREVIEW</span><h2 id="preview-title">成片预览</h2></div>{plan && <span className="revision">R{plan.revision} · {plan.scenes.length} 个分镜</span>}</div>
        <div className={`preview-stage ${preview ? 'ready' : ''}`} style={preview ? { aspectRatio: `${preview.width}/${preview.height}` } : undefined}>
          {preview ? <hyperframes-player key={preview.entryUrl} ref={playerRef} src={preview.entryUrl} width={preview.width} height={preview.height} controls/>
            : <div className="empty-preview"><span><Film size={29}/></span><h3>{working ? '正在编织画面' : '等待第一条成片'}</h3><p>{working ? '旁白生成后，画面与字幕会出现在这里。' : '输入文案即可开始；原始视频不是必填项。'}</p></div>}
        </div>
        {previewError && <div className="preview-error" role="alert"><span>{previewError}</span><button onClick={() => setPreview(value => value ? { ...value, entryUrl: `${value.entryUrl}?retry=${Date.now()}` } : value)}><RefreshCw size={14}/> 重试加载</button></div>}

        {plan && <div className="storyboard" aria-label="分镜列表">
          <div className="storyboard-title"><span>分镜卡片</span><small>不满意时只换当前画面</small></div>
          <div className="scene-list">{plan.scenes.map((scene, index) => <article key={scene.id} className="scene-card">
            <span className="scene-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="scene-type">{scene.visual.type === 'kinetic-text' ? <Sparkles size={14}/> : scene.visual.type === 'image' ? <Image size={14}/> : <Video size={14}/>}</span>
            <div><b>{scene.script}</b><small>{(scene.startMs / 1000).toFixed(1)}–{(scene.endMs / 1000).toFixed(1)}s · {scene.visual.type}</small></div>
            <button onClick={() => replaceScene(scene.id)} disabled={Boolean(replacingScene)}>{replacingScene === scene.id ? <Activity size={14}/> : <RefreshCw size={14}/>} 换画面</button>
          </article>)}</div>
        </div>}
      </section>
    </main>

    {settingsOpen && <Modal title="本地引擎设置" subtitle="自动成片的旁白由 Qwen3-TTS 在本机生成" close={() => setSettingsOpen(false)}>
      <div className="settings-form"><PathField label="引擎路径" value={enginePath} placeholder="qwen_tts.exe 或 WSL 可执行文件" choose={async () => { const selected = await api()?.chooseFile('engine'); if (selected) setEnginePath(selected); }}/><PathField label="0.6B 模型目录" value={modelDir} placeholder="qwen3-tts-0.6b-base" choose={async () => { const selected = await api()?.chooseFile('model'); if (selected) setModelDir(selected); }}/>
        <div className={`engine-summary ${status.state}`}><i/><span><b>{status.message}</b><small>文本与媒体只在本机处理。</small></span></div><button className="modal-primary" onClick={configure}>保存并检测</button></div>
    </Modal>}
  </div>;
}

function PathField({ label, value, placeholder, choose }: { label: string; value: string; placeholder: string; choose: () => void }) {
  return <label className="path-field"><span>{label}</span><div><input readOnly value={value} placeholder={placeholder}/><button onClick={choose}><FolderOpen size={15}/> 浏览</button></div></label>;
}

function Modal({ title, subtitle, close, children }: { title: string; subtitle: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭" onClick={close}><X size={18}/></button></header>{children}</section></div>;
}
