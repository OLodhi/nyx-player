// swift-tools-version:5.9
// iOS side of the nyx-android plugin. The library product carries the crate's name: the plugin's
// build script (tauri-plugin, `.ios_path("ios")`) links it under that name. `.tauri/tauri-api` is
// written by that build script. `NyxPolicies` holds the plugin's pure rules, tested on their own.
//
// libmpv comes from MPVKit 1.0.0, LGPL product only, never the GPL one. swift-rs builds this
// package with `swift build` and links only its own library, so the plugin's build.rs links
// MPVKit's archives itself, and NyxMpvLinks asks for the system frameworks they need.
import PackageDescription

let package = Package(
    name: "tauri-plugin-nyx-android",
    platforms: [
        .iOS(.v15),
        // SwiftPM compares every platform: MPVKit declares macOS 12, and an unlisted one defaults to 10.13
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
        .package(path: "NyxPolicies"),
        .package(url: "https://github.com/mpvkit/MPVKit.git", exact: "1.0.0"),
    ],
    targets: [
        .target(
            name: "NyxIosPlugin",
            dependencies: [
                .byName(name: "Tauri"),
                .product(name: "NyxPolicies", package: "NyxPolicies"),
                .product(name: "MPVKit", package: "MPVKit"),
                "NyxMpvLinks",
            ],
            path: "Sources/NyxIosPlugin"),
        // System frameworks and libraries MPVKit's archives need (see its module.modulemap)
        .systemLibrary(
            name: "NyxMpvLinks",
            path: "Sources/NyxMpvLinks"),
    ]
)
