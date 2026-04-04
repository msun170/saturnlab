use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub kernel_auto_stop_minutes: Option<u32>,
    #[serde(default = "default_30")]
    pub layer_b_delay_seconds: u32,
    #[serde(default = "default_300")]
    pub layer_a_delay_seconds: u32,
    #[serde(default = "default_30")]
    pub autosave_interval_seconds: u32,
    #[serde(default = "default_true")]
    pub show_line_numbers: bool,
    #[serde(default = "default_light")]
    pub theme: String,
    #[serde(default = "default_14")]
    pub editor_font_size: u32,
}

fn default_30() -> u32 { 30 }
fn default_300() -> u32 { 300 }
fn default_14() -> u32 { 14 }
fn default_true() -> bool { true }
fn default_light() -> String { "light".to_string() }

impl Default for Settings {
    fn default() -> Self {
        Self {
            kernel_auto_stop_minutes: None,
            layer_b_delay_seconds: 30,
            layer_a_delay_seconds: 300,
            autosave_interval_seconds: 30,
            show_line_numbers: true,
            theme: "light".to_string(),
            editor_font_size: 14,
        }
    }
}

fn settings_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("saturn");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.toml")
}

pub fn read_settings() -> Settings {
    let path = settings_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => toml::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn write_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    let content = toml::to_string_pretty(settings).map_err(|e| format!("Serialize: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Write: {}", e))
}
