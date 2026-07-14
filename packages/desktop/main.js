import { app, BrowserWindow, ipcMain, session, shell, Menu, dialog } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(os.homedir(), ".deepseek");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const DEFAULT_CONFIG = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  reasonerModel: "deepseek-reasoner",
  workspace: "D:\\deepseek",
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write",
  permissionPreset: "custom",
  network: {
    enabled: true,
    requireApproval: true,
    allowedDomains: []
  },
  theme: "dark",
  maxContextMessages: 24,
  temperature: 0.2
};

const VISIBLE_REASONING_PROTOCOL = [
  "你使用“可审计思考协议”处理编程和网安任务，但不要泄露隐藏思维链。",
  "必须先输出或记录可见摘要，而不是直接给结论：",
  "1. 目标：用一句话复述用户要达成的结果。",
  "2. 范围：列出工作区、系统、网络、账号、权限边界；不确定处标为假设。",
  "3. 证据：优先运行态、日志、配置、入口、调用链、复现步骤；不要用猜测覆盖证据。",
  "4. 风险：识别输入验证、认证授权、会话、文件/命令、依赖、密钥、网络、日志、供应链风险。",
  "5. 计划：给 3-6 个可执行步骤；每步说明要观察的成功信号。",
  "6. 执行：小步变更，保留可回退路径；命令和文件操作按当前权限策略执行：默认权限需确认，自动审查可审查后执行，完全访问/never 视为用户已授权。",
  "7. 校验：运行测试/复现/静态检查；给出命令、结果、剩余风险。",
  "8. 输出：按 结果 -> 证据 -> 验证 -> 下一步 汇报。",
  "网安任务默认限定在用户授权工作区/靶场/CTF/本地环境；优先防御、审计、复现和修复。"
].join("\n");

