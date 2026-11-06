fn main() {
    // Recompile native resources when branding changes, including incremental builds.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
