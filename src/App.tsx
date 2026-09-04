import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AudioLines, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Download, FolderOpen, Gauge, Mic2, Pause, Play, Plus, Radio, Settings2, Sparkles, Square, Upload, WandSparkles, X, Zap } from 'lucide-react';
import { estimateDuration } from '../shared/markup';
import { AUDIO_FORMATS, LANGUAGES, type AudioFormat, type EngineStatus, type Language, type ProgressEvent, type SynthesisRequest, type VoiceProfile } from '../shared/types';

const PRESET_VOICES: VoiceProfile[] = [
  { id: 'vivian', name: 'Vivian', kind: 'preset', language: 'Chinese' },
  { id: 'serena', name: 'Serena', kind: 'preset', language: 'Chinese' },
  { id: 'ryan', name: 'Ryan', kind: 'preset', language: 'English' },
  { id: 'ono_anna', name: '小野安娜', kind: 'preset', language: 'Japanese' }
];

const api = () => window.voxweave;

export function App() {
  const [text, setText] = useState('欢迎来到声织。这里，每一个停顿都有分量，[pause:500ms] 每一种声音，都值得被认真表达。');
  const [voice, setVoice] = useState<VoiceProfile>(PRESET_VOICES[0]);
  const [language, setLanguage] = useState<Language>('Chinese');
  const [temperature, setTemperature] = useState(0.5);
  const [precision, setPrecision] = useState<SynthesisRequest['precision']>('int8');
  const [outputFormat, setOutputFormat] = useState<AudioFormat>('wav');
  const [referenceAudio, setReferenceAudio] = useState<string>();
  const [referenceText, setReferenceText] = useState('');
  const [progress, setProgress] = useState<ProgressEvent>();
  const [jobId, setJobId] = useState<string>();
  const [outputPath, setOutputPath] = useState<string>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [status, setStatus] = useState<EngineStatus>({ state: 'missing', backend: 'none', message: '正在检测引擎…' });
  const [enginePath, setEnginePath] = useState('');
  const [modelDir, setModelDir] = useState('');
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api()?.getStatus().then(result => { setStatus(result); setEnginePath(result.enginePath ?? ''); setModelDir(result.modelDir ?? ''); });
    return api()?.onProgress(event => {
      if (!jobId || event.jobId === jobId) {
        setProgress(event);
        if (event.outputPath) setOutputPath(event.outputPath);
        if (event.phase === 'complete' || event.phase === 'error') setJobId(undefined);
      }
    });
  }, [jobId]);

  const duration = useMemo(() => estimateDuration(text), [text]);
  const working = !!jobId;
  const insert = (value: string) => {
    const field = editorRef.current;
    if (!field) return setText(current => current + value);
    const start = field.selectionStart; const end = field.selectionEnd;
    setText(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + value.length, start + value.length); });
  };

  async function generate() {
    if (!api()) { setProgress({ phase: 'error', message: '请在 VoxWeave 桌面应用中运行，而不是浏览器预览。' }); return; }
    if (status.state === 'missing') { setSettingsOpen(true); return; }
    const extension = outputFormat === 'opus' ? 'ogg' : outputFormat;
    const target = await api()!.chooseOutput(`voxweave-${Date.now()}.${extension}`, outputFormat);
    if (!target) return;
    setOutputPath(undefined); setProgress({ phase: 'preparing', progress: 0, message: '任务已加入本地队列…' });
    const result = await api()!.synthesize({ text, outputPath: target, outputFormat, language, speaker: voice.kind === 'preset' ? voice.id : undefined,
      voicePath: voice.kind === 'clone' ? voice.path : undefined, referenceAudio, referenceText: referenceText || undefined,
      temperature, topK: 50, topP: 1, threads: 4, precision });
    setJobId(result.jobId);
  }

  async function configure() {
    const next = await api()?.configure({ enginePath, modelDir });
    if (next) { setStatus(next); if (next.state === 'idle') setSettingsOpen(false); }
  }

  return <div className="app-shell">
    <header className="topbar drag-region" style={{ paddingRight: 166, gridTemplateColumns: '300px 1fr minmax(250px, 360px)' }}>
      <div className="brand no-drag"><div className="brand-mark"><AudioLines size={20}/></div><span>声织</span><b>VoxWeave</b></div>
      <nav className="workspace-tabs no-drag"><button className="active">创作台</button><button>音色库</button><button>历史记录</button></nav>
      <div className="top-actions no-drag">
        <button className="quiet-button" onClick={() => setHelpOpen(true)}><CircleHelp size={17}/> 使用指南</button>
        <button className={`status-pill ${status.state}`} onClick={() => setSettingsOpen(true)}><i/>{status.state === 'idle' ? '本地引擎就绪' : '配置引擎'}</button>
        <button className="icon-button" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18}/></button>
      </div>
    </header>

    <main className="workspace">
      <aside className="voice-panel">
        <div className="section-heading"><div><span className="eyebrow">VOICE LIBRARY</span><h2>选择音色</h2></div><button className="icon-button small" onClick={() => setCloneOpen(true)}><Plus size={17}/></button></div>
        <button className="clone-callout" onClick={() => setCloneOpen(true)}><span className="clone-icon"><Mic2 size={19}/></span><span><b>克隆新音色</b><small>3–15 秒清晰人声即可</small></span><Sparkles size={17}/></button>
        <div className="voice-list">
          {PRESET_VOICES.map((item, index) => <button key={item.id} className={`voice-item ${voice.id === item.id ? 'selected' : ''}`} onClick={() => { setVoice(item); setLanguage(item.language ?? 'Auto'); }}>
            <span className={`avatar tone-${index + 1}`}>{item.name.slice(0, 1)}</span><span className="voice-meta"><b>{item.name}</b><small>{item.language} · 内置音色</small></span>
            <span className="mini-play"><Play size={13} fill="currentColor"/></span>{voice.id === item.id && <Check className="selected-check" size={14}/>}</button>)}
        </div>
        <div className="local-note"><Radio size={15}/><span><b>完全本地运行</b><small>音频与文本不会离开你的设备</small></span></div>
      </aside>

      <section className="studio">
        <div className="studio-head"><div><span className="eyebrow">NEW COMPOSITION</span><h1>让文字，拥有自己的声音。</h1></div><div className="estimate"><Clock3 size={15}/><span>预计音频 <b>{duration || '—'} 秒</b></span></div></div>
        <div className="editor-card">
          <div className="editor-toolbar">
            <div className="format-actions"><button onClick={() => insert('[pause:500ms]')}><Pause size={14}/> 停顿 <ChevronDown size={13}/></button><button onClick={() => insert('[laugh]')}><Sparkles size={14}/> 表演标签</button></div>
            <div className="counter">{text.length.toLocaleString()} / 8,000</div>
          </div>
          <textarea ref={editorRef} value={text} maxLength={8000} onChange={e => setText(e.target.value)} spellCheck={false} placeholder="输入想要说的话…" />
          <div className="editor-tip"><WandSparkles size={15}/><span>试试加入 <code>[pause:800ms]</code>、<code>[laugh]</code> 或 <code>[sigh]</code>，让表达更自然。</span><button onClick={() => setHelpOpen(true)}>查看技巧</button></div>
        </div>

        <div className="controls-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <div className="control-card"><label>输出格式</label><div className="select-wrap"><select value={outputFormat} onChange={e => setOutputFormat(e.target.value as AudioFormat)}>{AUDIO_FORMATS.map(item => <option key={item} value={item}>{item === 'opus' ? 'OGG / OPUS' : item.toUpperCase()}</option>)}</select><ChevronDown size={15}/></div><small>{outputFormat === 'wav' || outputFormat === 'flac' ? '无损，适合后期制作' : '高质量压缩，适合分发'}</small></div>
          <div className="control-card"><label>语言</label><div className="select-wrap"><select value={language} onChange={e => setLanguage(e.target.value as Language)}>{LANGUAGES.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={15}/></div><small>自动模式会依据文本判断</small></div>
          <div className="control-card"><label>表现力 <span>{temperature.toFixed(2)}</span></label><input type="range" min="0.1" max="1.2" step="0.05" value={temperature} onChange={e => setTemperature(Number(e.target.value))}/><div className="range-ends"><span>稳定</span><span>灵动</span></div></div>
          <div className="control-card"><label>推理精度</label><div className="segmented">{(['bf16','int8','int4'] as const).map(item => <button key={item} className={precision === item ? 'active' : ''} onClick={() => setPrecision(item)}>{item.toUpperCase()}</button>)}</div><small>{precision === 'int8' ? '速度与质量的最佳平衡' : precision === 'int4' ? '适合内存带宽受限的 x86 CPU' : '最高精度，占用更多内存'}</small></div>
        </div>

        {referenceAudio && <div className="reference-strip"><Mic2 size={17}/><span><b>即时克隆</b><small>{referenceAudio}</small></span><button onClick={() => setReferenceAudio(undefined)}><X size={16}/></button></div>}

        <div className={`result-dock ${progress ? 'visible' : ''}`}>
          <div className="wave-orb">{working ? <Activity size={21}/> : progress?.phase === 'complete' ? <Check size={21}/> : <AudioLines size={21}/>}</div>
          <div className="result-info"><b>{progress?.message ?? '准备就绪'}</b><div className="progress-track"><span style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}/></div></div>
          {working ? <button className="cancel-button" onClick={() => jobId && api()?.cancel(jobId)}><Square size={13} fill="currentColor"/> 停止</button> : outputPath ? <><button className="play-button" onClick={() => api()?.openPath(outputPath)}><Play size={15} fill="currentColor"/> 播放</button><button className="icon-button" onClick={() => api()?.reveal(outputPath)}><FolderOpen size={17}/></button></> : null}
        </div>

        <button className="generate-button" disabled={working || !text.trim()} onClick={generate}><Zap size={19} fill="currentColor"/>{working ? '正在编织声音…' : '生成声音'}<span>Ctrl ↵</span></button>
      </section>
    </main>

    {helpOpen && <HelpModal close={() => setHelpOpen(false)} insert={value => { insert(value); setHelpOpen(false); }}/>} 
    {settingsOpen && <Modal title="引擎设置" subtitle="连接 Qwen3-TTS 纯 C 推理后端" close={() => setSettingsOpen(false)}>
      <div className="settings-form"><PathField label="引擎路径" value={enginePath} placeholder="qwen_tts.exe 或 WSL 路径" choose={async () => { const value = await api()?.chooseFile('engine'); if (value) setEnginePath(value); }}/><PathField label="0.6B 模型目录" value={modelDir} placeholder="qwen3-tts-0.6b-base" choose={async () => { const value = await api()?.chooseFile('model'); if (value) setModelDir(value); }}/>
      <div className="engine-summary"><Gauge size={18}/><span><b>{status.message}</b><small>默认使用 INT8 + 4 线程；引擎会在独立进程中运行。</small></span></div><button className="primary-action" onClick={configure}>保存并检测</button></div>
    </Modal>}
    {cloneOpen && <Modal title="克隆你的音色" subtitle="推荐 3–15 秒、无噪声、单人说话的 PCM WAV" close={() => setCloneOpen(false)}>
      <div className="clone-form"><button className="drop-zone" onClick={async () => { const value = await api()?.chooseFile('audio'); if (value) setReferenceAudio(value); }}><Upload size={25}/><b>{referenceAudio ? '已选择参考音频' : '选择参考 WAV'}</b><small>{referenceAudio ?? '单击浏览文件 · 建议 24 kHz 单声道'}</small></button><label>参考音频原文（可选）</label><textarea value={referenceText} onChange={e => setReferenceText(e.target.value)} placeholder="准确填写原文通常能获得更稳定的音色复刻。"/><button className="primary-action" disabled={!referenceAudio} onClick={() => { setVoice({ id: 'instant-clone', name: '即时克隆', kind: 'clone' }); setCloneOpen(false); }}>用于本次创作</button></div>
    </Modal>}
  </div>;
}

