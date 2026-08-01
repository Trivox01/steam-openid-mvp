use rusqlite::{params, Connection, OptionalExtension};
use std::{fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

struct Migration {
    version: i64,
    description: &'static str,
    action: MigrationAction,
}

enum MigrationAction {
    Sql(&'static str),
    RepairAchievementSyncSchema(&'static str),
}

const REQUIRED_GAME_ACHIEVEMENT_COLUMNS: [&str; 3] = [
    "achievements_synced_at",
    "achievements_sync_status",
    "achievements_sync_error",
];

fn migrations() -> [Migration; 8] {
    [
        Migration {
            version: 1,
            description: "create_initial_tables",
            action: MigrationAction::Sql(include_str!("../migrations/001_initial.sql")),
        },
        Migration {
            version: 2,
            description: "persistence_schema",
            action: MigrationAction::Sql(include_str!("../migrations/002_persistence_schema.sql")),
        },
        Migration {
            version: 3,
            description: "steam_account",
            action: MigrationAction::Sql(include_str!("../migrations/003_steam_account.sql")),
        },
        Migration {
            version: 4,
            description: "steam_library_sync",
            action: MigrationAction::Sql(include_str!("../migrations/004_steam_library_sync.sql")),
        },
        Migration {
            version: 5,
            description: "steam_achievements_sync",
            action: MigrationAction::RepairAchievementSyncSchema(include_str!("../migrations/005_steam_achievements_sync.sql")),
        },
        Migration {
            version: 6,
            description: "repair_steam_achievements_sync_schema",
            action: MigrationAction::RepairAchievementSyncSchema(include_str!("../migrations/006_repair_steam_achievements_sync.sql")),
        },
        Migration {
            version: 7,
            description: "remove_legacy_steam_credentials",
            action: MigrationAction::Sql(include_str!("../migrations/007_remove_legacy_steam_credentials.sql")),
        },
        Migration {
            version: 8,
            description: "normalize_steam_artwork_urls",
            action: MigrationAction::Sql(include_str!("../migrations/008_normalize_steam_artwork_urls.sql")),
        },
    ]
}

pub struct DatabaseState(pub Mutex<Connection>);

#[cfg(test)]
const CONFIRMED_MOCK_GAME_NAMES: [&str; 6] = [
    "Aetherfall",
    "Emberwild",
    "Iron Hollow",
    "Neon Circuit",
    "Silent Meridian",
    "Starbound Echoes",
];

#[cfg(test)]
fn cleanup_confirmed_mock_games(connection: &mut Connection) -> Result<usize, String> {
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| "Unable to enable relational integrity for mock cleanup.".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|_| "Unable to start mock cleanup transaction.".to_string())?;
    let removed = transaction
        .execute(
            "DELETE FROM games
             WHERE platform_game_id LIKE 'mock-%'
               AND (synced_at IS NULL OR TRIM(synced_at) = '')
               AND platform_game_id NOT GLOB '[0-9]*'
               AND name IN (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                CONFIRMED_MOCK_GAME_NAMES[0],
                CONFIRMED_MOCK_GAME_NAMES[1],
                CONFIRMED_MOCK_GAME_NAMES[2],
                CONFIRMED_MOCK_GAME_NAMES[3],
                CONFIRMED_MOCK_GAME_NAMES[4],
                CONFIRMED_MOCK_GAME_NAMES[5],
            ],
        )
        .map_err(|_| "Unable to remove confirmed mock records.".to_string())?;
    transaction
        .commit()
        .map_err(|_| "Unable to commit mock cleanup transaction.".to_string())?;
    Ok(removed)
}

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

        eprintln!("[database] applying migration={} name={} path={}", migration.version, migration.description, database_path.display());
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to start migration {}: {error}", migration.version))?;
        if let Err(error) = apply_migration(&transaction, &migration.action) {
            eprintln!("[database] migration failed version={} name={} error={}", migration.version, migration.description, error);
            return Err(format!("Local storage migration {} ({}) failed", migration.version, migration.description));
        }
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

    verify_achievement_sync_schema(connection)
}

fn apply_migration(
    connection: &Connection,
    action: &MigrationAction,
) -> Result<(), rusqlite::Error> {
    match action {
        MigrationAction::Sql(sql) => connection.execute_batch(sql),
        MigrationAction::RepairAchievementSyncSchema(_definition) => repair_achievement_sync_schema(connection),
    }
}

fn repair_achievement_sync_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    add_column_if_missing(connection, "achievements", "locked_icon_url", "TEXT NOT NULL DEFAULT ''")?;
    add_column_if_missing(connection, "achievements", "source", "TEXT NOT NULL DEFAULT 'local'")?;
    add_column_if_missing(connection, "achievements", "global_unlock_percent", "REAL CHECK (global_unlock_percent IS NULL OR global_unlock_percent BETWEEN 0 AND 100)")?;
    add_column_if_missing(connection, "achievements", "synced_at", "TEXT")?;
    add_column_if_missing(connection, "achievements", "unlock_state_known", "INTEGER NOT NULL DEFAULT 1 CHECK (unlock_state_known IN (0, 1))")?;
    add_column_if_missing(connection, "games", "achievements_synced_at", "TEXT")?;
    add_column_if_missing(connection, "games", "achievements_sync_status", "TEXT NOT NULL DEFAULT 'idle' CHECK (achievements_sync_status IN ('idle', 'success', 'partial', 'unsupported', 'error'))")?;
    add_column_if_missing(connection, "games", "achievements_sync_error", "TEXT")?;
    connection.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_game_source_external
           ON achievements(game_id, source, platform_achievement_id);
         CREATE INDEX IF NOT EXISTS idx_achievements_source_synced
           ON achievements(source, synced_at);",
    )
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), rusqlite::Error> {
    let columns = table_columns_sqlite(connection, table)?;
    if columns.iter().any(|existing| existing == column) {
        return Ok(());
    }
    connection.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))
}

