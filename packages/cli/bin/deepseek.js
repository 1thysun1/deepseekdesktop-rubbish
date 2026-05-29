#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const APP_DIR = path.join(os.homedir(), ".deepseek");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const REASONER_MODEL = "deepseek-reasoner";
const DEFAULT_NETWORK = { enabled: true, requireApproval: true, allowedDomains: [] };
const PERMISSION_PRESETS = {
  default: { sandboxMode: "workspace-write", approvalPolicy: "on-request" },
  "auto-review": { sandboxMode: "workspace-write", approvalPolicy: "on-failure" },
  "full-access": { sandboxMode: "danger-full-access", approvalPolicy: "never" },
  custom: {}
};
const DENYLIST = [
  /remove-item\b.*\b-recurse\b/i,
  /\bdel\b.*\s\/s\b/i,
  /\brd\b.*\s\/s\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bformat\b/i,
  /\bcipher\s+\/w\b/i
];
const BOOLEAN_FLAGS = new Set(["think", "quiet", "allow-commands", "help"]);
const VISIBLE_REASONING_PROTOCOL = [
  "可审计思考协议：",
  "1. 目标：复述要达成的结果。",
  "2. 范围：确认工作区、网络、权限和假设。",
  "3. 证据：先看运行态、日志、配置、入口、调用链和复现。",
  "4. 风险：检查输入验证、认证授权、会话、文件/命令、依赖、密钥、网络、日志、供应链。",
  "5. 计划：给 3-6 个可执行步骤和成功信号。",
  "6. 执行：小步变更，可回退，危险命令先拦截。",
  "7. 校验：测试/复现/静态检查并记录结果。",
  "8. 输出：结果 -> 证据 -> 验证 -> 下一步。",
  "不要泄露隐藏思维链；只展示可审计摘要。"
].join("\n");

const CLAUDE_REASONIX_AGENT_PROTOCOL = [
  "通用 Agent 循环采用 Claude 主导、Codex/Reasonix 辅助的工作方式：理解 -> 读取/搜索 -> 计划 -> 执行 -> 校验 -> 总结。",
  "先理解真实目标和代码/文件证据；能从本地证据发现的不要问用户。",
  "需要本地/网页/附件/终端证据时优先调用宿主能力；不得把“将运行”写成“已运行”。",
  "用户指出错误时，立即丢弃旧结论，列出被推翻假设、反证和新验证路线。",
  "工具输出截断、参数错误、重复失败时，修复调用或换工具；最多重复两次后换策略。",
  "修改文件前先读相关文件；小步变更；验证语法/测试/运行结果。",
  "所有领域都要给置信度：confirmed=有直接证据；candidate=有线索未验证；rejected=已被反证。"
].join("\n");

const CTF_RE_EVIDENCE_PROTOCOL = [
  "CTF/逆向硬规则：先证据，后假设；不允许把计划、伪代码、历史聊天或用户粘贴的错误输出当作当前文件证据。",
  "任何 flag/密钥/地址/节区/overlay/内嵌文件结论，必须同时给出证据来源：文件偏移、VA/RVA、节区名、宿主工具 stdout 或运行输出。",
  "如果候选值只来自 strings 或格式串，标为“候选/待验证”，不能写成最终答案；必须说明还缺哪一步验证。",
  "如果确定性分析显示 overlay=0 或内嵌 PE 未发现，禁止继续编造隐藏 PE、第三层 PE、ZIP、PNG 等不存在结构。",
  "逆向题不能停在 strings：必须继续追 xref、窗口回调/输入处理、比较常量、sprintf/wsprintf/SetWindowText/printf 等输出路径。",
  "当用户要求“重写/再写/重新分析”时，要把最近一条错误回答当成待修正对象；必须重新读取最近上下文里出现的文件/命令证据，不得只改措辞。",
  "回答逆向题按：结论/候选 -> 关键证据 -> 被排除的错误假设 -> 下一步真实操作。不要输出大段未执行代码。"
].join("\n");