const CTF_RE_EVIDENCE_PROTOCOL = [
  "CTF/逆向硬规则：先证据，后假设；不允许把计划、伪代码、历史聊天或用户粘贴的错误输出当作当前文件证据。",
  "任何 flag/密钥/地址/节区/overlay/内嵌文件结论，必须同时给出证据来源：文件偏移、VA/RVA、节区名、宿主工具 stdout 或运行输出。",
  "如果候选值只来自 strings 或格式串，标为“候选/待验证”，不能写成最终答案；必须说明还缺哪一步验证。",
  "如果宿主确定性分析显示 overlay=0 或内嵌 PE 未发现，禁止继续编造隐藏 PE、第三层 PE、ZIP、PNG 等不存在结构。",
  "用户指出“错”时，先列出被推翻的假设和反证，再回到当前宿主证据；不得继续维护旧结论或无依据深挖。",
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

const CLAUDE_REASONIX_AGENT_PROTOCOL = [
  "通用 Agent 循环采用 Claude 主导、Codex/Reasonix 辅助的工作方式：理解 -> 读取/搜索 -> 计划 -> 执行 -> 校验 -> 总结。",
  "Claude 式纪律：先理解代码库和用户真实目标；遇到不明确但会改变方案的点才提问；能从本地证据发现的不要问用户。",
  "Claude 式工具闭环：需要本地/网页/附件/终端证据时优先调用宿主工具；不得把“我将运行”写成“我已运行”。",
  "Claude 式纠错：当用户指出错误，立即丢弃旧结论，列出被推翻假设、反证和新验证路线；禁止重复输出同一错误候选。",
  "Reasonix 式成本和稳定性：系统提示、工具说明、记忆保持稳定；临时 scratch 不写入长期上下文；大工具结果先总结，必要时再重读。",
  "Reasonix 式工具修复：发现工具缺失、输出截断、参数错误、重复调用时，先修复调用或换更低层工具；重复失败最多两次后换策略。",
  "Codex 式工程执行：修改文件前先读相关文件；小步 patch；验证语法/测试/运行结果；汇报只给关键改动和证据。",
  "所有领域都要给置信度：confirmed=有直接证据；candidate=有线索未验证；rejected=已被反证。"
].join("\n");

const PERMISSION_PRESETS = {
  default: { sandboxMode: "workspace-write", approvalPolicy: "on-request" },
  "auto-review": { sandboxMode: "workspace-write", approvalPolicy: "on-failure" },
  "full-access": { sandboxMode: "danger-full-access", approvalPolicy: "never" }
};

function effectiveConfig(config = loadConfig()) {
  const preset = config.permissionPreset;
  return { ...config, ...(PERMISSION_PRESETS[preset] || {}) };
}

let mainWindow;
let loginWindow;
const grantedFiles = new Set();
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function normalizeInside(target, root) {
  const resolved = path.resolve(target);
  const base = path.resolve(root);
  return resolved.toLowerCase().startsWith(base.toLowerCase() + path.sep.toLowerCase()) || resolved.toLowerCase() === base.toLowerCase();
}

function canReadFile(filePath, config = loadConfig()) {
  config = effectiveConfig(config);
  const target = path.resolve(filePath);
  const workspace = path.resolve(config.workspace || "D:\\deepseek");
  if (normalizeInside(target, workspace)) return true;
  if (grantedFiles.has(target.toLowerCase())) return true;
  return config.sandboxMode === "danger-full-access" && config.approvalPolicy === "never";
}

function readAttachmentFile(filePath) {
  const config = loadConfig();
  const target = path.resolve(filePath);
  if (!canReadFile(target, config)) {
    throw new Error("拒绝读取未授权文件。请通过附件按钮选择文件，或把文件放入当前工作区。");
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error("附件必须是文件。");
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    return {
      path: target,
      name: path.basename(target),
      size: stat.size,
      truncated: true,
      content: `[文件过大，未自动读取正文：${stat.size} bytes。上限 ${MAX_ATTACHMENT_BYTES} bytes]`
    };
  }
  const raw = fs.readFileSync(target);
  const textLike = /\.(txt|md|json|jsonl|toml|yaml|yml|js|jsx|ts|tsx|css|html|xml|py|ps1|bat|cmd|rs|go|java|c|cpp|h|hpp|cs|php|rb|sql|log|csv)$/i.test(target);
  const binaryMeta = [
    `二进制文件已真实读取：${target}`,
    `大小：${stat.size} bytes`,
    `前 256 字节十六进制：${raw.subarray(0, 256).toString("hex")}`,
    "如需深度解析 pcap/zip/exe/iso/img，可让宿主继续调用 PowerShell/Python/tshark/binwalk/7z 等本地工具。"
  ].join("\n");
  const content = textLike ? raw.toString("utf8") : binaryMeta;
  const analysis = /\.(exe|dll|sys|bin|elf)$/i.test(target) ? analyzeBinaryFile(target, raw) : "";
  return {
    path: target,
    name: path.basename(target),
    size: stat.size,
    truncated: false,
    content: [content, analysis].filter(Boolean).join("\n\n").slice(0, MAX_ATTACHMENT_BYTES)
  };
}

function asciiStrings(buffer, min = 4, limit = 500) {
  const out = [];
  let current = [];
  for (const byte of buffer) {
    if (byte >= 0x20 && byte <= 0x7e) current.push(byte);
    else {
      if (current.length >= min) out.push(Buffer.from(current).toString("ascii"));
      current = [];
      if (out.length >= limit) break;
    }
  }
  if (current.length >= min && out.length < limit) out.push(Buffer.from(current).toString("ascii"));
  return out;
}

function uniqueStrings(items, limit = 80) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = String(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function readU16(buffer, offset) {
  return offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : 0;
}

function readU32(buffer, offset) {
  return offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : 0;
}

function packU32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return out;
}

function analyzePeLike(buffer, baseOffset = 0) {
  if (buffer.length < 0x40 || buffer.subarray(0, 2).toString("ascii") !== "MZ") {
    return { ok: false, reason: "not MZ" };
  }
  const peOffset = readU32(buffer, 0x3c);
  if (peOffset <= 0 || peOffset + 0x18 > buffer.length || buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\u0000\u0000") {
    return { ok: false, reason: "missing PE signature", peOffset };
  }
  const machine = readU16(buffer, peOffset + 4);
  const sectionsCount = readU16(buffer, peOffset + 6);
  const optSize = readU16(buffer, peOffset + 20);
  const optOffset = peOffset + 24;
  const magic = readU16(buffer, optOffset);
  const entryPoint = readU32(buffer, optOffset + 16);
  const imageBase = magic === 0x20b
    ? Number(buffer.readBigUInt64LE(optOffset + 24))
    : readU32(buffer, optOffset + 28);
  const sectionTable = optOffset + optSize;
  const sections = [];
  let rawEnd = 0;
  for (let i = 0; i < sectionsCount && sectionTable + i * 40 + 40 <= buffer.length; i++) {
    const off = sectionTable + i * 40;
    const name = buffer.subarray(off, off + 8).toString("ascii").replace(/\0+$/g, "");
    const virtualSize = readU32(buffer, off + 8);
    const virtualAddress = readU32(buffer, off + 12);
    const rawSize = readU32(buffer, off + 16);
    const rawOffset = readU32(buffer, off + 20);
    const characteristics = readU32(buffer, off + 36);
    if (rawOffset && rawSize) rawEnd = Math.max(rawEnd, rawOffset + rawSize);
    sections.push({ name, virtualAddress, virtualSize, rawOffset, rawSize, characteristics });
  }
  const overlaySize = rawEnd > 0 && rawEnd < buffer.length ? buffer.length - rawEnd : 0;
  return { ok: true, baseOffset, peOffset, machine, sectionsCount, magic, entryPoint, imageBase, rawEnd, overlaySize, sections };
}

function formatPeAnalysis(label, pe) {
  if (!pe.ok) return `${label}: 不是有效 PE（${pe.reason || "unknown"}）`;
  return [
    `${label}: PE 有效`,
    `  文件内偏移: 0x${pe.baseOffset.toString(16)}`,
    `  PE 头偏移: 0x${pe.peOffset.toString(16)}`,
    `  Machine: 0x${pe.machine.toString(16)}`,
    `  节区数: ${pe.sectionsCount}`,
    `  ImageBase: 0x${pe.imageBase.toString(16)}`,
    `  EntryPoint RVA: 0x${pe.entryPoint.toString(16)}`,
    `  RawEnd: 0x${pe.rawEnd.toString(16)}`,
    `  Overlay: ${pe.overlaySize} bytes`,
    ...pe.sections.map(s => `  Section ${s.name || "(empty)"} VA=0x${s.virtualAddress.toString(16)} VS=0x${s.virtualSize.toString(16)} RawOff=0x${s.rawOffset.toString(16)} RawSize=0x${s.rawSize.toString(16)} Ch=0x${s.characteristics.toString(16)}`)
  ].join("\n");
}

function fileOffsetToVa(pe, fileOffset) {
  if (!pe.ok) return null;
  for (const s of pe.sections) {
    if (fileOffset >= s.rawOffset && fileOffset < s.rawOffset + s.rawSize) {
      return {
        section: s.name || "(empty)",
        va: pe.imageBase + s.virtualAddress + (fileOffset - s.rawOffset),
        rva: s.virtualAddress + (fileOffset - s.rawOffset)
      };
    }
  }
  return null;
}

function locateString(buffer, text) {
  const raw = Buffer.from(text, "latin1");
  let pos = buffer.indexOf(raw);
  if (pos >= 0) return pos;
  pos = buffer.indexOf(Buffer.from(text, "ascii"));
  return pos >= 0 ? pos : null;
}

function formatStringEvidence(buffer, pe, candidates) {
  if (!pe.ok || !candidates.length) return ["格式串证据链: 未发现可定位格式串"];
  const rows = [];
  for (const text of candidates.slice(0, 20)) {
    const offset = locateString(buffer, text);
    if (offset === null) continue;
    const loc = fileOffsetToVa(pe, offset);
    const refs = [];
    if (loc) {
      const pat = packU32(loc.va);
      let pos = 0;
      while ((pos = buffer.indexOf(pat, pos)) !== -1) {
        if (pos !== offset) {
          const refLoc = fileOffsetToVa(pe, pos);
          refs.push(refLoc
            ? `raw=0x${pos.toString(16)} VA~=0x${refLoc.va.toString(16)} section=${refLoc.section}`
            : `raw=0x${pos.toString(16)}`);
        }
        pos += 1;
        if (refs.length >= 12) break;
      }
    }
    rows.push([
      `  text=${text}`,
      `    raw=0x${offset.toString(16)}${loc ? ` VA=0x${loc.va.toString(16)} RVA=0x${loc.rva.toString(16)} section=${loc.section}` : ""}`,
      `    xrefs: ${refs.length ? refs.join("; ") : "未发现直接 VA 立即数引用"}`
    ].join("\n"));
  }
  return rows.length ? ["格式串证据链:", ...rows] : ["格式串证据链: 候选存在但未定位到原始偏移"];
}

function formatSpecifierCount(text) {
  const matches = String(text).match(/%(?!%)[-+# 0]?\d*(?:\.\d+)?[diuxX]/g);
  return matches ? matches.length : 0;
}

function decodePushImmediate(buffer, offset) {
  if (offset < 0 || offset >= buffer.length) return null;
  const op = buffer[offset];
  if (op === 0x68 && offset + 5 <= buffer.length) {
    return { offset, size: 5, value: buffer.readUInt32LE(offset + 1) >>> 0, opcode: "push imm32" };
  }
  if (op === 0x6a && offset + 2 <= buffer.length) {
    const raw = buffer.readInt8(offset + 1);
    return { offset, size: 2, value: raw, opcode: "push imm8" };
  }
  return null;
}

function inferFormatArguments(buffer, pe, text, stringOffset) {
  if (!pe.ok) return [];
  const loc = fileOffsetToVa(pe, stringOffset);
  const count = formatSpecifierCount(text);
  if (!loc || !count) return [];
  const pat = packU32(loc.va);
  const results = [];
  let pos = 0;
  while ((pos = buffer.indexOf(pat, pos)) !== -1) {
    if (pos === stringOffset) {
      pos += 1;
      continue;
    }
    const instrStart = pos > 0 && buffer[pos - 1] === 0x68 ? pos - 1 : pos;
    const refLoc = fileOffsetToVa(pe, pos);
    const scanStart = Math.max(0, instrStart - 96);
    const pushes = [];
    for (let i = scanStart; i < instrStart;) {
      const push = decodePushImmediate(buffer, i);
      if (push) {
        pushes.push(push);
        i += push.size;
      } else {
        i += 1;
      }
    }
    const argumentPushes = pushes.slice(-count);
    if (argumentPushes.length !== count) {
      pos += 1;
      continue;
    }
    const args = argumentPushes.map(p => p.value).reverse();
    let inferred = String(text);
    for (const arg of args) {
      inferred = inferred.replace(/%(?!%)[-+# 0]?\d*(?:\.\d+)?[diuxX]/, String(arg));
    }
    results.push({
      refRaw: pos,
      refVa: refLoc?.va,
      args,
      pushes: argumentPushes,
      inferred
    });
    pos += 1;
    if (results.length >= 8) break;
  }
  return results;
}

function formatInferredFormatEvidence(buffer, pe, candidates) {
  if (!pe.ok || !candidates.length) return [];
  const rows = [];
  for (const text of candidates.slice(0, 20)) {
    const offset = locateString(buffer, text);
    if (offset === null) continue;
    const loc = fileOffsetToVa(pe, offset);
    const inferred = inferFormatArguments(buffer, pe, text, offset);
    for (const item of inferred) {
      rows.push([
        `  format=${text}`,
        `    format raw=0x${offset.toString(16)}${loc ? ` VA=0x${loc.va.toString(16)} section=${loc.section}` : ""}`,
        `    xref raw=0x${item.refRaw.toString(16)}${item.refVa ? ` VA~=0x${item.refVa.toString(16)}` : ""}`,
        `    push-immediates-before-format=${item.pushes.map(p => `${p.opcode}@raw=0x${p.offset.toString(16)} value=${p.value}`).join("; ")}`,
        `    printf-order-args=${item.args.join(", ")}`,
        `    inferred=${item.inferred.trim()}`
      ].join("\n"));
    }
  }
  return rows.length ? ["格式串参数确定性推导:", ...rows] : ["格式串参数确定性推导: 未发现足够的 push 立即数参数证据"];
}

function analyzeBinaryFile(filePath, buffer) {
  const strings = asciiStrings(buffer, 4, 800);
  const flagLike = uniqueStrings(strings.filter(s => /(flag|ctf|bjd|hack|key|pass|serial|you found|find me|correct|wrong|success|fail|\{[^}]{3,80}\})/i.test(s)), 80);
  const formatLike = uniqueStrings(strings.filter(s =>
    /%[-+# 0]?\d*(?:\.\d+)?[diuxXscp]/.test(s) ||
    /[A-Za-z0-9_]+\{[^}]*%[^}]*\}/.test(s) ||
    /\{[^}]*\}/.test(s)
  ), 80);
  const exactFlags = uniqueStrings([
    ...[...buffer.toString("latin1").matchAll(/flag\{[^}]{1,120}\}/gi)].map(m => m[0]),
    ...[...buffer.toString("latin1").matchAll(/[A-Z0-9_]{2,16}\{[^}]{1,120}\}/g)].map(m => m[0])
  ], 80);
  const signatures = [];
  const sigs = [
    ["MZ", Buffer.from("4d5a", "hex")],
    ["PNG", Buffer.from("89504e470d0a1a0a", "hex")],
    ["ZIP", Buffer.from("504b0304", "hex")],
    ["JPEG", Buffer.from("ffd8ff", "hex")],
    ["PDF", Buffer.from("%PDF")]
  ];
  for (const [name, sig] of sigs) {
    let pos = 0;
    while ((pos = buffer.indexOf(sig, pos)) !== -1) {
      signatures.push(`${name}@0x${pos.toString(16)}`);
      pos += Math.max(1, sig.length);
      if (signatures.length > 40) break;
    }
  }
  const outerPe = analyzePeLike(buffer, 0);
  const nested = [];
  const invalidMz = [];
  for (let pos = 1; (pos = buffer.indexOf(Buffer.from("MZ"), pos)) !== -1; pos += 2) {
    const candidate = analyzePeLike(buffer.subarray(pos), pos);
    if (candidate.ok) nested.push(candidate);
    else invalidMz.push(`MZ@0x${pos.toString(16)} (${candidate.reason || "invalid"})`);
    if (nested.length >= 5) break;
  }
  return [
    "【宿主确定性二进制分析】",
    `路径: ${filePath}`,
    formatPeAnalysis("外层", outerPe),
    nested.length ? nested.map((pe, i) => formatPeAnalysis(`内嵌 PE #${i + 1}`, pe)).join("\n") : "内嵌 PE: 未发现有效嵌套 PE",
    invalidMz.length ? `无效 MZ 候选: ${invalidMz.slice(0, 20).join(", ")}` : "无效 MZ 候选: 未发现",
    `文件签名位置: ${signatures.join(", ") || "未发现常见嵌入签名"}`,
    "精确花括号/flag 候选:",
    ...(exactFlags.length ? exactFlags.map(s => `  ${s}`) : ["  未发现明确 flag{...}/XXX{...} 字符串"]),
    "格式串/待求值候选:",
    ...(formatLike.length ? formatLike.map(s => `  ${s}`) : ["  未发现含 %d/%x/%s 或花括号格式串"]),
    ...formatStringEvidence(buffer, outerPe, formatLike),
    ...formatInferredFormatEvidence(buffer, outerPe, formatLike),
    "可疑/关键字符串:",
    ...(flagLike.length ? flagLike.map(s => `  ${s}`) : ["  未发现 flag/ctf/hack/key/pass 等关键词字符串"]),
    "普通字符串前 120 项:",
    ...strings.slice(0, 120).map(s => `  ${s}`)
  ].join("\n");
}