function PathField({label,value,placeholder,choose}:{label:string;value:string;placeholder:string;choose:()=>void}) { return <label className="path-field"><span>{label}</span><div><input readOnly value={value} placeholder={placeholder}/><button onClick={choose}><FolderOpen size={16}/> 浏览</button></div></label>; }

function Modal({ title, subtitle, close, children }: { title: string; subtitle: string; close: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}><div className="modal"><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={close}><X size={18}/></button></div>{children}</div></div>; }

function HelpModal({ close, insert }: { close: () => void; insert: (value: string) => void }) { return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}><div className="modal help-modal"><div className="modal-head"><div><span className="eyebrow">VOICE DIRECTION</span><h2>像导演一样控制声音</h2><p>少量、明确的标记通常比堆叠指令更自然。</p></div><button className="icon-button" onClick={close}><X size={18}/></button></div><div className="help-grid">
    <section><div className="help-icon amber"><Pause size={19}/></div><h3>精确停顿</h3><p>声织会真正插入静音，不依赖模型猜测标点。</p><button onClick={() => insert('[pause:500ms]')}><code>[pause:500ms]</code><Plus size={14}/></button><button onClick={() => insert('<break time="1s"/>')}><code>&lt;break time="1s"/&gt;</code><Plus size={14}/></button></section>
    <section><div className="help-icon rose"><Sparkles size={19}/></div><h3>表演动作</h3><p>纯 C 引擎目前实验性支持笑声与叹息。</p><button onClick={() => insert('[laugh]')}><code>[laugh]</code><Plus size={14}/></button><button onClick={() => insert('[sigh]')}><code>[sigh]</code><Plus size={14}/></button></section>
    <section><div className="help-icon mint"><BookOpen size={19}/></div><h3>标点与节奏</h3><p>逗号适合短换气，句号用于完整收束；长句可拆为两段。</p><div className="example-copy">“慢一点，听见了吗？<br/>现在，我们重新开始。”</div></section>
    <section><div className="help-icon blue"><WandSparkles size={19}/></div><h3>推荐写法</h3><p>标签紧邻要修饰的句子，连续标签不要超过两个。</p><div className="example-copy"><em>推荐</em> [sigh] 好吧，[pause:400ms] 我答应你。</div></section>
  </div><div className="help-footer"><span><CircleHelp size={15}/> 停顿标记由声织处理；表演标签由模型解释，效果会随音色和随机种子变化。</span><button className="primary-action compact" onClick={close}>明白了</button></div></div></div>; }