const OBJECTIVE_COMPLETION_PROTOCOL = [
  "目标完成优先协议：先判断用户真正要的交付物，而不是机械复述当前一句话。",
  "如果用户说“re题/逆向/把 flag 写出来/做到有答案/继续/重写”，真实目标通常是得到最终 flag、漏洞点、补丁或可运行结果；不要只给计划、命令模板或让用户代跑。",
  "宿主有能力读取文件、运行命令、联网搜索时，必须先用宿主证据推进到可交付结果；只有缺文件、缺权限、工具连续失败或证据不足时，才明确阻塞条件。",
  "最终回答要以结果开头。CTF/逆向任务若已能推出 flag，第一段直接给 flag；证据随后压缩列出。",
  "用户纠错、标答、上一轮失败输出都是强反馈：后续计划必须覆盖完整对话上下文，而不是只看最后一句“重写/继续”。",
  "禁止输出“Step 1/Step 2 请你运行”作为最终结果；若仍需步骤，必须说明这些步骤已经由宿主执行过，或明确为什么当前宿主不能执行。",
  "不要被 planner 的 JSON 摘要限制：计划只是辅助，最终答案必须解决用户原始目标。",
  "附件/文件目标优先级：最新用户消息或最近一次附件中的文件是当前目标；新题出现后，旧题的 flag、路径、反汇编和格式串只能作为已纠正历史，禁止当作当前题答案。",
  "跨题熔断：如果当前目标文件名与答案证据来源文件名不一致，必须停止输出该答案，并说明“这是旧题证据，不是当前文件”。"
].join("\n");

function ensureDir() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const dir of ["sessions", "archived_sessions", "plugins", "skills", "browser", "cache", "log", "tmp", "worktrees", "automations", "rules", "memories", "memory", "hooks", "semantic", "sqlite"]) {
    fs.mkdirSync(path.join(APP_DIR, dir), { recursive: true });
  }
  const configToml = path.join(APP_DIR, "config.toml");
  if (!fs.existsSync(configToml)) {
    fs.writeFileSync(configToml, [
      'model = "deepseek-chat"',
      'reasoner_model = "deepseek-reasoner"',
      'base_url = "https://api.deepseek.com"',
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      '',
      "[projects.'D:\\\\deepseek']",
      'trust_level = "trusted"',
      ''
    ].join("\n"), "utf8");
  }
  for (const file of ["session_index.jsonl", "history.jsonl", "AGENTS.md"]) {
    const target = path.join(APP_DIR, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, "", "utf8");
  }
  const marketplace = path.join(APP_DIR, "marketplace.json");
  if (!fs.existsSync(marketplace)) {
    fs.writeFileSync(marketplace, JSON.stringify({ name: "personal", interface: { displayName: "Personal" }, plugins: [] }, null, 2), "utf8");
  }
  const version = path.join(APP_DIR, "version.json");
  if (!fs.existsSync(version)) {
    fs.writeFileSync(version, JSON.stringify({ latest_version: "0.1.0", last_checked_at: new Date().toISOString(), dismissed_version: null }, null, 2), "utf8");
  }
  const auth = path.join(APP_DIR, "auth.json");
  if (!fs.existsSync(auth)) {
    fs.writeFileSync(auth, JSON.stringify({ api_key_configured: false, web_login: { provider: "deepseek-chat", oauth_pending: true } }, null, 2), "utf8");
  }
}

function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, reasonerModel: REASONER_MODEL, network: DEFAULT_NETWORK };
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const config = { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, reasonerModel: REASONER_MODEL, ...raw, network: { ...DEFAULT_NETWORK, ...(raw.network || {}) } };
  syncToml(config);
  syncAuth(config);
  return config;
}

function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  syncToml(config);
  syncAuth(config);
}

function syncToml(config) {
  const workspace = String(config.workspace || "D:\\deepseek").replaceAll("\\", "\\\\");
  const toml = [
    `model = "${config.model || DEFAULT_MODEL}"`,
    `reasoner_model = "${config.reasonerModel || REASONER_MODEL}"`,
    `base_url = "${config.baseUrl || DEFAULT_BASE_URL}"`,
    `sandbox_mode = "${config.sandboxMode || "workspace-write"}"`,
    `approval_policy = "${config.approvalPolicy || "on-request"}"`,
    `permission_preset = "${config.permissionPreset || "custom"}"`,
    `reasoning_effort = "${config.reasoningEffort || "medium"}"`,
    "",
    "[network]",
    `enabled = ${config.network?.enabled === false ? "false" : "true"}`,
    `require_approval = ${config.network?.requireApproval === false ? "false" : "true"}`,
    `allowed_domains = [${(config.network?.allowedDomains || []).map(domain => `"${domain}"`).join(", ")}]`,
    "",
    "[agent]",
    'loop = "reasonix-inspired"',
    'cache_policy = "stable-prefix-first"',
    'tool_repair = true',
    'visible_reasoning = "status-only"',
    "",
    `[projects.'${workspace}']`,
    'trust_level = "trusted"',
    ""
  ].join("\n");
  fs.writeFileSync(path.join(APP_DIR, "config.toml"), toml, "utf8");
}

