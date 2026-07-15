// C interface to the native Apple Speech-to-Text engine (SFSpeechRecognizer +
// AVAudioEngine). Intended to be called from Rust; the callbacks marshal text
// and audio level back across the FFI boundary.
#ifndef APPLE_SPEECH_H
#define APPLE_SPEECH_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Text callback: `ctx` is the opaque pointer passed to apple_speech_start.
// `text` is a UTF-8 C string owned by the bridge (copy it if you need to keep it).
typedef void (*apple_speech_text_cb)(void* ctx, const char* text);
// Level callback: `level` is RMS amplitude in roughly 0..1.
typedef void (*apple_speech_level_cb)(void* ctx, float level);

// Request speech-recognition authorization. `on_result` is called with the
// opaque `ctx`, `granted` (1/0), and an error string (may be empty). The
// callback may fire on an arbitrary queue.
typedef void (*apple_speech_auth_cb)(void* ctx, int granted, const char* error);
void apple_speech_request_authorization(void* ctx, apple_speech_auth_cb on_result);

// Begin a dictation session. Returns an opaque handle (non-NULL on success) that
// must be passed to apple_speech_stop. The callbacks may fire from audio/recognition
// queues until stop is called.
void* apple_speech_start(void* ctx,
                         apple_speech_text_cb on_partial,
                         apple_speech_text_cb on_final,
                         apple_speech_text_cb on_error,
                         apple_speech_level_cb on_level);

// End the session, stop capture, and emit any buffered final text.
void apple_speech_stop(void* handle);

// Tear down capture immediately WITHOUT emitting a final. Safe to call from
// inside the recognition result handler (used on the error path).
void apple_speech_abort(void);

#ifdef __cplusplus
}
#endif

#endif // APPLE_SPEECH_H
