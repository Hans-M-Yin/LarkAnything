// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LarkAnything",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "LarkAnything", targets: ["LarkAnything"])],
    targets: [.executableTarget(name: "LarkAnything")]
)
