# DeepSeek Desktop Tauri Migration

## Decision

Use Tauri + React as the target architecture, keep Electron as the compatibility runtime until Rust/Cargo is available and the Tauri app reaches feature parity.

## Why Tauri is better for this project

- Windows uses Microsoft Edge WebView2 instead of bundling Chromium, so idle memory and installer size should be closer to a native app.
- Tauri v2 supports tray, menus, plugins, updater artifacts, and NSIS Windows installers.
- React components fit the UI complexity better than the current single-file renderer:
  - sidebar
  - composer
  - permission menu
  - search palette
  - plugin/skill marketplace
  - right context panel
- Rust command handlers create a stricter IPC boundary for filesystem, shell, browser, terminal, and config operations.

## Constraints observed locally

`rustc` and `cargo` are not available in the current environment, so `tauri build` cannot run yet. Node and npm are available.

## Migration shape

```text
packages/cli/bin/deepseek.js
  CLI entry and command vocabulary

packages/desktop/
  current working Electron desktop

packages/desktop-tauri/
  target Tauri + React desktop

%USERPROFILE%\.deepseek
  shared config, sessions, cache, plugins, skills, rules, memory, hooks, semantic index
```

## Runtime parity checklist

- [x] React sidebar/composer/context skeleton
- [x] `.deepseek` creation in Tauri Rust command layer
- [x] tray menu skeleton
- [x] NSIS target config
- [ ] DeepSeek API call command
- [ ] session list/save/delete commands
- [ ] terminal pty bridge
- [ ] file browser command with workspace boundary
- [ ] browser/open-url command
- [ ] plugin/skill loader
- [ ] installer replacement from IExpress to Tauri NSIS

## Build after prerequisites

```powershell
cd D:\path\to\deepseekdesktop
npm --prefix packages\desktop-tauri install
npm run desktop:tauri
npm run build:tauri
```