fn verify_achievement_sync_schema(connection: &Connection) -> Result<(), String> {
    let columns = table_columns(connection, "games")?;
    let missing = REQUIRED_GAME_ACHIEVEMENT_COLUMNS
        .iter()
        .filter(|required| !columns.iter().any(|column| column == **required))
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!("Local storage schema verification failed after migration 006; missing columns: {}", missing.join(", ")))
    }
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
    table_columns_sqlite(connection, table)
        .map_err(|error| format!("Unable to inspect table schema: {error}"))
}

fn table_columns_sqlite(
    connection: &Connection,
    table: &str,
) -> Result<Vec<String>, rusqlite::Error> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))?;
    rows.collect::<Result<Vec<_>, _>>()
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

#[cfg(test)]
mod tests {
    use super::{apply_migration, cleanup_confirmed_mock_games, migrations, run_migrations, table_columns};
    use rusqlite::{params, Connection};
    use std::path::Path;

    #[test]
    fn fresh_database_receives_achievement_sync_schema() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        run_migrations(&mut connection, Path::new("test.db")).expect("migrations should apply");
        assert_achievement_sync_schema(&connection);
        let version: i64 = connection.query_row(
            "SELECT MAX(version) FROM _achievement_nexus_migrations", [], |row| row.get(0)
        ).expect("migration version should exist");
        assert_eq!(version, 8);
        assert!(!super::table_exists(&connection, "steam_profile").expect("schema should load"));
    }

    #[test]
    fn legacy_database_before_005_is_upgraded_without_data_loss() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        apply_through_four(&connection);
        insert_existing_game(&connection);
        run_migrations(&mut connection, Path::new("legacy.db")).expect("legacy migration should apply");
        assert_achievement_sync_schema(&connection);
        let name: String = connection.query_row(
            "SELECT name FROM games WHERE id='existing-game'", [], |row| row.get(0)
        ).expect("existing game should survive");
        assert_eq!(name, "Existing Game");
        assert_game_query_succeeds(&connection);
    }

    #[test]
    fn partially_applied_005_is_repaired_when_marked_applied() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        apply_through_four(&connection);
        connection.execute_batch(
            "ALTER TABLE games ADD COLUMN achievements_synced_at TEXT;
             ALTER TABLE achievements ADD COLUMN locked_icon_url TEXT NOT NULL DEFAULT '';
             INSERT INTO _achievement_nexus_migrations(version,description)
             VALUES(5,'steam_achievements_sync');"
        ).expect("partial legacy state should be created");
        run_migrations(&mut connection, Path::new("partial.db")).expect("repair migration should apply");
        assert_achievement_sync_schema(&connection);
        assert_game_query_succeeds(&connection);
    }

    #[test]
    fn repair_is_idempotent_and_supports_sync_writes() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        apply_through_four(&connection);
        insert_existing_game(&connection);
        run_migrations(&mut connection, Path::new("complete.db")).expect("first repair should apply");
        run_migrations(&mut connection, Path::new("complete.db")).expect("second repair should be safe");
        assert_achievement_sync_schema(&connection);
        connection.execute(
            "UPDATE games SET achievements_synced_at=?1,achievements_sync_status='success',achievements_sync_error=NULL WHERE id='existing-game'",
            ["2026-07-27T00:00:00Z"],
        ).expect("library achievement metadata should update");
        connection.execute(
            "INSERT INTO achievements(
               id,game_id,platform_achievement_id,name,description,icon_url,is_unlocked,is_hidden,
               rarity_percentage,locked_icon_url,source,global_unlock_percent,synced_at,unlock_state_known
             ) VALUES(?1,?2,?3,?4,'','',1,0,5.0,'','steam',5.0,?5,1)",
            params!["achievement-1", "existing-game", "ACH_ONE", "Achievement One", "2026-07-27T00:00:00Z"],
        ).expect("achievement sync write should succeed");
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM achievements WHERE source='steam'", [], |row| row.get(0)
        ).expect("synced achievement should be queryable");
        assert_eq!(count, 1);
    }

    #[test]
    fn artwork_migration_normalizes_legacy_hosts_without_losing_game_data() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection.execute_batch(
            "CREATE TABLE _achievement_nexus_migrations(
               version INTEGER PRIMARY KEY,
               description TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );"
        ).unwrap();
        for migration in migrations().iter().take(7) {
            apply_migration(&connection, &migration.action).unwrap();
            connection.execute(
                "INSERT INTO _achievement_nexus_migrations(version,description) VALUES(?1,?2)",
                params![migration.version, migration.description],
            ).unwrap();
        }
        connection.execute(
            "INSERT INTO games(id,platform_id,platform_game_id,name,cover_url,background_url,favorite)
             VALUES('bf6','steam','2807960','Battlefield 6',?1,?2,1)",
            params![
                "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2807960/library_600x900_2x.jpg",
                "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2807960/library_hero.jpg"
            ],
        ).unwrap();
        run_migrations(&mut connection, Path::new("artwork.db")).unwrap();
        let row: (String, String, String, i64) = connection.query_row(
            "SELECT name,cover_url,background_url,favorite FROM games WHERE id='bf6'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(row.0, "Battlefield 6");
        assert!(row.1.starts_with("https://shared.steamstatic.com/"));
        assert!(row.2.starts_with("https://shared.steamstatic.com/"));
        assert_eq!(row.3, 1);
    }

    #[test]
    fn mock_cleanup_removes_only_confirmed_mock_records() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        run_migrations(&mut connection, Path::new("cleanup.db")).expect("migrations should apply");
        connection.execute_batch(
            "INSERT INTO games(id,platform_id,platform_game_id,name,synced_at)
             VALUES
               ('mock-one','steam','mock-1086940','Aetherfall',NULL),
               ('numeric','steam','1086940','Aetherfall','2026-07-28T00:00:00Z'),
               ('similar','steam','mock-other','Real User Game',NULL),
               ('synced-mock','steam','mock-7734210','Emberwild','2026-07-28T00:00:00Z');"
        ).expect("fixtures should insert");
        let removed = cleanup_confirmed_mock_games(&mut connection).expect("cleanup should succeed");
        assert_eq!(removed, 1);
        let remaining: Vec<String> = {
            let mut statement = connection.prepare("SELECT id FROM games ORDER BY id").unwrap();
            statement.query_map([], |row| row.get(0)).unwrap()
                .collect::<Result<Vec<_>, _>>().unwrap()
        };
        assert_eq!(remaining, vec!["numeric", "similar", "synced-mock"]);
    }

    #[test]
    fn mock_cleanup_rolls_back_if_delete_fails() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        run_migrations(&mut connection, Path::new("rollback.db")).expect("migrations should apply");
        connection.execute(
            "INSERT INTO games(id,platform_id,platform_game_id,name)
             VALUES('mock-one','steam','mock-1086940','Aetherfall')",
            [],
        ).expect("fixture should insert");
        connection.execute_batch(
            "CREATE TRIGGER reject_mock_cleanup BEFORE DELETE ON games
             BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;"
        ).expect("trigger should install");
        assert!(cleanup_confirmed_mock_games(&mut connection).is_err());
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM games WHERE id='mock-one'", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 1);
    }

    fn apply_through_four(connection: &Connection) {
        connection.execute_batch(
            "CREATE TABLE _achievement_nexus_migrations(
               version INTEGER PRIMARY KEY,
               description TEXT NOT NULL,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );"
        ).expect("migration table should be created");
        for migration in migrations().iter().take(4) {
            apply_migration(connection, &migration.action).expect("base migration should apply");
            connection.execute(
                "INSERT INTO _achievement_nexus_migrations(version,description) VALUES(?1,?2)",
                params![migration.version, migration.description],
            ).expect("base migration should be recorded");
        }
    }

    fn insert_existing_game(connection: &Connection) {
        connection.execute(
            "INSERT INTO games(id,platform_id,platform_game_id,name)
             VALUES('existing-game','steam','10','Existing Game')",
            [],
        ).expect("legacy game should insert");
    }

    fn assert_achievement_sync_schema(connection: &Connection) {
        let achievement_columns = table_columns(connection, "achievements").expect("columns should load");
        for expected in ["locked_icon_url", "source", "global_unlock_percent", "synced_at", "unlock_state_known"] {
            assert!(achievement_columns.iter().any(|column| column == expected), "missing {expected}");
        }
        let game_columns = table_columns(connection, "games").expect("game columns should load");
        for expected in ["achievements_synced_at", "achievements_sync_status", "achievements_sync_error"] {
            assert!(game_columns.iter().any(|column| column == expected), "missing {expected}");
        }
    }

    fn assert_game_query_succeeds(connection: &Connection) {
        connection.prepare(
            "SELECT id,platform_id,platform_game_id,name,cover_url,background_url,playtime_minutes,
             achievements_unlocked,achievements_total,completion_percentage,last_played_at,
             playtime_two_weeks_minutes,playtime_windows_minutes,playtime_mac_minutes,
             playtime_linux_minutes,icon_url,synced_at,favorite,hidden,game_status,
             achievements_synced_at,achievements_sync_status,achievements_sync_error
             FROM games"
        ).expect("get_all_games projection should compile");
    }
}