function ensureAppDir() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const dir of [
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
    "sqlite"
  ]) {
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
  const marketplace = path.join(APP_DIR, "marketplace.json");
  if (!fs.existsSync(marketplace)) {
    fs.writeFileSync(marketplace, JSON.stringify({
      name: "personal",
      interface: { displayName: "Personal" },
      plugins: []
    }, null, 2), "utf8");
  }
  const version = path.join(APP_DIR, "version.json");
  if (!fs.existsSync(version)) {
    fs.writeFileSync(version, JSON.stringify({
      latest_version: "0.1.0",
      last_checked_at: new Date().toISOString(),
      dismissed_version: null
    }, null, 2), "utf8");
  }
  for (const file of ["session_index.jsonl", "history.jsonl", "AGENTS.md"]) {
    const target = path.join(APP_DIR, file);
    if (!fs.existsSync(target)) fs.writeFileSync(target, "", "utf8");
  }
  const auth = path.join(APP_DIR, "auth.json");
  if (!fs.existsSync(auth)) {
    fs.writeFileSync(auth, JSON.stringify({
      api_key_configured: false,
      web_login: { provider: "deepseek-chat", oauth_pending: true }
    }, null, 2), "utf8");
  }
}

function loadConfig() {
  ensureAppDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    writeConfigToml(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
    writeConfigToml(config);
    return config;
  } catch {
    writeConfigToml(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  ensureAppDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  writeConfigToml(next);
  return next;
}

function writeConfigToml(config) {
  const configToml = path.join(APP_DIR, "config.toml");
  const toml = [
    `model = "${config.model || "deepseek-chat"}"`,
    `reasoner_model = "${config.reasonerModel || "deepseek-reasoner"}"`,
    `base_url = "${config.baseUrl || "https://api.deepseek.com"}"`,
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
    `[projects.'${String(config.workspace || "D:\\deepseek").replaceAll("\\", "\\\\")}']`,
    'trust_level = "trusted"',
    ""
  ].join("\n");
  fs.writeFileSync(configToml, toml, "utf8");
}

function publicConfig(config = loadConfig()) {
  return {
    ...config,
    apiKey: config.apiKey ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}` : ""
  };
}

function sessionDir() {
  ensureAppDir();
  return path.join(APP_DIR, "sessions");
}

function archivedSessionDir() {
  ensureAppDir();
  return path.join(APP_DIR, "archived_sessions");
}

function memoryDir() {
  ensureAppDir();
  return path.join(APP_DIR, "memories");
}

function safeSessionId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function sessionPath(id) {
  return path.join(sessionDir(), `${safeSessionId(id)}.json`);
}

function writeSessionIndex() {
  const rows = fs.readdirSync(sessionDir())
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessionDir(), name), "utf8"));
        return {
          id: data.id,
          thread_name: data.title || "新对话",
          updated_at: data.updatedAt || new Date().toISOString()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  fs.writeFileSync(path.join(APP_DIR, "session_index.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  return rows;
}

function writeArchiveIndex() {
  const rows = fs.readdirSync(archivedSessionDir())
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(archivedSessionDir(), name), "utf8"));
        return {
          id: data.id,
          thread_name: data.title || "已归档会话",
          archived_at: data.archivedAt || data.updatedAt || new Date().toISOString()
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
  fs.writeFileSync(path.join(APP_DIR, "archived_session_index.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  return rows;
}

function listSessions() {
  return writeSessionIndex().slice(0, 50).map(row => {
    try {
      return JSON.parse(fs.readFileSync(sessionPath(row.id), "utf8"));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function listArchivedSessions() {
  return writeArchiveIndex().slice(0, 100).map(row => {
    try {
      return JSON.parse(fs.readFileSync(path.join(archivedSessionDir(), `${safeSessionId(row.id)}.json`), "utf8"));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function archiveSession(id) {
  const safeId = safeSessionId(id);
  if (!safeId) throw new Error("会话 ID 无效。");
  const source = sessionPath(safeId);
  if (!fs.existsSync(source)) throw new Error("未找到会话。");
  const data = JSON.parse(fs.readFileSync(source, "utf8"));
  data.archivedAt = new Date().toISOString();
  fs.writeFileSync(path.join(archivedSessionDir(), `${safeId}.json`), JSON.stringify(data, null, 2), "utf8");
  fs.unlinkSync(source);
  writeSessionIndex();
  writeArchiveIndex();
  return data;
}

function restoreSession(id) {
  const safeId = safeSessionId(id);
  if (!safeId) throw new Error("会话 ID 无效。");
  const source = path.join(archivedSessionDir(), `${safeId}.json`);
  if (!fs.existsSync(source)) throw new Error("未找到归档会话。");
  const data = JSON.parse(fs.readFileSync(source, "utf8"));
  delete data.archivedAt;
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(safeId), JSON.stringify(data, null, 2), "utf8");
  fs.unlinkSync(source);
  writeSessionIndex();
  writeArchiveIndex();
  return data;
}

function memoryPath(id) {
  return path.join(memoryDir(), `${safeSessionId(id)}.json`);
}

function listMemories() {
  return fs.readdirSync(memoryDir())
    .filter(name => name.endsWith(".json"))
    .map(name => {
      try {
        return JSON.parse(fs.readFileSync(path.join(memoryDir(), name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function saveMemory(memory) {
  const now = new Date().toISOString();
  const id = safeSessionId(memory.id || `${Date.now()}`);
  const data = {
    id,
    title: memory.title || "记忆",
    content: memory.content || "",
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    source: memory.source || "user",
    createdAt: memory.createdAt || now,
    updatedAt: now
  };
  fs.writeFileSync(memoryPath(id), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function deleteMemory(id) {
  const target = memoryPath(id);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
}

function memoryContext(limit = 8) {
  const memories = listMemories().filter(item => item.content).slice(0, limit);
  if (!memories.length) return "";
  return [
    "【长期记忆】",
    ...memories.map(item => `- ${item.title}: ${item.content}`)
  ].join("\n");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "DeepSeek",
    icon: path.join(__dirname, "assets", "deepseek.ico"),
    backgroundColor: "#171717",
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });
  const reactIndex = path.resolve(__dirname, "..", "desktop-ui", "dist", "index.html");
  mainWindow.loadFile(fs.existsSync(reactIndex) ? reactIndex : path.join(__dirname, "renderer.html"));
}

function sendMenu(action, payload = {}) {
  mainWindow?.webContents.send("menu:action", { action, payload });
}

function createAppMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "关闭窗口", accelerator: "Ctrl+W", click: () => mainWindow?.close() },
        { label: "新建窗口", accelerator: "Ctrl+Shift+N", click: createWindow },
        { label: "新对话", accelerator: "Ctrl+N", click: () => sendMenu("new-chat") },
        { label: "快速对话", accelerator: "Alt+Ctrl+N", click: () => sendMenu("quick-chat") },
        { label: "归档当前对话", accelerator: "Ctrl+Shift+W", click: () => sendMenu("archive-chat") },
        {
          label: "打开文件夹...",
          accelerator: "Ctrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
            if (!result.canceled && result.filePaths[0]) {
              saveConfig({ workspace: result.filePaths[0] });
              sendMenu("workspace-changed", { workspace: result.filePaths[0] });
            }
          }
        },
        { type: "separator" },
        { label: "设置...", accelerator: "Ctrl+,", click: () => sendMenu("settings") },
        { type: "separator" },
        { label: "关于 DeepSeek", click: () => dialog.showMessageBox(mainWindow, { type: "info", title: "关于 DeepSeek", message: "DeepSeek 桌面端", detail: "Windows CLI 与桌面端 Agent 原型。" }) },
        { label: "退出登录", click: async () => { await session.fromPartition("persist:deepseek-login").clearStorageData(); saveConfig({ apiKey: "" }); sendMenu("logged-out"); } },
        { label: "退出", click: () => app.quit() }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" }
      ]
    },
    {
      label: "查看",
      submenu: [
        { label: "搜索", accelerator: "Ctrl+K", click: () => sendMenu("search") },
        { label: "显示/隐藏左边栏", accelerator: "Ctrl+B", click: () => sendMenu("toggle-left") },
        { label: "显示/隐藏右侧工作区", accelerator: "Ctrl+Shift+B", click: () => sendMenu("toggle-right") },
        { type: "separator" },
        { label: "插件", accelerator: "Ctrl+Shift+P", click: () => sendMenu("plugins") },
        { label: "自动化", click: () => sendMenu("automations") },
        { type: "separator" },
        { label: "重新加载", role: "reload" },
        { label: "开发者工具", role: "toggleDevTools" },
        { label: "重置缩放", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { label: "全屏", role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "缩放", role: "zoom" },
        { type: "separator" },
        { label: "打开终端", accelerator: "Ctrl+`", click: () => sendMenu("open-terminal") },
        { label: "打开浏览器", click: () => sendMenu("open-browser") },
        { label: "打开文件", click: () => sendMenu("open-files") }
      ]
    },
    {
      label: "帮助",
      submenu: [
        { label: "DeepSeek 登录", click: () => createLoginWindow() },
        { label: "DeepSeek API 文档", click: () => shell.openExternal("https://api-docs.deepseek.com/") },
        { label: "DeepSeek Chat 网页", click: () => shell.openExternal("https://chat.deepseek.com/") },
        { type: "separator" },
        { label: "显示配置文件", click: () => shell.showItemInFolder(CONFIG_PATH) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return true;
  }
  loginWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    title: "DeepSeek 登录",
    icon: path.join(__dirname, "assets", "deepseek.ico"),
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:deepseek-login",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  loginWindow.loadURL("https://chat.deepseek.com/");
  loginWindow.on("closed", () => {
    loginWindow = null;
    mainWindow?.webContents.send("login-status", { state: "closed" });
  });
  return true;
}

async function loginStatus() {
  const cookies = await session.fromPartition("persist:deepseek-login").cookies.get({ domain: "chat.deepseek.com" });
  return {
    hasDeepSeekSession: cookies.length > 0,
    cookieCount: cookies.length,
    note: "DeepSeek does not expose a public Codex-style desktop OAuth token flow here; API requests use API key config."
  };
}

async function callDeepSeek({ messages, model }) {
  const config = loadConfig();
  const apiKey = process.env.DEEPSEEK_API_KEY || config.apiKey;
  if (!apiKey) {
    throw new Error("缺少 API 密钥。请在设置页填写 DeepSeek API 密钥，或设置 DEEPSEEK_API_KEY。");
  }
  const trimmed = messages.slice(-Number(config.maxContextMessages || 24));
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || config.model,
      messages: trimmed,
      temperature: Number(config.temperature ?? 0.2),
      stream: false
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 1200)}`);
  }
  const body = await res.json();
  return {
    content: body.choices?.[0]?.message?.content || "",
    reasoningContent: body.choices?.[0]?.message?.reasoning_content || "",
    usage: body.usage || null,
    rawModel: body.model || model || config.model
  };
}

async function callDeepSeekStream({ messages, model }, onChunk) {
  const config = loadConfig();
  const apiKey = process.env.DEEPSEEK_API_KEY || config.apiKey;
  if (!apiKey) {
    throw new Error("缺少 API 密钥。请在设置页填写 DeepSeek API 密钥，或设置 DEEPSEEK_API_KEY。");
  }
  const trimmed = messages.slice(-Number(config.maxContextMessages || 24));
  const url = `${config.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || config.model,
      messages: trimmed,
      temperature: Number(config.temperature ?? 0.2),
      stream: true
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 1200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let reasoningContent = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") { onChunk({ content: "", done: true }); continue; }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta || {};
        if (delta.content) {
          fullContent += delta.content;
          onChunk({ content: delta.content, fullContent, done: false });
        }
        if (delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }
      } catch (e) { /* skip unparseable SSE lines */ }
    }
  }
  onChunk({ done: true, content: "", fullContent });
  
  return {
    content: fullContent,
    reasoningContent,
    rawModel: model || config.model,
    usage: null
  };
}

