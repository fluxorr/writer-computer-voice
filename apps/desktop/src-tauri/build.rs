// Build script: run Tauri's codegen, and on macOS compile the native Apple
// Speech-to-Text bridge (Objective-C) and link the frameworks it uses. The
// bridge backs the `apple-native` dictation engine; on other platforms it is
// skipped.
fn main() {
    #[cfg(target_os = "macos")]
    {
        let mut build = cc::Build::new();
        // Compile as Objective-C with Automatic Reference Counting.
        build.file("src/apple_speech.m");
        build.flag("-fobjc-arc");
        build.flag("-fobjc-exceptions");
        // Framework callback blocks legitimately ignore some of their arguments.
        build.flag("-Wno-unused-parameter");
        build.compile("apple_speech");

        // Link the system frameworks the bridge uses.
        for fw in [
            "Speech",
            "AVFoundation",
            "CoreAudio",
            "AudioToolbox",
            "CoreFoundation",
            "Foundation",
        ] {
            println!("cargo:rustc-link-lib=framework={fw}");
        }
        println!("cargo:rerun-if-changed=src/apple_speech.m");
        println!("cargo:rerun-if-changed=src/apple_speech.h");

        // Embed Info.plist directly into the executable's `__TEXT,__info_plist`
        // section. The bundled `.app` reads its plist from the bundle, but an
        // *unbundled* dev binary (`tauri dev`) has none — so macOS TCC would
        // hard-kill it the moment the Apple engine touches speech recognition or
        // the mic (missing NS*UsageDescription). Embedding the section gives the
        // dev binary the same usage descriptions, so Apple dictation works under
        // `vp dev` too. Harmless for bundled builds (the bundle plist still wins).
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!(
            "cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__info_plist,{manifest_dir}/Info.plist"
        );
        println!("cargo:rerun-if-changed=Info.plist");
    }

    tauri_build::build();
}
