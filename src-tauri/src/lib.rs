mod database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:achievement-nexus.db", database::migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running Achievement Nexus");
}