function cacheStatsFor(messages, model, usage) {
  ensureAppDir();
  const stablePrefix = JSON.stringify({ model, system: messages.filter(m => m.role === "system").map(m => m.content), tools: ["files", "browser", "terminal", "side-chat"] });
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
  return {
    key,
    prompt,
    completion: usage?.completion_tokens ?? 0,
    total: usage?.total_tokens ?? prompt + (usage?.completion_tokens ?? 0),
    hit,
    miss,
    hitRatio: prompt ? hit / prompt : 0,
    seenBefore: previous.calls > 0
  };
}

function extractRequestedFilePath(text) {
  const raw = String(text || "");
  const filename = raw.match(/([A-Za-z0-9_\-. \u4e00-\u9fa5]+?\.(?:md|txt|py|js|ts|json|html|css|csv|log|toml|yaml|yml))/i)?.[1]?.trim();
  if (!filename) return null;
  if (/[\\/:]/.test(filename) && path.isAbsolute(filename)) return path.resolve(filename);
  if (/桌面|desktop/i.test(raw)) return path.join(os.homedir(), "Desktop", filename);
  return path.join(loadConfig().workspace || "D:\\deepseek", filename);
}

function contentForSaveRequest(messages, fallback) {
  const userText = messages.filter(m => m.role === "user").at(-1)?.content || "";
  const fenced = String(userText).match(/```[^\n]*\n([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) return fenced[1].trim() + "\n";
  const previousAssistant = [...messages].reverse().find(m => m.role === "assistant" && m.content)?.content;
  return String(previousAssistant || fallback || "").trim() + "\n";
}

function maybeSaveRequestedFile(userText, messages, assistantText) {
  const raw = String(userText || "");
  if (/(谁让你保存|不要保存|不用保存|别保存|只读取|读一下|读取这篇|分析这篇|审查这篇)/i.test(raw)) return null;
  const explicitSave = /(保存到|保存为|存到|写入到|创建文件|生成到|导出到|save\s+(?:as|to)|write\s+(?:to|file)|create\s+file)/i.test(raw);
  if (!explicitSave) return null;
  const target = extractRequestedFilePath(userText);
  if (!target) return null;
  const config = effectiveConfig(loadConfig());
  const workspace = path.resolve(config.workspace || "D:\\deepseek");
  const desktop = path.join(os.homedir(), "Desktop");
  const allowed = normalizeInside(target, workspace) || normalizeInside(target, desktop) || target.toLowerCase() === desktop.toLowerCase() || config.sandboxMode === "danger-full-access";
  if (!allowed) throw new Error("拒绝写入未授权路径。请保存到当前工作区或桌面。");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = contentForSaveRequest(messages, assistantText);
  fs.writeFileSync(target, content, "utf8");
  return { path: target, bytes: Buffer.byteLength(content, "utf8") };
}

function compactConversationContext(messages = [], maxMessages = 10, maxChars = 6000) {
  const relevant = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-maxMessages);
  if (!relevant.length) return "";
  const lines = relevant.map((m, index) => {
    const content = String(m.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 900);
    return `${index + 1}. ${m.role}: ${content}`;
  });
  return [
    "【最近对话上下文】",
    "下面是本轮请求之前/包含本轮的最近消息。若用户说“重写/继续/再来/它/这个/上面”，必须先解析这些指代，不要声称无历史记录。",
    ...lines
  ].join("\n").slice(0, maxChars);
}

function normalizeUrl(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function assertNetworkAllowed(url, config = loadConfig()) {
  config = effectiveConfig(config);
  if (config.network?.enabled === false) throw new Error("联网功能已关闭。");
  const allowed = config.network?.allowedDomains || [];
  if (!allowed.length) return;
  const host = new URL(url).hostname.toLowerCase();
  const ok = allowed.some(domain => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`));
  if (!ok) throw new Error(`域名不在允许列表：${host}`);
}

function textFromHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWebText(url) {
  const target = normalizeUrl(url);
  assertNetworkAllowed(target);
  const res = await fetch(target, { headers: { "User-Agent": "DeepSeekWindows/0.1" } });
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  const text = contentType.includes("html") ? textFromHtml(body) : body;
  return { url: res.url, status: res.status, contentType, text: text.slice(0, 8000) };
}

async function searchWeb(query) {
  const target = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const result = await fetchWebText(target);
  return { ...result, query };
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>)"'，。]+/gi)].map(match => match[0]).slice(0, 4);
}

async function maybeCollectWebContext(userText, emit) {
  if (!userText) return "";
  const wantsWeb = /(上网|联网|网页|网站|搜索|搜寻|查找|检索|browse|search|fetch|http)/i.test(userText);
  if (!wantsWeb) return "";
  const blocks = [];
  for (const url of extractUrls(userText)) {
    try {
      emit("联网", `抓取 ${url}`, { type: "tool.web" });
      const page = await fetchWebText(url);
      blocks.push(`URL: ${page.url}\n状态: ${page.status}\n内容摘要:\n${page.text}`);
    } catch (err) {
      blocks.push(`URL: ${url}\n抓取失败: ${err.message}`);
    }
  }
  if (!blocks.length) {
    const q = userText.replace(/\s+/g, " ").slice(0, 180);
    try {
      emit("联网", `搜索：${q}`, { type: "tool.web" });
      const page = await searchWeb(q);
      blocks.push(`搜索查询: ${q}\n搜索页: ${page.url}\n结果摘要:\n${page.text.slice(0, 6000)}`);
    } catch (err) {
      blocks.push(`搜索失败: ${err.message}`);
    }
  }
  return blocks.length ? `宿主联网结果：\n\n${blocks.join("\n\n---\n\n")}` : "";
}

function isFullAccess(config = loadConfig()) {
  const effective = effectiveConfig(config);
  return effective.sandboxMode === "danger-full-access" && effective.approvalPolicy === "never";
}

function runPowerShell(command, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd: path.resolve(loadConfig().workspace || "D:\\deepseek"),
      windowsHide: true
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, out: out.slice(-12000), err: `${err}\n命令超时。`.slice(-12000) });
    }, timeoutMs);
    child.stdout.on("data", d => { out += d.toString(); });
    child.stderr.on("data", d => { err += d.toString(); });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, out: out.slice(-12000), err: err.slice(-12000) });
    });
  });
}

