# `~\.deepseek` 目录设计

参考 `~\.codex`，DeepSeek Windows 使用用户主目录下的 `~\.deepseek` 作为统一状态目录。

## 顶层文件

- `config.json`：桌面端/CLI 当前运行配置，便于 JS 直接读写。
- `config.toml`：Codex-like 主配置，记录模型、沙箱、批准策略和可信项目。
- `auth.json`：API 密钥/Web 登录状态元信息，不保存网页登录 cookie。
- `session_index.jsonl`：会话索引。
- `history.jsonl`：CLI 历史。
- `marketplace.json`：个人插件市场配置。
- `version.json`：版本检查状态。
- `AGENTS.md`：全局 Agent 说明入口。

## 目录

- `sessions/`：当前会话内容。
- `archived_sessions/`：归档会话。
- `plugins/`：本地插件。
- `skills/`：本地技能。
- `browser/`：浏览器会话元数据。
- `cache/`：模型、索引、临时缓存。
- `log/`：运行日志。
- `tmp/`：临时文件。
- `worktrees/`：工作树/隔离任务目录。
- `automations/`：自动化任务配置。
- `rules/`：安全策略与项目规则。
- `memories/`：长期记忆。
- `sqlite/`：后续状态数据库。
