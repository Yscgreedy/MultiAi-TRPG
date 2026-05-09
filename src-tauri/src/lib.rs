use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:multi-ai-trpg.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_rulesets",
            sql: r#"
                CREATE TABLE IF NOT EXISTS rulesets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_campaigns",
            sql: r#"
                CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ruleset_id TEXT NOT NULL,
                status TEXT NOT NULL,
                premise TEXT NOT NULL,
                summary TEXT NOT NULL,
                world_state TEXT NOT NULL,
                active_character_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_sessions",
            sql: r#"
                CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                title TEXT NOT NULL,
                checkpoint TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_characters",
            sql: r#"
                CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                ruleset_id TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_character_versions",
            sql: r#"
                CREATE TABLE IF NOT EXISTS character_versions (
                id TEXT PRIMARY KEY,
                character_id TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_messages",
            sql: r#"
                CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_ai_agents",
            sql: r#"
                CREATE TABLE IF NOT EXISTS ai_agents (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                label TEXT NOT NULL,
                model TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                system_prompt TEXT NOT NULL,
                updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "create_game_events",
            sql: r#"
                CREATE TABLE IF NOT EXISTS game_events (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create_attachments",
            sql: r#"
                CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "create_settings",
            sql: r#"
                CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "index_campaigns_updated_at",
            sql: "CREATE INDEX IF NOT EXISTS idx_campaigns_updated_at ON campaigns(updated_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "index_messages_campaign_created",
            sql: "CREATE INDEX IF NOT EXISTS idx_messages_campaign_created ON messages(campaign_id, created_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "index_events_campaign_created",
            sql: "CREATE INDEX IF NOT EXISTS idx_events_campaign_created ON game_events(campaign_id, created_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "create_character_library",
            sql: r#"
                CREATE TABLE IF NOT EXISTS character_library (
                id TEXT PRIMARY KEY,
                ruleset_id TEXT NOT NULL,
                name TEXT NOT NULL,
                source TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "index_character_library_ruleset",
            sql: "CREATE INDEX IF NOT EXISTS idx_character_library_ruleset ON character_library(ruleset_id, updated_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_campaign_source_character",
            sql: "ALTER TABLE campaigns ADD COLUMN source_character_id TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "create_npc_characters",
            sql: r#"
                CREATE TABLE IF NOT EXISTS npc_characters (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                ruleset_id TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "index_npc_characters_campaign",
            sql: "CREATE INDEX IF NOT EXISTS idx_npc_characters_campaign ON npc_characters(campaign_id, is_active, created_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add_message_author_label",
            sql: "ALTER TABLE messages ADD COLUMN author_label TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "add_message_actor_id",
            sql: "ALTER TABLE messages ADD COLUMN actor_id TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "create_rulebook_documents",
            sql: r#"
                CREATE TABLE IF NOT EXISTS rulebook_documents (
                id TEXT PRIMARY KEY,
                ruleset_id TEXT NOT NULL,
                title TEXT NOT NULL,
                source_name TEXT NOT NULL,
                content TEXT NOT NULL,
                chunk_count INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "create_rulebook_chunks",
            sql: r#"
                CREATE TABLE IF NOT EXISTS rulebook_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                ruleset_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES rulebook_documents(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "index_rulebook_chunks_ruleset",
            sql: "CREATE INDEX IF NOT EXISTS idx_rulebook_chunks_ruleset ON rulebook_chunks(ruleset_id, document_id, chunk_index);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "add_rulebook_character_type",
            sql: "ALTER TABLE rulebook_documents ADD COLUMN character_type TEXT NOT NULL DEFAULT '通用';",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
