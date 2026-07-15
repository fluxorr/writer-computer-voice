// Native Apple Speech-to-Text bridge.
//
// Uses SFSpeechRecognizer (on-device) fed by an AVAudioEngine input tap,
// resampled to 16 kHz mono. The full running transcript streams as partials so
// the caller can render a live overlay; the complete transcript is committed as
// a single final when dictation stops. Intermediate SFSpeech "isFinal" segments
// are accumulated into a committed prefix rather than emitted, so the caller
// never double-inserts text. All callbacks are marshalled to Rust via the C
// function pointers supplied to apple_speech_start.
#import "apple_speech.h"
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <math.h>

typedef struct {
    void* user_ctx;
    apple_speech_text_cb on_partial;
    apple_speech_text_cb on_final;
    apple_speech_text_cb on_error;
    apple_speech_level_cb on_level;
} AppleSpeechContext;

static AVAudioEngine* g_engine = nil;
static SFSpeechAudioBufferRecognitionRequest* g_request = nil;
static SFSpeechRecognitionTask* g_task = nil;
static AppleSpeechContext g_ctx;
static BOOL g_active = NO;
// Text from SFSpeech segments already marked final, joined with spaces. The
// live transcript is this prefix plus the current segment's formattedString.
static NSMutableString* g_committed = nil;
// The current (not-yet-final) segment's formatted string.
static NSString* g_current = nil;

static NSString* apple_running_transcript(void) {
    NSString* committed = g_committed ?: @"";
    NSString* current = g_current ?: @"";
    if (committed.length == 0) return current;
    if (current.length == 0) return committed;
    return [NSString stringWithFormat:@"%@ %@", committed, current];
}

// Requesting a TCC-protected capability without the matching usage-description
// key in the running binary's Info.plist makes macOS hard-kill the process
// (SIGABRT via __TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__) — uncatchable from
// Rust. This happens for the unbundled dev binary, which carries no Info.plist.
// Detect the missing keys up front and fail softly instead of crashing.
static const char* apple_speech_missing_usage_key(void) {
    NSBundle* bundle = [NSBundle mainBundle];
    if ([bundle objectForInfoDictionaryKey:@"NSSpeechRecognitionUsageDescription"] == nil) {
        return "NSSpeechRecognitionUsageDescription is missing from the app's Info.plist "
               "(Apple dictation only works in a bundled build)";
    }
    if ([bundle objectForInfoDictionaryKey:@"NSMicrophoneUsageDescription"] == nil) {
        return "NSMicrophoneUsageDescription is missing from the app's Info.plist "
               "(Apple dictation only works in a bundled build)";
    }
    return NULL;
}

void apple_speech_request_authorization(void* ctx, apple_speech_auth_cb on_result) {
    const char* missing = apple_speech_missing_usage_key();
    if (missing != NULL) {
        on_result(ctx, 0, missing);
        return;
    }
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        int granted = (status == SFSpeechRecognizerAuthorizationStatusAuthorized) ? 1 : 0;
        const char* err = "";
        switch (status) {
            case SFSpeechRecognizerAuthorizationStatusDenied:
                err = "speech recognition permission denied";
                break;
            case SFSpeechRecognizerAuthorizationStatusRestricted:
                err = "speech recognition is restricted on this device";
                break;
            default:
                break;
        }
        on_result(ctx, granted, err);
    }];
}

