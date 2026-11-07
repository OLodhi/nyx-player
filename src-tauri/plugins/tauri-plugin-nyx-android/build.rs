// Commands are implemented natively: Kotlin on Android (android/), Swift on iOS (ios/).
// JS invokes are routed to the native plugin.
// This list exists so tauri-plugin generates one ACL permission per command.
const COMMANDS: &[&str] = &[
    "play",
    "stop",
    "set_paused",
    "seek",
    "set_volume",
    "set_muted",
    "set_speed",
    "select_track",
    "set_resize_mode",
    "set_video_margins",
    "set_subtitle_scale",
    "set_fullscreen",
    "get_property",
    "network_status",
    "device_info",
    "secure_get",
    "secure_set",
    "secure_delete",
    "update_info",
    "fetch_update_manifest",
    "request_install_permission",
    "download_update",
    "install_update",
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
    // libmpv (MPVKit) for the iOS player; see link_mpvkit
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        link_mpvkit();
    }
}

/// MPVKit 1.0.0's LGPL binary targets (the `MPVKit` product: `_MPVKit` + `_FFmpeg`, iOS).
/// Explicit on purpose: SwiftPM also downloads the `-GPL` xcframeworks and `Libsmbclient`, which
/// must never be linked.
const MPVKIT_LGPL: &[&str] = &[
    "Libmpv",
    "Libuchardet",
    "Libbluray",
    "Libavcodec",
    "Libavdevice",
    "Libavfilter",
    "Libavformat",
    "Libavutil",
    "Libswresample",
    "Libswscale",
    "Libssl",
    "Libcrypto",
    "Libass",
    "Libfreetype",
    "Libfribidi",
    "Libharfbuzz",
    "MoltenVK",
    "Libshaderc_combined",
    "lcms2",
    "Libplacebo",
    "Libdovi",
    "Libunibreak",
    "gmp",
    "nettle",
    "hogweed",
    "gnutls",
    "Libdav1d",
    "Libuavs3d",
];

/// swift-rs only links the Swift package's own static library (`swift build` stops
/// before SwiftPM's product link), so MPVKit's prebuilt archives never reach the linker. Copy the
/// iOS slice of each into OUT_DIR and link it statically: rustc bundles it into the rlib, so both
/// the cdylib link (cargo) and the app link (Xcode, through libapp.a) see it.
fn link_mpvkit() {
    use std::{env, fs, io::Read, path::PathBuf, process::Command};

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let target = env::var("TARGET").unwrap_or_default();
    let simulator = target.ends_with("-sim") || target.starts_with("x86_64");
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64".to_string(),
        other => other.to_string(),
    };

    let mut xcframeworks = Vec::new();
    find_xcframeworks(&out_dir.join("swift-rs"), &mut xcframeworks);
    let lib_dir = out_dir.join("mpvkit-libs");
    fs::create_dir_all(&lib_dir).unwrap();
    println!("cargo:rustc-link-search=native={}", lib_dir.display());

    let magic = |path: &PathBuf| -> [u8; 8] {
        let mut buf = [0u8; 8];
        let _ = fs::File::open(path).and_then(|mut f| f.read_exact(&mut buf));
        buf
    };

    for name in MPVKIT_LGPL {
        let xcf = xcframeworks
            .iter()
            .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(*name))
            .unwrap_or_else(|| {
                panic!(
                    "MPVKit: {name}.xcframework not found under {}",
                    out_dir.display()
                )
            });
        let slice = fs::read_dir(xcf)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| {
                let n = p.file_name().unwrap().to_string_lossy().into_owned();
                n.starts_with("ios-")
                    && !n.contains("maccatalyst")
                    && n.ends_with("-simulator") == simulator
            })
            .unwrap_or_else(|| {
                panic!(
                    "MPVKit: no iOS slice (simulator: {simulator}) in {}",
                    xcf.display()
                )
            });
        let binary = slice_binary(&slice)
            .unwrap_or_else(|| panic!("MPVKit: no binary in {}", slice.display()));

        // Prefixed: swift-rs's search path (searched first) holds SwiftPM's own copies of
        // library-style binaries, from the macOS slice (e.g. a universal libMoltenVK.a).
        let dest = lib_dir.join(format!("libnyxmpv_{name}.a"));
        if magic(&binary)[..4] == [0xca, 0xfe, 0xba, 0xbe] {
            // Universal file (the Simulator slice is arm64 + x86_64): keep the target's architecture.
            let ok = Command::new("lipo")
                .arg(&binary)
                .args(["-thin", &arch, "-output"])
                .arg(&dest)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            assert!(
                ok,
                "MPVKit: lipo -thin {arch} failed for {}",
                binary.display()
            );
        } else {
            fs::copy(&binary, &dest).unwrap();
        }

        let slice_name = slice.file_name().unwrap().to_string_lossy().into_owned();
        if &magic(&dest) == b"!<arch>\n" {
            println!("cargo:rustc-link-lib=static=nyxmpv_{name}");
        } else {
            let _ = fs::remove_file(&dest);
            println!("cargo:rustc-link-search=framework={}", slice.display());
            println!("cargo:rustc-link-lib=framework={name}");
            println!(
                "cargo:warning=MPVKit: {name}: NOT a static archive ({slice_name}), linked as a framework, needs embedding"
            );
        }
    }
}

fn find_xcframeworks(dir: &std::path::Path, found: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for path in entries.filter_map(Result::ok).map(|e| e.path()) {
        if !path.is_dir() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("xcframework") {
            found.push(path);
        } else {
            find_xcframeworks(&path, found);
        }
    }
}

/// `<slice>/<Name>.framework/<Name>` (framework-style) or `<slice>/lib*.a` (library-style).
fn slice_binary(slice: &std::path::Path) -> Option<std::path::PathBuf> {
    for path in std::fs::read_dir(slice)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
    {
        match path.extension().and_then(|e| e.to_str()) {
            Some("framework") => {
                let stem = path.file_stem()?.to_owned();
                return Some(path.join(stem));
            }
            Some("a") => return Some(path),
            _ => {}
        }
    }
    None
}
