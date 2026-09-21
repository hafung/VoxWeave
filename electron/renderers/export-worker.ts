// A separate Node process keeps producer work and its binary configuration out of Electron's UI process.
import { createRenderJob, executeRenderJob, DEFAULT_CONFIG } from '@hyperframes/producer';

const controller = new AbortController();
process.on('message', (message: { cancel?: boolean }) => { if (message.cancel) controller.abort(); });
process.on('disconnect', () => controller.abort());
const [workspace, output, chromePath] = process.argv.slice(2);
try {
  const job = createRenderJob({ fps: 30, quality: 'standard', format: 'mp4', workers: 1,
    hdrMode: 'force-sdr', strictness: 'strict',
    producerConfig: { ...DEFAULT_CONFIG, chromePath, enableBrowserPool: false,
      concurrency: 1, disableGpu: true, browserGpuMode: 'software', forceScreenshot: true, useDrawElement: false }
  });
  await executeRenderJob(job, workspace, output, (state, message) => {
    process.send?.({ progress: state.progress, message, status: state.status });
  }, controller.signal);
  process.send?.({ done: true });
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  process.disconnect?.();
}
