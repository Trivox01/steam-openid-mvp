//! Proves that every Tauri plugin the desktop app depends on is actually handed to
//! the builder. A `Cargo.toml` dependency plus ACL permissions is not enough: a
//! plugin that is never registered has no managed state and no IPC commands, so
//! `check()` fails at runtime.
//!
//! `mock_context` always supplies an empty `plugins` map, so these tests load the
//! real `tauri.conf.json` plugin section into the mock context. That way the suite
//! also fails if the committed configuration stops deserializing into the shape the
//! updater plugin requires, which is exactly what `.build()` does in production.

use achievement_nexus_lib::register_plugins;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const TAURI_CONFIG: &str = include_str!("../tauri.conf.json");

fn context() -> tauri::Context<MockRuntime> {
    let config: serde_json::Value =
        serde_json::from_str(TAURI_CONFIG).expect("tauri.conf.json must be valid JSON");
    let plugins = config
        .get("plugins")
        .and_then(serde_json::Value::as_object)
        .expect("tauri.conf.json must declare a plugins object")
        .clone();

    let mut context = mock_context(noop_assets());
    for (name, value) in plugins {
        context.config_mut().plugins.0.insert(name, value);
    }

    context
}

fn app() -> tauri::App<MockRuntime> {
    register_plugins(mock_builder())
        .build(context())
        .expect("every registered plugin must initialize with the shipped configuration")
}

#[test]
fn updater_plugin_is_registered_in_the_builder() {
    let app = app();

    // `updater()` reads plugin-managed state, so it fails outright when the plugin was
    // never registered. Endpoints and the public key are injected at release time
    // rather than committed, so `EmptyEndpoints` is the expected result of a correctly
    // registered plugin in this environment — anything else is a wiring defect.
    match app.updater() {
        Ok(_) => {}
        Err(tauri_plugin_updater::Error::EmptyEndpoints) => {}
        Err(error) => panic!("updater plugin is registered but unusable: {error}"),
    }
}

#[test]
fn negative_control_detects_a_missing_updater_registration() {
    let app_without_updater = mock_builder()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .build(context())
        .expect("negative-control app should build without the updater plugin");

    let missing_state = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = app_without_updater.updater();
    }));
    assert!(
        missing_state.is_err(),
        "the control must fail when updater-managed state is absent"
    );
}

#[test]
fn updater_builder_accepts_a_release_style_endpoint() {
    let app = app();

    // Mirrors what `scripts/release/create-updater-config.mjs` injects, without
    // touching that script or the signing architecture: once an endpoint exists the
    // builder must produce a usable updater, proving `check()` cannot fail because the
    // plugin is unavailable.
    app.updater_builder()
        .endpoints(vec!["https://example.invalid/releases/beta/latest.json"
            .parse()
            .expect("endpoint url")])
        .expect("endpoints must be accepted")
        .build()
        .expect("updater must build once an endpoint is configured");
}

#[test]
fn opener_and_notification_plugins_stay_registered() {
    // These back `open_external_tool_url` and the desktop notifications; both read
    // plugin-managed state and panic when the plugin is missing from the builder.
    let app = app();
    let _ = app.opener();
    let _ = app.notification();
}
