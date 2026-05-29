# DeepSeek Visible Reasoning Protocol

This project does not rely on exposing an assistant's private hidden chain-of-thought. The desktop and CLI show an audit-grade reasoning trace instead: enough for a developer or security reviewer to understand the work, repeat it, and challenge it.

## Grounding

- NIST SSDF SP 800-218: organize secure software work around preparing, protecting, producing well-secured software, and responding to vulnerabilities.
- OWASP Secure Coding Practices: validate untrusted input, encode output, centralize authentication, and fail securely.
- CISA Secure by Design: make customer security outcomes, transparency, and secure defaults part of the product lifecycle.
- DeepSeek `deepseek-reasoner`: API responses may include `reasoning_content`, but previous reasoning content must not be fed back into the next request.

## Protocol

```text
目标：
  用一句话复述用户要达成的结果。

范围：
  明确工作区、网络、账号、权限、系统、时间、假设。

证据：
  优先运行态、日志、配置、入口、调用链、复现步骤。
  证据冲突时，运行态 > 网络/日志 > 配置 > 源码 > 注释。

风险：
  检查输入验证、输出编码、认证、授权、会话、文件/命令、依赖、密钥、网络、日志、供应链。

计划：
  给 3-6 个可执行步骤；每步说明成功信号。

执行：
  小步修改，一次改一个变量，保留可回退路径。
  破坏性命令、越界文件读写、账号/密钥访问必须被拦截或请求确认。

校验：
  运行测试、复现、静态检查、配置检查或 API 连通检查。

输出：
  结果 -> 关键证据 -> 验证 -> 剩余风险/下一步。
```

## UI behavior

- Desktop shows `已处理 Ns` as a collapsible thinking area.
- The thinking area shows visible protocol steps and reasoner-generated planning summary.
- It remains visible after completion so users can inspect why the answer was produced.
- CLI shows the same trace on stderr unless `--quiet` is used; `--trace` also prints the full planning summary.