function syncAuth(config) {
  fs.writeFileSync(path.join(APP_DIR, "auth.json"), JSON.stringify({
    api_key_configured: Boolean(process.env.DEEPSEEK_API_KEY || config.apiKey),
    web_login: { provider: "deepseek-chat", oauth_pending: true }
  }, null, 2), "utf8");
}

function sessionsDir() {
  ensureDir();
  return path.join(APP_DIR, "sessions");
}

function archivedSessionsDir() {
  ensureDir();
  return path.join(APP_DIR, "archived_sessions");
}

function memoriesDir() {
  ensureDir();
  return path.join(APP_DIR, "memories");
}

function listSessions() {
  return fs.readdirSync(sessionsDir())
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try {
        return JSON.parse(fs.readFileSync(path.join(sessionsDir(), name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function saveSession(session) {
  const id = String(session.id || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");
  const now = new Date().toISOString();
  const data = {
    id,
    title: session.title || "CLI 对话",
    project: session.project || "deepseek-cli",
    time: session.time || "现在",
    messages: session.messages || [],
    createdAt: session.createdAt || now,
    updatedAt: now
  };
  fs.writeFileSync(path.join(sessionsDir(), `${id}.json`), JSON.stringify(data, null, 2), "utf8");
  const rows = listSessions().map(item => JSON.stringify({
    id: item.id,
    thread_name: item.title || "CLI 对话",
    updated_at: item.updatedAt || now
  }));
  fs.writeFileSync(path.join(APP_DIR, "session_index.jsonl"), rows.join("\n") + (rows.length ? "\n" : ""), "utf8");
  return data;
}

function deleteSession(id) {
  const session = listSessions().find(item => item.id === id || item.id.startsWith(id));
  if (!session) throw new Error("未找到会话。");
  const target = path.join(sessionsDir(), `${session.id}.json`);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  const rows = listSessions().map(item => JSON.stringify({
    id: item.id,
    thread_name: item.title || "CLI 对话",
    updated_at: item.updatedAt || new Date().toISOString()
  }));
  fs.writeFileSync(path.join(APP_DIR, "session_index.jsonl"), rows.join("\n") + (rows.length ? "\n" : ""), "utf8");
  return session;
}

function archiveSession(id) {
  const session = listSessions().find(item => item.id === id || item.id.startsWith(id));
  if (!session) throw new Error("未找到会话。");
  session.archivedAt = new Date().toISOString();
  fs.writeFileSync(path.join(archivedSessionsDir(), `${session.id}.json`), JSON.stringify(session, null, 2), "utf8");
  deleteSession(session.id);
  return session;
}

function listArchivedSessions() {
  return fs.readdirSync(archivedSessionsDir())
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(archivedSessionsDir(), name), "utf8")); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.archivedAt || "").localeCompare(String(a.archivedAt || "")));
}

function listMemories() {
  return fs.readdirSync(memoriesDir())
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(memoriesDir(), name), "utf8")); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function saveMemoryEntry(title, content) {
  const now = new Date().toISOString();
  const data = { id: randomUUID(), title, content, tags: [], source: "cli", createdAt: now, updatedAt: now };
  fs.writeFileSync(path.join(memoriesDir(), `${data.id}.json`), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function deleteMemoryEntry(id) {
  const item = listMemories().find(memory => memory.id === id || memory.id.startsWith(id));
  if (!item) throw new Error("未找到记忆。");
  fs.unlinkSync(path.join(memoriesDir(), `${item.id}.json`));
  return item;
}

function memoryContext(limit = 8) {
  const memories = listMemories().filter(item => item.content).slice(0, limit);
  return memories.length ? ["【长期记忆】", ...memories.map(item => `- ${item.title}: ${item.content}`)].join("\n") : "";
}

function compactConversationContext(messages = [], maxMessages = 10, maxChars = 6000) {
  const relevant = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-maxMessages);
  if (!relevant.length) return "";
  const lines = relevant.map((m, index) => {
    const content = String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 900);
    return `${index + 1}. ${m.role}: ${content}`;
  });
  return [
    "【最近对话上下文】",
    "若用户说“重写/继续/再来/它/这个/上面”，必须先解析这些指代，不要声称无历史记录。",
    ...lines
  ].join("\n").slice(0, maxChars);
}

function redact(value) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

async function callDeepSeekDetailed(messages, options = {}) {
  const config = loadConfig();
  const apiKey = process.env.DEEPSEEK_API_KEY || config.apiKey;
  if (!apiKey) {
    throw new Error("缺少 API 密钥。请运行：deepseek config set-key <key>");
  }
  const model = options.model || config.model || DEFAULT_MODEL;
  const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 800)}`);
  }
  const body = await res.json();
  return {
    content: body.choices?.[0]?.message?.content || "",
    usage: body.usage || null,
    model: body.model || model
  };
}

function recordCacheStats(messages, model, usage) {
  ensureDir();
  const stablePrefix = JSON.stringify({
    model,
    system: messages.filter(m => m.role === "system").map(m => m.content),
    tools: ["files", "browser", "terminal", "web-fetch", "sessions"]
  });
  const key = createHash("sha256").update(stablePrefix).digest("hex").slice(0, 16);
  const file = path.join(APP_DIR, "cache", "prefix-cache.json");
  let cache = {};
  try {
    if (fs.existsSync(file)) cache = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    cache = {};
  }
  const prompt = usage?.prompt_tokens ?? 0;
  const hit = usage?.prompt_cache_hit_tokens ?? 0;
  const miss = usage?.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit);
  const previous = cache[key] || { calls: 0, promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
  const next = {
    ...previous,
    model,
    calls: previous.calls + 1,
    promptTokens: previous.promptTokens + prompt,
    cacheHitTokens: previous.cacheHitTokens + hit,
    cacheMissTokens: previous.cacheMissTokens + miss,
    updatedAt: new Date().toISOString()
  };
  cache[key] = next;
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), "utf8");
  return { key, prompt, completion: usage?.completion_tokens ?? 0, hit, miss, hitRatio: prompt ? hit / prompt : 0, seenBefore: previous.calls > 0 };
}

async function callDeepSeek(messages, options = {}) {
  const result = await callDeepSeekDetailed(messages, options);
  return result.content;
}

async function runAgentCli(prompt, flags = {}) {
  const started = Date.now();
  const config = loadConfig();
  const log = (stage, detail) => {
    if (!flags.quiet) console.error(`已处理 ${Math.round((Date.now() - started) / 1000)}s · ${stage}${detail ? `：${detail}` : ""}`);
  };
  log("理解任务", "读取输入");
  log("思考框架", "真实目标 → 上下文 → 宿主证据 → 假设/反证 → 执行 → 校验 → 交付");
  let plan = "";
  try {
    log("制定计划", `使用 ${config.reasonerModel || REASONER_MODEL}`);
    const planResult = await callDeepSeekDetailed([
      { role: "system", content: `你是 Agent Planner。不要输出隐藏思维链，只输出面向用户可审计的 JSON 摘要，字段为 user_intent, deliverable, known_context, evidence, rejected_assumptions, next_actions, checks, blocked_reason。用户原始请求优先级最高；若用户要求只回答某个固定文本，则计划也必须保持这个约束。\n\n${OBJECTIVE_COMPLETION_PROTOCOL}\n\n${CLAUDE_REASONIX_AGENT_PROTOCOL}\n\n${VISIBLE_REASONING_PROTOCOL}\n\n${CTF_RE_EVIDENCE_PROTOCOL}` },
      { role: "user", content: prompt }
    ], { model: config.reasonerModel || REASONER_MODEL });
    plan = planResult.content;
    const stats = recordCacheStats([{ role: "system", content: "planner" }], planResult.model, planResult.usage);
    log("计划完成", `输入 ${stats.prompt}，输出 ${stats.completion} tokens`);
  } catch {
    log("计划降级", "推理模型不可用");
  }
  log("执行", `使用 ${flags.model || config.model || DEFAULT_MODEL}`);
  if (flags.trace && plan) console.error(`思考摘要：\n${plan}\n`);
  const finalMessages = [
    { role: "system", content: `你是 DeepSeek CLI Agent。按可审计思考协议工作，不泄露隐藏思维链。用户原始请求优先级最高；若用户要求只回答某个固定文本，最终答案只能包含该文本。\n\n${OBJECTIVE_COMPLETION_PROTOCOL}\n\n${CLAUDE_REASONIX_AGENT_PROTOCOL}\n\n${VISIBLE_REASONING_PROTOCOL}\n\n${CTF_RE_EVIDENCE_PROTOCOL}` },
    ...(memoryContext() ? [{ role: "system", content: memoryContext() }] : []),
    ...(plan ? [{ role: "system", content: `可审计计划摘要：\n${plan}` }] : []),
    { role: "user", content: prompt }
  ];
  const answerResult = await callDeepSeekDetailed(finalMessages, { model: flags.model });
  const stats = recordCacheStats(finalMessages, answerResult.model, answerResult.usage);
  const answer = answerResult.content;
  log("用量", `输入 ${stats.prompt}，输出 ${stats.completion}，缓存命中 ${Math.round(stats.hitRatio * 100)}%`);
  log("完成", "已生成回复");
  saveSession({
    title: prompt.slice(0, 48) || "CLI Agent",
    messages: [
      { role: "user", content: prompt },
      { role: "assistant", content: answer }
    ]
  });
  return answer;
}

async function chat(flags) {
  const rl = readline.createInterface({ input, output });
  const messages = [{ role: "system", content: `你是 DeepSeek CLI Agent。按可审计循环工作；不要输出隐藏思维链。\n\n${OBJECTIVE_COMPLETION_PROTOCOL}\n\n${CLAUDE_REASONIX_AGENT_PROTOCOL}\n\n${VISIBLE_REASONING_PROTOCOL}\n\n${CTF_RE_EVIDENCE_PROTOCOL}` }];
  const memory = memoryContext();
  if (memory) messages.push({ role: "system", content: memory });
  const session = saveSession({ title: "CLI 对话", messages: [] });
  console.log("DeepSeek 对话。输入 /help 查看命令，/exit 退出。Enter 发送。");
  let model = flags.model || DEFAULT_MODEL;
  while (true) {
    const line = await rl.question("> ");
    const trimmed = line.trim();
    if (trimmed === "/exit" || trimmed === "/quit") break;
    if (trimmed === "/help") {
      console.log([
        "可用命令：",
        "  /chat                 切换 deepseek-chat",
        "  /reasoner             切换 deepseek-reasoner",
        "  /model <name>          切换任意模型",
        "  /status               显示配置与会话状态",
        "  /sessions             列出最近会话",
        "  /permission [preset]   查看或切换权限：default/auto-review/full-access/custom",
        "  /fetch <url>           抓取网页文本（遵守 network 配置）",
        "  /protocol              显示当前可审计思考协议",
        "  /new                  新建上下文",
        "  /exit                 退出"
      ].join("\n"));
      continue;
    }
    if (trimmed === "/reasoner") {
      model = REASONER_MODEL;
      console.log(`model=${model}`);
      continue;
    }
    if (trimmed === "/chat") {
      model = DEFAULT_MODEL;
      console.log(`model=${model}`);
      continue;
    }
    if (trimmed.startsWith("/model ")) {
      model = trimmed.slice("/model ".length).trim() || model;
      console.log(`model=${model}`);
      continue;
    }
    if (trimmed === "/new") {
      messages.splice(1);
      console.log("已清空当前上下文。");
      continue;
    }
    if (trimmed === "/protocol") {
      console.log(VISIBLE_REASONING_PROTOCOL);
      continue;
    }
    if (trimmed === "/status") {
      const config = loadConfig();
      console.log(JSON.stringify({
        home: APP_DIR,
        model,
        permissionPreset: config.permissionPreset || "custom",
        sandboxMode: config.sandboxMode || "workspace-write",
        approvalPolicy: config.approvalPolicy || "on-request",
        network: config.network,
        sessionMessages: messages.length - 1
      }, null, 2));
      continue;
    }
    if (trimmed === "/sessions") {
      for (const item of listSessions().slice(0, 10)) {
        console.log(`${item.id}\t${item.updatedAt || ""}\t${item.title || "新对话"}`);
      }
      continue;
    }
    if (trimmed === "/permission") {
      const config = loadConfig();
      console.log(`权限：${config.permissionPreset || "custom"} (${config.sandboxMode || "workspace-write"} / ${config.approvalPolicy || "on-request"})`);
      continue;
    }
    if (trimmed.startsWith("/permission ")) {
      const preset = trimmed.slice("/permission ".length).trim();
      if (!PERMISSION_PRESETS[preset]) {
        console.log("未知权限。可选：default / auto-review / full-access / custom");
        continue;
      }
      const next = { ...loadConfig(), ...PERMISSION_PRESETS[preset], permissionPreset: preset };
      saveConfig(next);
      console.log(`已切换权限：${preset}`);
      continue;
    }
    if (trimmed.startsWith("/fetch ")) {
      try {
        const result = await fetchUrl(trimmed.slice("/fetch ".length).trim());
        console.log(result.text.slice(0, 2500));
      } catch (err) {
        console.log(`抓取失败：${err.message}`);
      }
      continue;
    }
    if (!trimmed) continue;
    messages.push({ role: "user", content: line });
    const answerResult = await callDeepSeekDetailed(messages, { model });
    const stats = recordCacheStats(messages, answerResult.model, answerResult.usage);
    messages.push({ role: "assistant", content: answerResult.content });
    saveSession({ ...session, title: messages.find(m => m.role === "user")?.content?.slice(0, 48) || "CLI 对话", messages: messages.filter(m => m.role !== "system") });
    console.log(answerResult.content);
    console.error(`用量：输入 ${stats.prompt}，输出 ${stats.completion}，缓存命中 ${Math.round(stats.hitRatio * 100)}%`);
  }
  rl.close();
}

function openLogin() {
  const url = "https://chat.deepseek.com/";
  const cmd = process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  console.log(`已打开：${url}`);
  console.log("API 调用仍需配置：deepseek config set-key <key>");
}

function normalizeUrl(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function assertNetworkAllowed(url) {
  const config = loadConfig();
  if (config.network?.enabled === false) throw new Error("联网功能已关闭。请运行：deepseek network enable");
  const allowed = config.network?.allowedDomains || [];
  if (allowed.length) {
    const host = new URL(url).hostname.toLowerCase();
    const ok = allowed.some(domain => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`));
    if (!ok) throw new Error(`域名不在允许列表：${host}`);
  }
}

