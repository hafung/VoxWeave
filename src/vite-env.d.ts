/// <reference types="vite/client" />
import type { VoxWeaveApi } from '../shared/types';
declare global { interface Window { voxweave?: VoxWeaveApi } }
export {};
