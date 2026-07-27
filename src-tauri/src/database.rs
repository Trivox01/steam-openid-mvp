use rusqlite::{params, Connection, OptionalExtension};
use std::{fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

struct Migration {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

fn migrations() -> [Migration; 3] {
    [
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/001_initial.sql"),
        },
        Migration {
            version: 2,
            description: "persistence_schema",
            sql: include_str!("../migrations/002_persistence_schema.sql"),
        },
        Migration {
            version: 3,
            description: "steam_account",
            sql: include_str!("../migrations/003_steam_account.sql"),
        },
    ]
}

pub struct DatabaseState(pub Mutex<Connection>);

pub fn open_database(app: &AppHandle) -> Result<DatabaseState, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Unable to resolve application data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to prepare application data directory: {error}"))?;

    let database_path = directory.join("achievement-nexus.db");
    eprintln!("[database] path={}", database_path.display());

    let mut connection = Connection::open(&database_path)
        .map_err(|error| format!("Unable to open local database: {error}"))?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|error| format!("Unable to configure local database: {error}"))?;

    run_migrations(&mut connection, &database_path)?;
    Ok(DatabaseState(Mutex::new(connection)))
}

fn run_migrations(connection: &mut Connection, database_path: &Path) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS _achievement_nexus_migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .map_err(|error| format!("Unable to initialize migration tracking: {error}"))?;

    bootstrap_migration_history(connection)?;

    for migration in migrations() {
        let applied = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _achievement_nexus_migrations WHERE version = ?1)",
                [migration.version],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("Unable to read migration state: {error}"))?;
        if applied {
            continue;
        }

        eprintln!(
            "[database] applying migration={} path={}",
            migration.version,
            database_path.display()
        );
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to start migration {}: {error}", migration.version))?;
        transaction
            .execute_batch(migration.sql)
            .map_err(|error| format!("Unable to apply migration {}: {error}", migration.version))?;
        transaction
            .execute(
                "INSERT INTO _achievement_nexus_migrations(version, description) VALUES(?1, ?2)",
                params![migration.version, migration.description],
            )
            .map_err(|error| format!("Unable to record migration {}: {error}", migration.version))?;
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit migration {}: {error}", migration.version))?;
        eprintln!("[database] applied migration={}", migration.version);
    }

    Ok(())
}

fn bootstrap_migration_history(connection: &Connection) -> Result<(), String> {
    let tracked_count = connection
        .query_row(
            "SELECT COUNT(*) FROM _achievement_nexus_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Unable to inspect migration history: {error}"))?;
    if tracked_count > 0 {
        return Ok(());
    }

    let games_exists = table_exists(connection, "games")?;
    if !games_exists {
        return Ok(());
    }

    let columns = table_columns(connection, "games")?;
    if columns.iter().any(|column| column == "platform_id") {
        record_existing_migration(connection, 1, "create_initial_tables")?;
        record_existing_migration(connection, 2, "persistence_schema")?;
        if table_exists(connection, "steam_profile")? {
            record_existing_migration(connection, 3, "steam_account")?;
        }
    } else if columns.iter().any(|column| column == "app_id") {
        record_existing_migration(connection, 1, "create_initial_tables")?;
    }

    Ok(())
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |_| Ok(true),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| format!("Unable to inspect local database schema: {error}"))
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Unable to inspect table schema: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to read table schema: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode table schema: {error}"))
}

fn record_existing_migration(
    connection: &Connection,
    version: i64,
    description: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO _achievement_nexus_migrations(version, description) VALUES(?1, ?2)",
            params![version, description],
        )
        .map(|_| ())
        .map_err(|error| format!("Unable to record existing migration {version}: {error}"))
}