async function fetchUrl(url) {
  const target = normalizeUrl(url);
  assertNetworkAllowed(target);
  const res = await fetch(target, { headers: { "User-Agent": "DeepSeekWindows/0.1" } });
  const text = await res.text();
  return { url: res.url, status: res.status, contentType: res.headers.get("content-type") || "", text: text.slice(0, 12000) };
}

async function runCommand(command, flags) {
  if (!flags["allow-commands"]) {
    throw new Error("默认禁止命令执行。请添加 --allow-commands 后重试。");
  }
  for (const pattern of DENYLIST) {
    if (pattern.test(command)) {
      throw new Error(`已被安全策略拦截：${pattern}`);
    }
  }
  const cwd = path.resolve(flags.workspace || process.cwd());
  const child = spawn(command, { cwd, shell: true, stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 1));
}

async function main() {
  const [cmd, subcmd, ...tail] = process.argv.slice(2);
  const { flags, rest } = parseFlags(tail);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(`Usage:
  deepseek ask <prompt> [--model deepseek-chat|deepseek-reasoner]
  deepseek agent <prompt>
  deepseek chat [--model deepseek-chat|deepseek-reasoner]
  deepseek config set-key <key>
  deepseek config show
  deepseek permission list
  deepseek permission set <default|auto-review|full-access|custom>
  deepseek network show
  deepseek network enable|disable
  deepseek network allow <domain>
  deepseek fetch <url>
  deepseek browse <url>
  deepseek search <query>
  deepseek sessions list
  deepseek sessions show <id>
  deepseek sessions delete <id>
  deepseek sessions archive <id>
  deepseek sessions archived
  deepseek memory list
  deepseek memory add <title> -- <content>
  deepseek memory delete <id>
  deepseek login
  deepseek doctor
  deepseek status
  deepseek test
  deepseek run <command> --allow-commands [--workspace <path>]`);
    return;
  }
  if (cmd === "ask") {
    const parsed = parseFlags(process.argv.slice(3));
    const prompt = parsed.rest.filter(Boolean).join(" ");
    const answer = parsed.flags.think ? await runAgentCli(prompt, parsed.flags) : await callDeepSeek([{ role: "user", content: prompt }], { model: parsed.flags.model });
    saveSession({
      title: prompt.slice(0, 48) || "CLI 提问",
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: answer }
      ]
    });
    console.log(answer);
    return;
  }
  if (cmd === "agent") {
    const parsed = parseFlags(process.argv.slice(3));
    const prompt = parsed.rest.filter(Boolean).join(" ");
    if (!prompt) throw new Error("用法：deepseek agent <prompt>");
    console.log(await runAgentCli(prompt, parsed.flags));
    return;
  }
  if (cmd === "chat") return chat({ model: subcmd || flags.model });
  if (cmd === "sessions" && subcmd === "list") {
    const sessions = listSessions().slice(0, 30);
    if (!sessions.length) {
      console.log("暂无会话。");
      return;
    }
    for (const item of sessions) {
      console.log(`${item.id}\t${item.updatedAt || ""}\t${item.title || "未命名会话"}`);
    }
    return;
  }
  if (cmd === "sessions" && subcmd === "show") {
    const id = rest[0];
    if (!id) throw new Error("用法：deepseek sessions show <id>");
    const session = listSessions().find(item => item.id === id || item.id.startsWith(id));
    if (!session) throw new Error("未找到会话。");
    console.log(`# ${session.title || "未命名会话"}\n`);
    for (const msg of session.messages || []) {
      console.log(`## ${msg.role}\n${msg.content}\n`);
    }
    return;
  }
  if (cmd === "sessions" && subcmd === "delete") {
    const id = rest[0];
    if (!id) throw new Error("用法：deepseek sessions delete <id>");
    const removed = deleteSession(id);
    console.log(`已删除会话：${removed.title || removed.id}`);
    return;
  }
  if (cmd === "sessions" && subcmd === "archive") {
    const id = rest[0];
    if (!id) throw new Error("用法：deepseek sessions archive <id>");
    const archived = archiveSession(id);
    console.log(`已归档会话：${archived.title || archived.id}`);
    return;
  }
  if (cmd === "sessions" && subcmd === "archived") {
    const sessions = listArchivedSessions().slice(0, 30);
    if (!sessions.length) {
      console.log("暂无归档会话。");
      return;
    }
    for (const item of sessions) console.log(`${item.id}\t${item.archivedAt || ""}\t${item.title || "未命名会话"}`);
    return;
  }
  if (cmd === "memory" && subcmd === "list") {
    const memories = listMemories();
    if (!memories.length) {
      console.log("暂无记忆。");
      return;
    }
    for (const item of memories) console.log(`${item.id}\t${item.updatedAt || ""}\t${item.title}: ${String(item.content || "").slice(0, 120)}`);
    return;
  }
  if (cmd === "memory" && subcmd === "add") {
    const sep = rest.indexOf("--");
    const title = sep >= 0 ? rest.slice(0, sep).join(" ") : rest[0];
    const content = sep >= 0 ? rest.slice(sep + 1).join(" ") : rest.slice(1).join(" ");
    if (!title || !content) throw new Error("用法：deepseek memory add <title> -- <content>");
    const item = saveMemoryEntry(title, content);
    console.log(`已保存记忆：${item.id}`);
    return;
  }
  if (cmd === "memory" && subcmd === "delete") {
    const id = rest[0];
    if (!id) throw new Error("用法：deepseek memory delete <id>");
    const item = deleteMemoryEntry(id);
    console.log(`已删除记忆：${item.title || item.id}`);
    return;
  }
  if (cmd === "login") return openLogin();
  if (cmd === "network" && subcmd === "show") {
    console.log(JSON.stringify(loadConfig().network || DEFAULT_NETWORK, null, 2));
    return;
  }
  if (cmd === "network" && (subcmd === "enable" || subcmd === "disable")) {
    const config = loadConfig();
    config.network = { ...(config.network || DEFAULT_NETWORK), enabled: subcmd === "enable" };
    saveConfig(config);
    console.log(`联网功能已${subcmd === "enable" ? "开启" : "关闭"}。`);
    return;
  }
  if (cmd === "network" && subcmd === "allow") {
    const domain = rest[0];
    if (!domain) throw new Error("用法：deepseek network allow <domain>");
    const config = loadConfig();
    const current = new Set(config.network?.allowedDomains || []);
    current.add(domain.toLowerCase());
    config.network = { ...(config.network || DEFAULT_NETWORK), allowedDomains: [...current] };
    saveConfig(config);
    console.log(`已允许域名：${domain}`);
    return;
  }
  if (cmd === "fetch") {
    const url = [subcmd, ...rest].filter(Boolean).join(" ");
    if (!url) throw new Error("用法：deepseek fetch <url>");
    const result = await fetchUrl(url);
    console.log(`URL: ${result.url}\n状态: ${result.status}\n类型: ${result.contentType}\n\n${result.text}`);
    return;
  }
  if (cmd === "browse") {
    const url = [subcmd, ...rest].filter(Boolean).join(" ");
    if (!url) throw new Error("用法：deepseek browse <url>");
    const target = normalizeUrl(url);
    assertNetworkAllowed(target);
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    console.log(`已打开：${target}`);
    return;
  }
  if (cmd === "search") {
    const query = [subcmd, ...rest].filter(Boolean).join(" ");
    if (!query) throw new Error("用法：deepseek search <query>");
    const target = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    assertNetworkAllowed(target);
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    console.log(`已打开搜索：${target}`);
    return;
  }
  if (cmd === "test") {
    const started = Date.now();
    try {
      const answer = await callDeepSeek([
        { role: "system", content: "你是连通性测试器。必须只输出 OK，不要输出其他任何字符。" },
        { role: "user", content: "输出 OK" }
      ], { model: flags.model });
      const normalized = answer.trim();
      console.log(JSON.stringify({ ok: normalized === "OK", apiReachable: true, model: flags.model || loadConfig().model || DEFAULT_MODEL, latencyMs: Date.now() - started, answer: normalized.slice(0, 80) }, null, 2));
    } catch (err) {
      const msg = err.message.includes("Insufficient Balance") ? "API 可达，但账户余额不足，无法完成算力测试。" : err.message;
      console.log(JSON.stringify({ ok: false, latencyMs: Date.now() - started, error: msg }, null, 2));
      process.exit(2);
    }
    return;
  }
  if (cmd === "doctor") {
    const config = loadConfig();
    console.log(JSON.stringify({
      node: process.version,
      configPath: CONFIG_PATH,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: redact(process.env.DEEPSEEK_API_KEY || config.apiKey)
    }, null, 2));
    return;
  }
  if (cmd === "status") {
    const config = loadConfig();
    const sessions = listSessions();
    const requiredDirs = ["sessions", "plugins", "skills", "browser", "cache", "log", "tmp", "worktrees", "automations", "rules", "memories", "memory", "hooks", "semantic", "sqlite"];
    const dirs = Object.fromEntries(requiredDirs.map(dir => [dir, fs.existsSync(path.join(APP_DIR, dir))]));
    console.log(JSON.stringify({
      home: APP_DIR,
      configPath: CONFIG_PATH,
      configToml: path.join(APP_DIR, "config.toml"),
      auth: path.join(APP_DIR, "auth.json"),
      model: config.model,
      reasonerModel: config.reasonerModel || REASONER_MODEL,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      permissionPreset: config.permissionPreset || "custom",
      sandboxMode: config.sandboxMode || "workspace-write",
      approvalPolicy: config.approvalPolicy || "on-request",
      apiKeyConfigured: Boolean(process.env.DEEPSEEK_API_KEY || config.apiKey),
      sessionCount: sessions.length,
      latestSession: sessions[0] ? { id: sessions[0].id, title: sessions[0].title, updatedAt: sessions[0].updatedAt } : null,
      dirs
    }, null, 2));
    return;
  }
  if (cmd === "config" && subcmd === "set-key") {
    const key = rest[0];
    if (!key) throw new Error("用法：deepseek config set-key <key>");
    const config = loadConfig();
    config.apiKey = key;
    saveConfig(config);
    console.log(`Saved API key to ${CONFIG_PATH}`);
    return;
  }
  if (cmd === "config" && subcmd === "show") {
    const config = loadConfig();
    console.log(JSON.stringify({ ...config, apiKey: redact(process.env.DEEPSEEK_API_KEY || config.apiKey) }, null, 2));
    return;
  }
  if (cmd === "permission" && subcmd === "list") {
    console.log(`权限预设:
  default      默认权限：工作区写入，命令按需批准
  auto-review  自动审查：工作区写入，失败/敏感操作再审查
  full-access  完全访问权限：完整文件访问，永不请求批准
  custom       自定义：使用 ~/.deepseek/config.toml`);
    return;
  }
  if (cmd === "permission" && subcmd === "set") {
    const preset = rest[0];
    if (!Object.hasOwn(PERMISSION_PRESETS, preset)) {
      throw new Error("用法：deepseek permission set <default|auto-review|full-access|custom>");
    }
    const config = loadConfig();
    const next = { ...config, ...PERMISSION_PRESETS[preset], permissionPreset: preset };
    saveConfig(next);
    console.log(`已切换权限：${preset}`);
    return;
  }
  if (cmd === "run") {
    const command = [subcmd, ...rest].filter(Boolean).join(" ");
    return runCommand(command, flags);
  }
  throw new Error(`未知命令：${cmd}`);
}

main().catch(err => {
  console.error(`deepseek: ${err.message}`);
  process.exit(1);
});
