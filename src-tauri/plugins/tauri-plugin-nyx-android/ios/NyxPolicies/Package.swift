// swift-tools-version:5.9
// Pure rules of the iOS plugin: no Tauri, UIKit or system calls, so `swift test` runs them on any
// Mac or macOS CI runner. The plugin package (../Package.swift) depends on it by path.
// Only iOS is declared, like the plugin package: SwiftPM compares every platform between the two.
import PackageDescription

let package = Package(
    name: "NyxPolicies",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(name: "NyxPolicies", targets: ["NyxPolicies"]),
    ],
    targets: [
        .target(name: "NyxPolicies"),
        .testTarget(name: "NyxPoliciesTests", dependencies: ["NyxPolicies"]),
    ]
)
