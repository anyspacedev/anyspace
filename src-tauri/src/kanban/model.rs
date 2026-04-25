// Models live primarily on the frontend (TypeScript types) since the SQL plugin
// returns raw rows. Kept here for any backend command that needs them later.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub command: String,
    pub system_prompt: String,
    pub env_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub body: String,
    pub column: String,
    pub agent_id: Option<String>,
    pub project_path: Option<String>,
    pub ordinal: f64,
    pub created_at: i64,
    pub updated_at: i64,
}
