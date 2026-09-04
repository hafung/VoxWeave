/*
 * qwen_tts_thread.h - Cross-OS parallel-for abstraction (PLAN 21.2)
 *
 * One API, three backends, all using a PERSISTENT pool (workers are spawned
 * once and parked — never spawn-per-matvec; the CP does ~80 matvecs/frame ×
 * 16 passes, so per-call thread creation would dominate):
 *   - macOS  -> GCD dispatch_apply (the measured-fast path; keep it here only)
 *   - POSIX  -> pthread persistent pool (Linux / WSL / *BSD). Without this,
 *               decode is single-threaded off macOS (~3-4x slower).
 *   - Win32  -> Windows threads + condition variables (native; MSYS/MinGW
 *               with pthreads falls through to the POSIX path instead).
 *
 * qwen_parallel(nt, fn, ctx) mirrors dispatch_apply exactly: it invokes
 * fn(tid, nt, ctx) for tid in [0, nt) and blocks until all have returned.
 * Chunk indices are claimed via an atomic counter, so work is balanced even
 * if the runners are not perfectly even. nt <= 1 runs inline on the caller.
 */
#ifndef QWEN_TTS_THREAD_H
#define QWEN_TTS_THREAD_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Per-chunk task. Handles chunk `tid` out of `nt` total. The kernel call sites
 * derive their row range from tid/nt exactly as the old GCD blocks did. */
typedef void (*qwen_task_fn)(size_t tid, size_t nt, void *ctx);

/* Run fn(0..nt-1) across the pool / GCD, blocking until all chunks finish. */
void qwen_parallel(size_t nt, qwen_task_fn fn, void *ctx);

/* (Re)size the persistent worker pool to back `n_threads` total runners
 * (main thread participates, so the pool holds n_threads-1 workers). No-op on
 * the GCD backend. Idempotent; safe to call again to resize. Call after the
 * thread count is known (qwen_init_threads / qwen_set_threads do this). */
void qwen_threadpool_start(int n_threads);

/* Tear down the pool (joins workers). Optional — process exit also reclaims. */
void qwen_threadpool_stop(void);

/* 1 if qwen_parallel may be called CONCURRENTLY from multiple application
 * threads (e.g. several server workers each running a synthesis), 0 otherwise.
 *   GCD: 1  — dispatch_apply has no shared global state; concurrent callers are fine.
 *   pthread/Win32: 0 — the persistent pool has a single global job slot
 *                      (P.job/P.completed/P.generation); two simultaneous
 *                      submitters would corrupt completion accounting.
 * The concurrent server uses this to decide whether to serialize synthesis. */
int qwen_parallel_is_reentrant(void);

#ifdef __cplusplus
}
#endif

#endif /* QWEN_TTS_THREAD_H */
