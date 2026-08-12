fn main() {
    tauri_build::build();

    // Tauri's Windows resources contain the Common Controls v6 activation
    // manifest. `tauri-build` links them into application binaries, but Cargo
    // integration-test executables are separate PE files and need the same
    // manifest when they link Tauri's Windows UI code. This is test-only: the
    // production binary continues to use tauri-build's normal `-arg-bins` path.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let resource = std::path::PathBuf::from(
            std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR"),
        )
        .join("resource.lib");
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
