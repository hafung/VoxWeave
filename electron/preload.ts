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
  searchAssets: (query, type) => ipcRenderer.invoke('library:search', query, type),
  updateAssetTags: (ids, tags, mode) => ipcRenderer.invoke('library:tags', { ids, tags, mode }),
  autoTagAssets: ids => ipcRenderer.invoke('library:auto-tags', ids),
  removeAssets: ids => ipcRenderer.invoke('library:remove', ids),
  pexelsStatus: () => ipcRenderer.invoke('pexels:status'),
  configurePexels: key => ipcRenderer.invoke('pexels:configure', key),
  searchPexels: request => ipcRenderer.invoke('pexels:search', request),
  downloadPexels: id => ipcRenderer.invoke('pexels:download', id),
  openSource: url => ipcRenderer.invoke('library:open-source', url),
  updateBgm: (projectId, bgm) => ipcRenderer.invoke('composition:bgm', projectId, bgm),
  exportVideo: projectId => ipcRenderer.invoke('composition:export', projectId),
  cancelExport: jobId => ipcRenderer.invoke('composition:cancel-export', jobId),
  onExportProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, payload: import('../shared/types.js').ExportProgress) => listener(payload);
    ipcRenderer.on('composition:export-progress', handler);
    return () => ipcRenderer.removeListener('composition:export-progress', handler);
  },
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
