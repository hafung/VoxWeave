#include "qwen_tts_server.h"
#include <stdio.h>

static int unsupported(void) {
    fprintf(stderr, "The embedded HTTP server is not included in the Windows desktop build.\n");
    return -1;
}

int qwen_tts_serve(qwen_tts_ctx_t *ctx, int port) {
    (void)ctx; (void)port; return unsupported();
}
int qwen_tts_serve_ex(qwen_tts_ctx_t *ctx, int port, int n_workers) {
    (void)ctx; (void)port; (void)n_workers; return unsupported();
}
int qwen_tts_serve_batched(qwen_tts_ctx_t *ctx, int port, int max_batch) {
    (void)ctx; (void)port; (void)max_batch; return unsupported();
}
