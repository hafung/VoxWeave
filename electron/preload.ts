import { contextBridge, ipcRenderer } from 'electron';
import type { CompositionProgressEvent, ProgressEvent, SynthesisRequest, VoxWeaveApi } from '../shared/types.js';

const api: VoxWeaveApi = {
  getStatus: () => ipcRenderer.invoke('engine:status'),
  configure: config => ipcRenderer.invoke('engine:configure', config),
  chooseFile: kind => ipcRenderer.invoke('dialog:choose-file', kind),
  chooseOutput: (defaultName, format) => ipcRenderer.invoke('dialog:choose-output', defaultName, format),
  createDraftPlan: request => ipcRenderer.invoke('composition:create-draft', request),
  generateComposition: request => ipcRenderer.invoke('composition:generate', request),
  cancelComposition: jobId => ipcRenderer.invoke('composition:cancel', jobId),
  resumeLastProject: () => ipcRenderer.invoke('composition:resume-last'),
  replaceScene: (projectId, sceneId) => ipcRenderer.invoke('composition:replace-scene', projectId, sceneId),
  importAssets: () => ipcRenderer.invoke('library:import'),
  listAssets: () => ipcRenderer.invoke('library:list'),
  synthesize: request => ipcRenderer.invoke('engine:synthesize', request),
  cancel: jobId => ipcRenderer.invoke('engine:cancel', jobId),
  reveal: path => ipcRenderer.invoke('shell:reveal', path),
  openPath: path => ipcRenderer.invoke('shell:open', path),
  onProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ProgressEvent & { jobId: string }) => listener(payload);
    ipcRenderer.on('engine:progress', handler);
    return () => ipcRenderer.removeListener('engine:progress', handler);
  },
  onCompositionProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CompositionProgressEvent) => listener(payload);
    ipcRenderer.on('composition:progress', handler);
    return () => ipcRenderer.removeListener('composition:progress', handler);
  }
};

contextBridge.exposeInMainWorld('voxweave', api);