void* apple_speech_start(void* ctx,
                         apple_speech_text_cb on_partial,
                         apple_speech_text_cb on_final,
                         apple_speech_text_cb on_error,
                         apple_speech_level_cb on_level) {
    if (g_active) {
        if (on_error) on_error(ctx, "dictation already active");
        return NULL;
    }
    const char* missing = apple_speech_missing_usage_key();
    if (missing != NULL) {
        if (on_error) on_error(ctx, missing);
        return NULL;
    }
    g_ctx.user_ctx = ctx;
    g_ctx.on_partial = on_partial;
    g_ctx.on_final = on_final;
    g_ctx.on_error = on_error;
    g_ctx.on_level = on_level;
    g_committed = [NSMutableString string];
    g_current = @"";

    NSLocale* locale = [NSLocale localeWithLocaleIdentifier:@"en-US"];
    SFSpeechRecognizer* recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    if (recognizer == nil || !recognizer.isAvailable) {
        if (on_error) on_error(ctx, "speech recognizer unavailable");
        return NULL;
    }
    // Keep recognition fully on-device (no network), matching the app's
    // local-first design.
    if (@available(macOS 10.15, *)) {
        if (!recognizer.supportsOnDeviceRecognition) {
            if (on_error) on_error(ctx, "on-device speech recognition not supported for this locale");
            return NULL;
        }
    }

    g_request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
    g_request.shouldReportPartialResults = YES;
    if (@available(macOS 10.15, *)) {
        g_request.requiresOnDeviceRecognition = YES;
    }

    g_engine = [[AVAudioEngine alloc] init];
    AVAudioInputNode* inputNode = g_engine.inputNode;
    AVAudioFormat* inputFormat = [inputNode outputFormatForBus:0];

    AVAudioFormat* targetFormat =
        [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32
                                          sampleRate:16000.0
                                            channels:1
                                         interleaved:NO];
    AVAudioConverter* converter = [[AVAudioConverter alloc] initFromFormat:inputFormat
                                                                   toFormat:targetFormat];

    [inputNode installTapOnBus:0
                     bufferSize:4096
                         format:inputFormat
                          block:^(AVAudioPCMBuffer* _Nonnull buffer, AVAudioTime* _Nonnull when) {
        if (!g_active) return;
        AVAudioFrameCount outCap =
            (AVAudioFrameCount)((double)buffer.frameLength * (16000.0 / inputFormat.sampleRate)) + 32;
        AVAudioPCMBuffer* converted = [[AVAudioPCMBuffer alloc] initWithPCMFormat:targetFormat
                                                                   frameCapacity:outCap];
        __block BOOL consumed = NO;
        AVAudioConverterOutputStatus status =
            [converter convertToBuffer:converted
                                 error:nil
                    withInputFromBlock:^AVAudioBuffer* _Nullable(
                        AVAudioPacketCount inNumberOfPackets,
                        AVAudioConverterInputStatus* _Nonnull inputStatus) {
                if (consumed) {
                    *inputStatus = AVAudioConverterInputStatus_NoDataNow;
                    return nil;
                }
                consumed = YES;
                *inputStatus = AVAudioConverterInputStatus_HaveData;
                return buffer;
            }];
        if (status == AVAudioConverterOutputStatus_HaveData && converted.frameLength > 0) {
            float* data = converted.floatChannelData[0];
            UInt32 frames = converted.frameLength;
            float sum = 0;
            for (UInt32 i = 0; i < frames; i++) {
                float s = data[i];
                sum += s * s;
            }
            float rms = frames > 0 ? sqrtf(sum / (float)frames) : 0.0f;
            if (g_ctx.on_level) g_ctx.on_level(g_ctx.user_ctx, rms);
            [g_request appendAudioPCMBuffer:converted];
        }
    }];

    NSError* startErr = nil;
    if (![g_engine startAndReturnError:&startErr]) {
        NSString* msg = startErr ? [startErr localizedDescription] : @"audio engine failed to start";
        if (g_ctx.on_error) g_ctx.on_error(g_ctx.user_ctx, [msg UTF8String]);
        g_engine = nil;
        g_request = nil;
        return NULL;
    }

    g_task = [recognizer recognitionTaskWithRequest:g_request
                                      resultHandler:^(SFSpeechRecognitionResult* _Nullable result,
                                                      NSError* _Nullable error) {
        if (!g_active) return;
        if (error != nil) {
            // A cancel during stop surfaces as an error; ignore once inactive.
            if (g_active && g_ctx.on_error) {
                g_ctx.on_error(g_ctx.user_ctx, [[error localizedDescription] UTF8String]);
            }
            return;
        }
        if (result == nil) return;

        NSString* segment = result.bestTranscription.formattedString ?: @"";
        g_current = segment;
        // Emit the full running transcript (committed prefix + live segment) as a
        // partial so the overlay always shows everything captured so far.
        NSString* running = apple_running_transcript();
        if (g_ctx.on_partial && running.length > 0) {
            g_ctx.on_partial(g_ctx.user_ctx, [running UTF8String]);
        }
        // A finalized segment folds into the committed prefix; the next segment
        // starts fresh. We do NOT emit a final here — stop commits once.
        if (result.isFinal && segment.length > 0) {
            if (g_committed.length > 0) {
                [g_committed appendString:@" "];
            }
            [g_committed appendString:segment];
            g_current = @"";
        }
    }];

    g_active = YES;
    return &g_ctx;
}

void apple_speech_stop(void* handle) {
    if (!g_active) return;
    g_active = NO;

    // Commit the whole running transcript as a single final so stopping never
    // drops or duplicates text.
    NSString* running = apple_running_transcript();
    if (running.length > 0 && g_ctx.on_final) {
        g_ctx.on_final(g_ctx.user_ctx, [running UTF8String]);
    }

    if (g_task != nil) {
        [g_task cancel];
        g_task = nil;
    }
    if (g_request != nil) {
        [g_request endAudio];
        g_request = nil;
    }
    if (g_engine != nil) {
        [g_engine stop];
        [g_engine.inputNode removeTapOnBus:0];
        g_engine = nil;
    }
    g_committed = nil;
    g_current = nil;
}

void apple_speech_abort(void) {
    if (!g_active) return;
    g_active = NO;
    if (g_task != nil) {
        [g_task cancel];
        g_task = nil;
    }
    if (g_request != nil) {
        [g_request endAudio];
        g_request = nil;
    }
    if (g_engine != nil) {
        [g_engine stop];
        [g_engine.inputNode removeTapOnBus:0];
        g_engine = nil;
    }
    g_committed = nil;
    g_current = nil;
}
