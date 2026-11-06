// swift-tools-version:5.9
// iOS side of the nyx-android plugin. The library product carries the crate's name: the plugin's
// build script (tauri-plugin, `.ios_path("ios")`) links it under that name. `.tauri/tauri-api` is
// written by that build script.
import PackageDescription

let package = Package(
    name: "tauri-plugin-nyx-android",
    platforms: [
        .iOS(.v15),
        // SPIKE S1: SwiftPM checks every platform; MPVKit declares macOS 12, and an unlisted one defaults to 10.13.
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "tauri-plugin-nyx-android",
            type: .static,
            targets: ["NyxIosPlugin"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        // SPIKE S1 (never merged): MPVKit, LGPL product only (not MPVKit-GPL).
        .package(url: "https://github.com/mpvkit/MPVKit.git", exact: "1.0.0"),
    ],
    targets: [
        .target(
            name: "NyxIosPlugin",
            dependencies: [
                .byName(name: "Tauri"),
                .product(name: "MPVKit", package: "MPVKit"),
                "NyxMpvLinks",
            ],
            path: "Sources/NyxIosPlugin"),
        // SPIKE S1: system frameworks and libraries MPVKit needs (see its module.modulemap).
        .systemLibrary(
            name: "NyxMpvLinks",
            path: "Sources/NyxMpvLinks"),
    ]
)
