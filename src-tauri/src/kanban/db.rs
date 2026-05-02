use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "seed_default_agents",
            sql: include_str!("../../migrations/002_seed.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "update_default_agent_commands",
            sql: include_str!("../../migrations/003_update_default_agents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "team_mode",
            sql: include_str!("../../migrations/004_team.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "super_agent",
            sql: include_str!("../../migrations/005_super_agent.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