function extractWindowsPaths(text = "") {
  const matches = String(text).match(/[A-Za-z]:\\[^\r\n"'<>|?*]+/g) || [];
  return [...new Set(matches.map(item => item.trim().replace(/[，。；;,.]+$/, "")))].slice(0, 6);
}

function extractMentionedFilenames(text = "") {
  const matches = String(text).match(/[A-Za-z0-9_\-. \u4e00-\u9fa5]+?\.(?:exe|dll|sys|bin|elf|pcap|pcapng|zip|tar|gz|tgz|7z|rar|iso|img|png|jpg|jpeg|gif|webp|txt|md|py|js|json|log)/gi) || [];
  return [...new Set(matches
    .map(item => path.basename(item.trim().replace(/[，。；;,.]+$/, "")))
    .filter(name => name && !/^(powershell|python|node)\.exe$/i.test(name)))].slice(0, 8);
}

function resolveMentionedFilePaths(text = "") {
  const direct = extractWindowsPaths(text);
  const resolved = [...direct];
  const searchRoots = [
    "D:\\edgedownload",
    path.resolve(loadConfig().workspace || "D:\\deepseek"),
    "D:\\deepseek",
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Downloads")
  ];
  for (const filename of extractMentionedFilenames(text)) {
    if (resolved.some(item => path.basename(item).toLowerCase() === filename.toLowerCase())) continue;
    for (const root of searchRoots) {
      const candidate = path.join(root, filename);
      if (fs.existsSync(candidate)) {
        resolved.push(candidate);
        break;
      }
    }
  }
  return [...new Set(resolved.map(item => path.resolve(item)))].slice(0, 6);
}

function targetTextForLocalContext(messages = [], userText = "") {
  const current = String(userText || "");
  if (resolveMentionedFilePaths(current).length) return current;
  const recent = (Array.isArray(messages) ? messages : [])
    .filter(m => m && m.role === "user")
    .map(m => String(m.content || ""))
    .reverse();
  const lastTarget = recent.find(text => resolveMentionedFilePaths(text).length);
  if (!lastTarget) return current;
  return [
    current,
    "【最近一次文件目标，仅用于解析当前“继续/第二题/这个文件”等指代；不得回退到更早文件】",
    lastTarget
  ].join("\n");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function collectFilePathContext(userText, emit) {
  const paths = resolveMentionedFilePaths(userText);
  if (!paths.length) return "";
  const blocks = [];
  for (const target of paths) {
    try {
      if (!fs.existsSync(target)) {
        blocks.push(`文件路径：${target}\n状态：不存在或当前用户不可见。`);
        continue;
      }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 80).map(entry => {
          const full = path.join(target, entry.name);
          let size = "";
          try { size = entry.isFile() ? String(fs.statSync(full).size) : ""; } catch {}
          return `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}${size ? ` (${size} bytes)` : ""}`;
        });
        blocks.push(`目录已真实读取：${target}\n${entries.join("\n")}`);
        continue;
      }
      const attachment = readAttachmentFile(target);
      blocks.push([
        `文件已真实读取：${attachment.path}`,
        `名称：${attachment.name}`,
        `大小：${attachment.size} bytes${attachment.truncated ? "（正文未自动注入）" : ""}`,
        "内容/摘要：",
        attachment.content
      ].join("\n"));
      if (/\.(zip|jar|docx|xlsx|pptx)$/i.test(target)) {
        emit("本地", `列出压缩包结构 ${path.basename(target)}`, { type: "tool.local" });
        const result = await runPowerShell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead(${shellQuote(target)}).Entries | Select-Object -First 120 FullName,Length | Format-Table -AutoSize | Out-String -Width 240`);
        blocks.push(`压缩包目录结构：\n退出码: ${result.code}\n${result.out || result.err || "(empty)"}`);
      }
      if (/\.(tar|gz|tgz)$/i.test(target)) {
        emit("本地", `列出 tar/gz 结构 ${path.basename(target)}`, { type: "tool.local" });
        const result = await runPowerShell(`if (Get-Command tar -ErrorAction SilentlyContinue) { tar -tf ${shellQuote(target)} 2>&1 | Select-Object -First 160 | Out-String -Width 240 } else { '缺少 tar 命令；已完成文件读取，可安装 bsdtar/Git for Windows tar 后解析内部结构。' }`);
        blocks.push(`tar/gz 目录结构：\n退出码: ${result.code}\n${result.out || result.err || "(empty)"}`);
      }
      if (/\.(7z|rar|iso|img)$/i.test(target)) {
        emit("本地", `尝试列出归档/镜像 ${path.basename(target)}`, { type: "tool.local" });
        const result = await runPowerShell(`$seven = (Get-Command 7z -ErrorAction SilentlyContinue).Source; if (!$seven) { $p = @('C:\\Program Files\\7-Zip\\7z.exe','C:\\Program Files (x86)\\7-Zip\\7z.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($p) { $seven = $p } }; if ($seven) { & $seven l ${shellQuote(target)} | Select-Object -First 180 | Out-String -Width 260 } else { '缺少 7-Zip 命令；已完成文件读取，可安装 7-Zip 后列出 7z/rar/iso/img 内部结构。' }`);
        blocks.push(`归档/镜像目录结构：\n退出码: ${result.code}\n${result.out || result.err || "(empty)"}`);
      }
      if (/\.(pcap|pcapng)$/i.test(target)) {
        emit("本地", `尝试解析抓包 ${path.basename(target)}`, { type: "tool.local" });
        const result = await runPowerShell(`if (Get-Command tshark -ErrorAction SilentlyContinue) { tshark -r ${shellQuote(target)} -c 30 } else { Format-Hex -Path ${shellQuote(target)} -Count 256 | Out-String -Width 240 }`);
        blocks.push(`抓包预览：\n退出码: ${result.code}\n${result.out || result.err || "(empty)"}`);
      }
      if (/\.(exe|dll|sys|bin|elf)$/i.test(target)) {
        emit("本地", `分析二进制 ${path.basename(target)}`, { type: "tool.local" });
        const result = await runPowerShell(`$p=${shellQuote(target)}; $h=Get-FileHash -Algorithm SHA256 $p; $s=Get-Item $p; $hex=Format-Hex -Path $p -Count 512 | Out-String -Width 260; $sig=''; try { $sig=(Get-AuthenticodeSignature $p | Format-List | Out-String -Width 260) } catch {}; $strings=''; if (Get-Command strings -ErrorAction SilentlyContinue) { $strings=(strings $p | Select-Object -First 120 | Out-String -Width 260) } else { $strings='缺少 strings 命令；已输出哈希、签名和文件头。' }; "路径: $p"; "大小: $($s.Length)"; "SHA256: $($h.Hash)"; "---签名---"; $sig; "---文件头---"; $hex; "---字符串预览---"; $strings`);
        blocks.push(`二进制分析预览：\n退出码: ${result.code}\n${result.out || result.err || "(empty)"}`);
        const disasm = await runPowerShell(`$p=${shellQuote(target)}; $obj=(Get-Command objdump -ErrorAction SilentlyContinue).Source; if ($obj) { "---导入/PE 目录---"; & $obj -x $p 2>&1 | Select-String -Pattern "DLL Name|SetWindowText|sprintf|wsprintf|DialogBox|GetDlgItem|SendMessage|LoadString|MessageBox|Entry|start address|NumberOfSections|\\.text|\\.data|\\.rsrc" | Select-Object -First 180 | Out-String -Width 260; "---关键反汇编片段---"; & $obj -D -Mintel $p 2>&1 | Select-String -Pattern "BJD|flag|CTF|HACK|4e1f|407030|SetWindowText|sprintf|wsprintf|cmp.*0x|push.*0x|call.*4060|call.*401410" -Context 8,12 | Select-Object -First 240 | Out-String -Width 260 } else { "缺少 objdump；已完成 PE/strings 宿主分析，可安装 binutils 后生成反汇编关键路径。" }`, 20000);
        blocks.push(`逆向反汇编证据：\n退出码: ${disasm.code}\n${disasm.out || disasm.err || "(empty)"}`);
      }
    } catch (error) {
      blocks.push(`路径：${target}\n读取失败：${error.message}`);
    }
  }
  return `宿主文件系统结果：\n\n${blocks.join("\n\n---\n\n")}`;
}

async function maybeCollectLocalContext(userText, emit) {
  const text = String(userText || "");
  const fileContext = await collectFilePathContext(text, emit);
  if (!/(PowerShell|终端|环境变量|本地|模块|文件系统|执行命令|运行命令|powershell|env|module|读取|打开|文件|pcap|zip|exe|dll|bin|iso|img)/i.test(text)) return fileContext;
  if (!isFullAccess()) {
    return [
      fileContext,
      "宿主本地能力：当前不是“完全访问 + never”权限；可读取工作区和用户显式选择的附件，终端命令需要按权限策略确认。"
    ].filter(Boolean).join("\n\n");
  }
  const commands = [];
  if (/(环境变量|env)/i.test(text)) commands.push(["PowerShell 环境变量", "Get-ChildItem Env: | Sort-Object Name | Select-Object -First 80 Name,Value | Format-Table -AutoSize | Out-String -Width 220"]);
  if (/(模块|module)/i.test(text)) commands.push(["PowerShell 模块", "Get-Module -ListAvailable | Select-Object -First 80 Name,Version,ModuleBase | Format-Table -AutoSize | Out-String -Width 220"]);
  if (/(当前位置|工作区|pwd|目录)/i.test(text)) commands.push(["当前工作区", "Get-Location; Get-ChildItem -Force | Select-Object -First 60 Mode,Length,Name | Format-Table -AutoSize | Out-String -Width 220"]);
  if (!commands.length) {
    commands.push(["本地宿主状态", "$PSVersionTable | Out-String; '---'; Get-Location | Out-String"]);
  }
  const blocks = [];
  for (const [label, command] of commands) {
    emit("本地", `执行 ${label}`, { type: "tool.local" });
    const result = await runPowerShell(command);
    blocks.push(`${label}\n退出码: ${result.code}\nSTDOUT:\n${result.out || "(empty)"}\nSTDERR:\n${result.err || "(empty)"}`);
  }
  return [fileContext, `宿主本地执行结果：\n\n${blocks.join("\n\n---\n\n")}`].filter(Boolean).join("\n\n---\n\n");
}

async function runAgent(event, payload) {
  const started = Date.now();
  const config = effectiveConfig(loadConfig());
  const emit = (stage, detail = "", extra = {}) => {
    event.sender.send("agent:status", {
      stage,
      detail,
      elapsedMs: Date.now() - started,
      ...extra
    });
  };
  const userText = payload?.messages?.filter(m => m.role === "user").at(-1)?.content || "";
  emit("理解任务", "读取用户输入和当前对话上下文");
  emit("思考框架", "真实目标 → 上下文 → 宿主证据 → 假设/反证 → 执行 → 校验 → 交付", { type: "trace.protocol" });
  const conversationContext = compactConversationContext(payload?.messages || []);
  const localTargetText = targetTextForLocalContext(payload?.messages || [], userText);
  const webContext = await maybeCollectWebContext(userText, emit);
  const localContext = await maybeCollectLocalContext(localTargetText || userText, emit);
  const planPrompt = [
    {
      role: "system",
      content: [
        "你是 Agent Planner。不要输出隐藏思维链，只输出面向用户可审计的思考摘要。",
        "用户原始请求优先级最高；若用户要求只回答某个固定文本，则计划也必须保持这个约束。",
        OBJECTIVE_COMPLETION_PROTOCOL,
        CLAUDE_REASONIX_AGENT_PROTOCOL,
        VISIBLE_REASONING_PROTOCOL,
        CTF_RE_EVIDENCE_PROTOCOL,
        "宿主能力：可以联网抓取网页、搜索公开网页、读写授权文件、运行 PowerShell/终端命令。不要声称不能访问互联网、本地终端、PowerShell 环境变量或本地文件系统；若权限不足，应说明需要切换权限。",
        "严禁伪造命令输出、文件内容、反汇编、flag、运行结果或工具执行结果。没有宿主提供的证据时，只能说“尚未执行/尚无证据”，不能把计划写成结果。",
        "CTF/逆向/取证任务必须优先基于宿主提供的确定性分析结果（哈希、strings、PE 节区、overlay、嵌入签名、工具 stdout/stderr）。",
        "如果宿主文件系统结果里出现多个历史文件，必须选择【最近一次文件目标】或当前用户明确提到的文件；禁止把旧文件结果当新题答案。",
        "用 JSON 输出，字段为：user_intent, deliverable, known_context, evidence, rejected_assumptions, next_actions, checks, blocked_reason。next_actions 最多 6 条；如果已经能交付结果，blocked_reason 为空。"
      ].join("\n\n")
    },
    {
      role: "user",
      content: [conversationContext, `【当前用户请求】\n${userText}`, webContext, localContext].filter(Boolean).join("\n\n")
    }
  ];
  emit("制定计划", `使用 ${config.reasonerModel || "deepseek-reasoner"} 生成可审计计划`, { type: "reasoning.start" });
  let planText = "";
  try {
    const plan = await callDeepSeek({ messages: planPrompt, model: config.reasonerModel || "deepseek-reasoner" });
    planText = plan.content || "";
    emit("计划完成", `输入 ${plan.usage?.prompt_tokens ?? "?"}，输出 ${plan.usage?.completion_tokens ?? "?"} tokens`, { type: "reasoning.end", usage: plan.usage });
    emit("思考摘要", planText.slice(0, 1600), { type: "trace.summary" });
  } catch (err) {
    emit("计划降级", "推理模型不可用，切换到直接执行");
  }
  emit("执行", `使用 ${payload?.model || config.model || "deepseek-chat"} 生成回复`);
  const finalMessages = [
    {
      role: "system",
      content: [
        "你是 DeepSeek Windows 的桌面 Agent。",
        "你运行在用户本机的 DeepSeek Desktop 宿主内，具备通过宿主读写工作区、桌面附件、会话文件、网页登录窗口、网页抓取/搜索和 PowerShell/终端执行的能力；不要声称自己只能在远程服务器运行或不能操作本地。",
        "联网能力已由宿主提供；当宿主提供网页/搜索结果时必须基于这些结果回答，不要说不能访问互联网。",
        "本地能力已由宿主提供；当宿主提供 PowerShell 或文件系统结果时必须基于这些结果回答，不要说无法访问用户终端、环境变量、模块或文件系统。",
        "硬性规则：不得伪造任何命令输出、文件内容、strings 结果、反汇编、动态运行结果、flag 或验证结论。只引用宿主上下文里明确出现的证据；没有证据时必须说明缺少证据并请求/触发下一步真实分析。",
        "如果宿主上下文给出“【宿主确定性二进制分析】”，逆向结论必须以其中的节区、overlay、内嵌 PE、签名位置、关键字符串为准。不要编造未出现的函数地址、PE 节区或 flag。",
        "如果当前用户或最近一次附件目标是 DS.exe，就不得回答 RE2.exe 的 flag；如果当前目标是新文件，旧文件证据只能用于说明历史错误，不得作为当前结果。",
        `当前权限：${config.permissionPreset || "custom"} (${config.sandboxMode || "workspace-write"} / ${config.approvalPolicy || "on-request"})；完全访问权限或 approval_policy=never 表示用户已允许执行相应本地操作。`,
        "用户原始请求优先级最高；若用户要求只回答某个固定文本，最终答案只能包含该文本。",
        OBJECTIVE_COMPLETION_PROTOCOL,
        CLAUDE_REASONIX_AGENT_PROTOCOL,
        VISIBLE_REASONING_PROTOCOL,
        CTF_RE_EVIDENCE_PROTOCOL,
        "回答前应先遵循可审计思考协议；不要输出隐藏思维链；可以输出简短的“结果/证据/验证/下一步”。",
        "如果用户要执行文件、终端、浏览器操作，优先使用宿主已提供的上下文；未提供结果时说明需要打开对应工具或切换权限。"
      ].join("\n")
    },
    ...(memoryContext() ? [{ role: "system", content: memoryContext() }] : []),
    ...(conversationContext ? [{ role: "system", content: conversationContext }] : []),
    ...(webContext ? [{ role: "system", content: webContext }] : []),
    ...(localContext ? [{ role: "system", content: localContext }] : []),
    ...(payload?.messages || []),
    ...(planText ? [{ role: "system", content: `可审计计划摘要：\n${planText}` }] : [])
  ];
  const result = await callDeepSeek({ messages: finalMessages, model: payload?.model || config.model });
  const usage = cacheStatsFor(finalMessages, result.rawModel, result.usage);
  emit("用量", `输入 ${usage.prompt}，输出 ${usage.completion}，缓存命中 ${Math.round(usage.hitRatio * 100)}%`, { type: "usage", usage });
  const saved = maybeSaveRequestedFile(userText, payload?.messages || [], result.content);
  if (saved) {
    emit("文件", `已写入 ${saved.path}`, { type: "tool.file" });
    result.content = `已保存到本机：\n\n\`${saved.path}\`\n\n写入大小：${saved.bytes} bytes`;
  }
  emit("校验", "检查回复是否为空并整理输出");
  return {
    ...result,
    elapsedMs: Date.now() - started,
    plan: planText,
    cache: usage
  };
}

ipcMain.handle("config:get", () => publicConfig());
ipcMain.handle("config:save", (_event, patch) => publicConfig(saveConfig(patch)));
ipcMain.handle("config:path", () => CONFIG_PATH);
ipcMain.handle("config:home", () => os.homedir());

const DEFAULT_PLUGINS = [
  ["deepseek-api", "DeepSeek OpenAI-compatible API provider", "enabled", "◎"],
  ["GitHub", "Triage PRs, issues, CI, and publish flows", "planned", "◈"],
  ["网页搜索", "搜索网页并整理来源", "计划中", "◎"],
  ["终端", "按批准策略运行命令", "已禁用", "⌘"],
  ["工作区文件", "读取、索引并引用项目文件", "计划中", "▱"],
  ["浏览器", "打开网页并保留会话状态", "计划中", "◉"]
];
const DEFAULT_SKILLS = [
  ["代码审查", "审查变更并给出聚焦修复建议", "内置", "◇"],
  ["Web CTF", "Web 题目分析与利用流程", "内置", "⌁"],
  ["文档", "创建和编辑文档产物", "计划中", "▤"],
  ["表格", "创建和分析工作簿", "计划中", "▦"],
  ["演示文稿", "构建幻灯片", "计划中", "▧"],
  ["自动化", "周期检查、提醒和监控", "计划中", "◴"]
];

ipcMain.handle("config:plugins", () => {
  const pluginsDir = path.join(APP_DIR, "plugins");
  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith(".json"));
  if (!files.length) return DEFAULT_PLUGINS;
  const plugins = files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(pluginsDir, f), "utf8")); } catch { return null; }
  }).filter(Boolean).map(p => [p.name || p.id, p.description || "", p.enabled ? "enabled" : "disabled", p.icon || "◎"]);
  return plugins.length ? plugins : DEFAULT_PLUGINS;
});
ipcMain.handle("config:skills", () => DEFAULT_SKILLS);
ipcMain.handle("sessions:list", () => listSessions());
ipcMain.handle("sessions:list-archived", () => listArchivedSessions());
ipcMain.handle("sessions:save", (_event, sessionData) => {
  const id = safeSessionId(sessionData.id);
  if (!id) throw new Error("会话 ID 无效。");
  const now = new Date().toISOString();
  const data = {
    id,
    title: sessionData.title || "新对话",
    project: sessionData.project || "deepseek",
    time: sessionData.time || "现在",
    messages: Array.isArray(sessionData.messages) ? sessionData.messages : [],
    createdAt: sessionData.createdAt || now,
    updatedAt: now
  };
  fs.writeFileSync(sessionPath(id), JSON.stringify(data, null, 2), "utf8");
  writeSessionIndex();
  return data;
});
ipcMain.handle("sessions:archive", (_event, id) => archiveSession(id));
ipcMain.handle("sessions:restore", (_event, id) => restoreSession(id));
ipcMain.handle("sessions:delete", (_event, id) => {
  const safeId = safeSessionId(id);
  if (!safeId) throw new Error("会话 ID 无效。");
  const target = sessionPath(safeId);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  writeSessionIndex();
  return true;
});
ipcMain.handle("memory:list", () => listMemories());
ipcMain.handle("memory:save", (_event, memory) => saveMemory(memory));
ipcMain.handle("memory:delete", (_event, id) => deleteMemory(id));
ipcMain.handle("memory:context", () => memoryContext());
ipcMain.handle("login:open", () => createLoginWindow());
ipcMain.handle("login:status", () => loginStatus());
ipcMain.handle("chat:complete", async (_event, payload) => callDeepSeek(payload));
ipcMain.handle("agent:run", async (event, payload) => runAgent(event, payload));
ipcMain.handle("agent:run-stream", async (event, payload) => {
  const started = Date.now();
  const config = effectiveConfig(loadConfig());
  const emit = (stage, detail = "", extra = {}) => {
    event.sender.send("agent:status", { stage, detail, elapsedMs: Date.now() - started, ...extra });
  };
  const userText = payload?.messages?.filter(m => m.role === "user").at(-1)?.content || "";
  emit("理解任务", "读取用户输入和当前对话上下文");
  emit("思考框架", "真实目标 → 上下文 → 宿主证据 → 假设/反证 → 执行 → 校验 → 交付", { type: "trace.protocol" });
  const conversationContext = compactConversationContext(payload?.messages || []);
  const localTargetText = targetTextForLocalContext(payload?.messages || [], userText);
  const webContext = await maybeCollectWebContext(userText, emit);
  const localContext = await maybeCollectLocalContext(localTargetText || userText, emit);
  const planPrompt = [
    {
      role: "system",
      content: [
        "你是 Agent Planner。不要输出隐藏思维链，只输出面向用户可审计的思考摘要。",
        "用户原始请求优先级最高；若用户要求只回答某个固定文本，则计划也必须保持这个约束。",
        OBJECTIVE_COMPLETION_PROTOCOL,
        CLAUDE_REASONIX_AGENT_PROTOCOL,
        VISIBLE_REASONING_PROTOCOL,
        CTF_RE_EVIDENCE_PROTOCOL,
        "宿主能力：可以联网抓取网页、搜索公开网页、读写授权文件、运行 PowerShell/终端命令。不要声称不能访问互联网、本地终端、PowerShell 环境变量或本地文件系统；若权限不足，应说明需要切换权限。",
        "严禁伪造命令输出、文件内容、反汇编、flag、运行结果或工具执行结果。没有宿主提供的证据时，只能说尚未执行尚无证据，不能把计划写成结果。",
        "CTF/逆向/取证任务必须优先基于宿主提供的确定性分析结果。",
        "如果宿主文件系统结果里出现多个历史文件，必须选择【最近一次文件目标】或当前用户明确提到的文件；禁止把旧文件结果当新题答案。",
        "用 JSON 输出，字段为：user_intent, deliverable, known_context, evidence, rejected_assumptions, next_actions, checks, blocked_reason。next_actions 最多 6 条；如果已经能交付结果，blocked_reason 为空。"
      ].join("\n\n")
    },
    {
      role: "user",
      content: [conversationContext, `【当前用户请求】\n${userText}`, webContext, localContext].filter(Boolean).join("\n\n")
    }
  ];
  emit("制定计划", `使用 ${config.reasonerModel || "deepseek-reasoner"} 生成可审计计划`, { type: "reasoning.start" });
  let planText = "";
  try {
    const plan = await callDeepSeek({ messages: planPrompt, model: config.reasonerModel || "deepseek-reasoner" });
    planText = plan.content || "";
    emit("计划完成", `输入 ${plan.usage?.prompt_tokens ?? "?"}，输出 ${plan.usage?.completion_tokens ?? "?"} tokens`, { type: "reasoning.end", usage: plan.usage });
    emit("思考摘要", planText.slice(0, 1600), { type: "trace.summary" });
  } catch (err) {
    emit("计划降级", "推理模型不可用，切换到直接执行");
  }
  emit("执行", `使用 ${payload?.model || config.model || "deepseek-chat"} 流式生成回复`);
  const finalMessages = [
    {
      role: "system",
      content: [
        "你是 DeepSeek Windows 的桌面 Agent。",
        "你运行在用户本机的 DeepSeek Desktop 宿主内.",
        `当前权限：${config.permissionPreset || "custom"} (${config.sandboxMode || "workspace-write"} / ${config.approvalPolicy || "on-request"})`,
        OBJECTIVE_COMPLETION_PROTOCOL,
        CLAUDE_REASONIX_AGENT_PROTOCOL,
        VISIBLE_REASONING_PROTOCOL,
        CTF_RE_EVIDENCE_PROTOCOL,
      ].join("\n")
    },
    ...(memoryContext() ? [{ role: "system", content: memoryContext() }] : []),
    ...(conversationContext ? [{ role: "system", content: conversationContext }] : []),
    ...(webContext ? [{ role: "system", content: webContext }] : []),
    ...(localContext ? [{ role: "system", content: localContext }] : []),
    ...(payload?.messages || []),
    ...(planText ? [{ role: "system", content: `可审计计划摘要：\n${planText}` }] : [])
  ];
  const result = await callDeepSeekStream(
    { messages: finalMessages, model: payload?.model || config.model },
    (chunk) => event.sender.send("agent:chunk", chunk)
  );
  const usage = cacheStatsFor(finalMessages, result.rawModel, { prompt_tokens: 0, completion_tokens: 0 });
  emit("用量", `流式完成，模型 ${result.rawModel}`, { type: "usage", usage });
  const saved = maybeSaveRequestedFile(userText, payload?.messages || [], result.content);
  if (saved) {
    emit("文件", `已写入 ${saved.path}`, { type: "tool.file" });
    result.content = `已保存到本机：${saved.path} 写入大小：${saved.bytes} bytes`;
  }
  emit("校验", "检查回复是否为空并整理输出");
  return {
    ...result,
    elapsedMs: Date.now() - started,
    plan: planText,
    cache: usage
  };
});
function expandHome(dir) {
  if (typeof dir === "string" && dir.startsWith("~")) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return dir;
}
ipcMain.handle("files:list", async (_event, dir) => {
  const config = loadConfig();
  const effective = effectiveConfig(config);
  const root = path.resolve(config.workspace || "D:\\deepseek");
  const target = path.resolve(expandHome(dir || root));
  if (!normalizeInside(target, root) && !(effective.sandboxMode === "danger-full-access" && effective.approvalPolicy === "never")) {
    throw new Error("拒绝列出工作区之外的文件。");
  }
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter(entry => !["node_modules", ".git", "dist"].includes(entry.name))
    .slice(0, 120)
    .map(entry => {
      const fullPath = path.join(target, entry.name);
      return {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? "dir" : "file"
      };
    });
  return { root, cwd: target, parent: target === root ? null : path.dirname(target), entries };
});
ipcMain.handle("file:open", async (_event, filePath) => {
  const config = loadConfig();
  const effective = effectiveConfig(config);
  const root = path.resolve(config.workspace || "D:\\deepseek");
  const target = path.resolve(filePath);
  if (!normalizeInside(target, root) && !grantedFiles.has(target.toLowerCase()) && !(effective.sandboxMode === "danger-full-access" && effective.approvalPolicy === "never")) {
    throw new Error("拒绝打开工作区之外的文件。");
  }
  await shell.openPath(target);
  return true;
});
ipcMain.handle("files:pick-attachments", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择附件",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "常用文本/代码/图片/文档", extensions: ["txt", "md", "json", "toml", "yaml", "yml", "js", "jsx", "ts", "tsx", "css", "html", "py", "ps1", "rs", "go", "java", "c", "cpp", "cs", "sql", "log", "csv", "png", "jpg", "jpeg", "gif", "webp", "pdf"] },
      { name: "CTF/网安二进制与归档", extensions: ["pcap", "pcapng", "zip", "tar", "gz", "7z", "rar", "exe", "dll", "bin", "dat", "iso", "img", "elf", "apk", "jar"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  if (result.canceled) return [];
  for (const filePath of result.filePaths) grantedFiles.add(path.resolve(filePath).toLowerCase());
  return result.filePaths.map(readAttachmentFile);
});
ipcMain.handle("files:attach-paths", async (_event, filePaths) => {
  const paths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
  for (const filePath of paths) grantedFiles.add(path.resolve(filePath).toLowerCase());
  return paths.map(readAttachmentFile);
});
ipcMain.handle("file:read", async (_event, filePath) => readAttachmentFile(filePath));
ipcMain.handle("browser:open", async (_event, url) => {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  assertNetworkAllowed(target);
  await shell.openExternal(target);
  return target;
});
ipcMain.handle("terminal:run", async (_event, command) => new Promise((resolve) => {
  const config = effectiveConfig(loadConfig());
  const cwd = path.resolve(config.workspace || "D:\\deepseek");
  const blocked = [
    /remove-item\b.*\b-recurse\b/i,
    /\bdel\b.*\s\/s\b/i,
    /\brd\b.*\s\/s\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bformat\b/i,
    /\bcipher\s+\/w\b/i
  ];
  if (blocked.some(pattern => pattern.test(command)) && !isFullAccess(config)) {
    resolve({ code: 126, out: "", err: "已被安全策略拦截。" });
    return;
  }
  const child = spawn(command, { cwd, shell: true, windowsHide: true });
  let out = "";
  let err = "";
  child.stdout.on("data", d => { out += d.toString(); });
  child.stderr.on("data", d => { err += d.toString(); });
  child.on("close", code => resolve({ code, out: out.slice(-12000), err: err.slice(-12000), cwd }));
}));

const terminalSessions = new Map();

ipcMain.handle("terminal:create", async (_event, id) => {
  if (terminalSessions.has(id)) return { id };
  const config = loadConfig();
  const cwd = path.resolve(config.workspace || "D:\\deepseek");
  const shellExe = "powershell.exe";
  const args = ["-NoLogo", "-NoExit", "-Command", "-"];
  const child = spawn(shellExe, args, { cwd, windowsHide: true });
  terminalSessions.set(id, child);
  const send = (kind, data) => mainWindow?.webContents.send("terminal:data", { id, kind, data: data.toString() });
  child.stdout.on("data", d => send("stdout", d));
  child.stderr.on("data", d => send("stderr", d));
  child.on("close", code => {
    terminalSessions.delete(id);
    mainWindow?.webContents.send("terminal:data", { id, kind: "exit", data: String(code ?? "") });
  });
  mainWindow?.webContents.send("terminal:data", { id, kind: "stdout", data: `交互式终端已启动：${cwd}\r\n` });
  return { id, cwd };
});

ipcMain.handle("terminal:write", async (_event, id, input) => {
  const child = terminalSessions.get(id);
  if (!child) throw new Error("未找到终端会话。");
  const blocked = [
    /remove-item\b.*\b-recurse\b/i,
    /\bdel\b.*\s\/s\b/i,
    /\brd\b.*\s\/s\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bformat\b/i,
    /\bcipher\s+\/w\b/i
  ];
  if (blocked.some(pattern => pattern.test(input)) && !isFullAccess()) {
    mainWindow?.webContents.send("terminal:data", { id, kind: "stderr", data: "已被安全策略拦截。\r\n" });
    return false;
  }
  child.stdin.write(`${input}\r\n`);
  return true;
});

ipcMain.handle("terminal:kill", async (_event, id) => {
  const child = terminalSessions.get(id);
  if (child) child.kill();
  terminalSessions.delete(id);
  return true;
});

app.whenReady().then(() => {
  createAppMenu();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
