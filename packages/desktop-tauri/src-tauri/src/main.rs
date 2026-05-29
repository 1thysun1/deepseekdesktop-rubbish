#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::path::PathBuf;
use tauri::{menu::MenuBuilder, tray::TrayIconBuilder, Manager};

#[derive(Serialize)]
struct HomeInfo {
    home: String,
    config_json: String,
    config_toml: String,
}

fn deepseek_home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".deepseek")
}

fn ensure_deepseek_home() -> std::io::Result<HomeInfo> {
    let home = deepseek_home();
    for name in [
        "sessions",
        "archived_sessions",
        "plugins",
        "skills",
        "browser",
        "cache",
        "log",
        "tmp",
        "worktrees",
        "automations",
        "rules",
        "memories",
        "memory",
        "hooks",
        "semantic",
        "sqlite",
    ] {
        std::fs::create_dir_all(home.join(name))?;
    }
    let config_json = home.join("config.json");
    if !config_json.exists() {
        std::fs::write(
            &config_json,
            r#"{
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "reasonerModel": "deepseek-reasoner",
  "workspace": "D:\\deepseek",
  "permissionPreset": "custom",
  "sandboxMode": "workspace-write",
  "approvalPolicy": "on-request"
}"#,
        )?;
    }
    let config_toml = home.join("config.toml");
    if !config_toml.exists() {
        std::fs::write(
            &config_toml,
            r#"model = "deepseek-chat"
reasoner_model = "deepseek-reasoner"
base_url = "https://api.deepseek.com"
sandbox_mode = "workspace-write"
approval_policy = "on-request"
permission_preset = "custom"
reasoning_effort = "medium"

[agent]
loop = "reasonix-inspired"
cache_policy = "stable-prefix-first"
tool_repair = true
visible_reasoning = "status-only"

[projects.'D:\\deepseek']
trust_level = "trusted"
"#,
        )?;
    }
    Ok(HomeInfo {
        home: home.display().to_string(),
        config_json: config_json.display().to_string(),
        config_toml: config_toml.display().to_string(),
    })
}

#[tauri::command]
fn deepseek_home_info() -> Result<HomeInfo, String> {
    ensure_deepseek_home().map_err(|err| err.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let _ = ensure_deepseek_home();
            let menu = MenuBuilder::new(app)
                .text("show", "显示窗口")
                .separator()
                .text("quit", "退出 DeepSeek")
                .build()?;
            TrayIconBuilder::with_id("main")
                .tooltip("DeepSeek 桌面端")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![deepseek_home_info])
        .run(tauri::generate_context!())
        .expect("failed to run DeepSeek desktop");
}
