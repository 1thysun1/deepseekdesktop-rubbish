import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  Bot,
  ChevronDown,
  FileText,
  Folder,
  Globe,
  LayoutPanelRight,
  Menu,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Settings,
  Shield,
  Terminal,
  Wrench
} from "lucide-react";
import "./styles.css";

const api = window.deepseek;
const permissionLabels = {
  default: "默认权限",
  "auto-review": "自动审查",
  "full-access": "完全访问权限",
  custom: "自定义"
};

function cx(...items) {
  return items.filter(Boolean).join(" ");
}

function Sidebar({ closed, page, setPage, threads, archived, activeThread, selectThread, newThread, archiveThread }) {
  const nav = [
    ["chat", "新对话", Plus, newThread],
    ["search", "搜索", Search, () => setPage("search")],
    ["plugins", "插件", Wrench, () => setPage("plugins")],
    ["settings", "设置", Settings, () => setPage("settings")]
  ];
  return (
    <aside className={cx("sidebar", closed && "closed")}>
      <div className="brand"><span className="logo" /><strong>DeepSeek</strong></div>
      <nav className="nav">
        {nav.map(([key, label, Icon, action]) => (
          <button key={key} className={cx(page === key && "active")} onClick={action}>
            <Icon size={18} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sectionTitle">项目</div>
      <button className="project"><Folder size={17} /><span>D:\deepseek</span></button>
      <div className="sectionTitle">对话</div>
      <div className="threadList">
        {threads.map(t => (
          <button key={t.id} className={cx("thread", activeThread === t.id && "active")} onClick={() => selectThread(t.id)}>
            <span>{t.title || "新对话"}</span><small>{t.time || ""}</small>
            <b onClick={(event) => { event.stopPropagation(); archiveThread(t.id); }}>×</b>
          </button>
        ))}
      </div>
      <div className="sectionTitle">归档</div>
      <div className="threadList archived">
        {archived.slice(0, 6).map(t => <button key={t.id} className="thread muted"><span>{t.title}</span><small>{t.time || ""}</small></button>)}
      </div>
    </aside>
  );
}

function Composer({ config, setConfig, onSend, busy, onTool }) {
  const [text, setText] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const dropRef = useRef(null);

  async function attachFiles() {
    const files = await api.files.pickAttachments();
    setAttachments(prev => [...prev, ...files.filter(f => !prev.some(x => x.path === f.path))]);
  }
  async function attachPaths(paths) {
    const files = await api.files.attachPaths(paths);
    setAttachments(prev => [...prev, ...files.filter(f => !prev.some(x => x.path === f.path))]);
  }
  function pathsFromFiles(files) {
    return Array.from(files || []).map(file => api.files.pathForFile?.(file) || file.path || "").filter(Boolean);
  }
  async function setPermission(preset) {
    const patch = preset === "default"
      ? { permissionPreset: preset, sandboxMode: "workspace-write", approvalPolicy: "on-request" }
      : preset === "auto-review"
        ? { permissionPreset: preset, sandboxMode: "workspace-write", approvalPolicy: "on-failure" }
        : preset === "full-access"
          ? { permissionPreset: preset, sandboxMode: "danger-full-access", approvalPolicy: "never" }
          : { permissionPreset: "custom" };
    const next = await api.config.save(patch);
    setConfig(next);
    setPermOpen(false);
  }
  function submit(event) {
    event.preventDefault();
    if ((!text.trim() && !attachments.length) || busy) return;
    onSend(text.trim() || "请分析附件。", attachments);
    setText("");
    setAttachments([]);
  }
  return (
    <form
      ref={dropRef}
      className={cx("composer", busy && "busy")}
      onSubmit={submit}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; dropRef.current?.classList.add("dragging"); }}
      onDragLeave={() => dropRef.current?.classList.remove("dragging")}
      onDrop={(event) => {
        event.preventDefault();
        dropRef.current?.classList.remove("dragging");
        const paths = pathsFromFiles(event.dataTransfer.files);
        if (paths.length) attachPaths(paths);
      }}
    >
      <textarea
        placeholder="尽管问"
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey) submit(event);
        }}
      />
      {!!attachments.length && <div className="attachments">{attachments.map(file => <span key={file.path}>📎 {file.name}<button type="button" onClick={() => setAttachments(v => v.filter(x => x.path !== file.path))}>×</button></span>)}</div>}
      <div className="composerBar">
        <div className="toolRow">
          <div className="popWrap">
            <button type="button" className="iconBtn" onClick={() => setPlusOpen(!plusOpen)}>+</button>
            {plusOpen && (
              <div className="plusMenu pop">
                <button type="button" onClick={attachFiles}><Paperclip size={16} />附件</button>
                <button type="button" onClick={() => { const p = prompt("输入本地路径"); if (p) setText(v => `${v}\n请真实读取并分析：${p}`.trim()); }}><FileText size={16} />路径</button>
                <button type="button" onClick={() => onTool("files")}><Folder size={16} />文件</button>
                <hr />
                <button type="button" onClick={() => onTool("terminal")}><Terminal size={16} />终端</button>
                <button type="button" onClick={() => onTool("browser")}><Globe size={16} />浏览器</button>
                <button type="button" onClick={() => onTool("side-chat")}><MessageSquare size={16} />侧聊</button>
                <hr />
                <button type="button" onClick={() => setText(v => `${v}\n请先给出可审计计划，再执行。`.trim())}>计划</button>
                <button type="button" onClick={() => onTool("plugins")}><Wrench size={16} />插件</button>
              </div>
            )}
          </div>
          <div className="popWrap">
            <button type="button" className="pill" onClick={() => setPermOpen(!permOpen)}><Shield size={15} />{permissionLabels[config.permissionPreset || "custom"]}<ChevronDown size={14} /></button>
            {permOpen && (
              <div className="permMenu pop">
                {Object.entries(permissionLabels).map(([key, label]) => (
                  <button type="button" key={key} onClick={() => setPermission(key)}>
                    <span>{label}</span><b>{(config.permissionPreset || "custom") === key ? "✓" : ""}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={config.model || "deepseek-chat"} onChange={async e => setConfig(await api.config.save({ model: e.target.value }))}>
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="deepseek-reasoner">deepseek-reasoner</option>
          </select>
        </div>
        <button className="send" disabled={busy}>↑</button>
      </div>
    </form>
  );
}

function Chat({ messages, reasoning, config, setConfig, onSend, busy, onTool }) {
  return (
    <main className="chat">
      <div className="messages">
        {!messages.length && (
          <div className="empty">
            <h1>我们应该用 DeepSeek 做些什么？</h1>
            <p>Electron 宿主 + React UI，复用 <code>~\.deepseek</code> 配置和本地工具链。</p>
            {["解释当前项目结构，并给出下一步实现计划", "检查安全策略和配置目录是否合理", "分析一个本地 pcap/zip/exe 文件"].map(item => <button key={item} onClick={() => onSend(item, [])}>{item}</button>)}
          </div>
        )}
        {messages.map((m, i) => <article key={i} className={cx("msg", m.role)}>{m.content}</article>)}
        {reasoning && <article className="reasoning"><strong>{reasoning.title}</strong>{reasoning.steps.map((s, i) => <p key={i}>• {s}</p>)}</article>}
      </div>
      <Composer config={config} setConfig={setConfig} busy={busy} onSend={onSend} onTool={onTool} />
    </main>
  );
}

function RightPanel({ tool, close }) {
  return (
    <aside className={cx("rightPanel", !tool && "closed")}>
      <header><strong>{tool || "工具"}</strong><button onClick={close}>×</button></header>
      <div className="toolBody">
        {tool === "terminal" && <p>终端入口已切到 React 壳；底层仍用 Electron IPC 创建 PowerShell 会话。</p>}
        {tool === "files" && <p>文件入口已切到 React 壳；底层复用 Electron 文件列表、打开和附件读取。</p>}
        {tool === "browser" && <p>浏览器入口已切到 React 壳；底层复用联网和外部浏览器打开。</p>}
        {!tool && null}
      </div>
    </aside>
  );
}

function SettingsPage({ config, setConfig }) {
  const tabs = ["常规", "外观", "配置", "权限", "联网", "记忆", "已归档对话"];
  const [tab, setTab] = useState("常规");
  return (
    <main className="settingsPage">
      <nav>{tabs.map(t => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</nav>
      <section>
        <h1>{tab}</h1>
        {tab === "权限" ? (
          <div className="card">
            <h3>权限</h3>
            {Object.entries(permissionLabels).map(([key, label]) => <button key={key} onClick={async () => setConfig(await api.config.save(key === "full-access" ? { permissionPreset: key, sandboxMode: "danger-full-access", approvalPolicy: "never" } : { permissionPreset: key }))}>{label}</button>)}
          </div>
        ) : (
          <div className="card"><pre>{JSON.stringify(config, null, 2)}</pre></div>
        )}
      </section>
    </main>
  );
}

function App() {
  const [config, setConfig] = useState({});
  const [threads, setThreads] = useState([]);
  const [archived, setArchived] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState("chat");
  const [leftClosed, setLeftClosed] = useState(false);
  const [tool, setTool] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasoning, setReasoning] = useState(null);

  useEffect(() => {
    api.config.get().then(setConfig);
    api.sessions.list().then(items => {
      setThreads(items);
      if (items[0]) { setActiveThread(items[0].id); setMessages(items[0].messages || []); }
    });
    api.sessions.listArchived().then(setArchived);
    api.agent.onStatus?.(({ stage, detail }) => setReasoning(prev => ({ title: "正在思考", steps: [...(prev?.steps || []).slice(-8), `${stage}${detail ? `：${detail}` : ""}`] })));
  }, []);

  async function saveCurrent(nextMessages) {
    const id = activeThread || crypto.randomUUID();
    const item = threads.find(t => t.id === id) || { id, title: nextMessages[0]?.content?.slice(0, 28) || "新对话", project: "deepseek" };
    const saved = await api.sessions.save({ ...item, messages: nextMessages });
    setActiveThread(saved.id);
    setThreads(prev => [saved, ...prev.filter(t => t.id !== saved.id)]);
  }

  async function send(text, attachments) {
    const attachmentText = attachments?.length ? "\n\n【用户附件】\n" + attachments.map((f, i) => `附件 ${i + 1}: ${f.name}\n路径: ${f.path}\n大小: ${f.size}\n内容:\n${f.content}`).join("\n\n") : "";
    const next = [...messages, { role: "user", content: text + attachmentText }];
    setMessages(next);
    setBusy(true);
    setReasoning({ title: "正在思考", steps: ["理解任务", "制定计划"] });
    try {
      const res = await api.agent.run({ model: config.model || "deepseek-chat", messages: next });
      const done = [...next, { role: "assistant", content: res.content || "(empty)" }];
      setMessages(done);
      await saveCurrent(done);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `错误：${err.message}` }]);
    } finally {
      setBusy(false);
      setReasoning(null);
    }
  }

  async function newThread() {
    setActiveThread(crypto.randomUUID());
    setMessages([]);
    setPage("chat");
  }

  async function archiveThread(id) {
    await api.sessions.archive(id);
    const list = await api.sessions.list();
    const arc = await api.sessions.listArchived();
    setThreads(list);
    setArchived(arc);
    if (id === activeThread) newThread();
  }

  return (
    <div className="app">
      <Sidebar closed={leftClosed} page={page} setPage={setPage} threads={threads} archived={archived} activeThread={activeThread} selectThread={(id) => { const t = threads.find(x => x.id === id); setActiveThread(id); setMessages(t?.messages || []); setPage("chat"); }} newThread={newThread} archiveThread={archiveThread} />
      <section className="shell">
        <header className="topbar">
          <button className="iconBtn" onClick={() => setLeftClosed(!leftClosed)}><Menu size={20} /></button>
          <div><strong>{page === "chat" ? "新对话" : page}</strong><small>DeepSeek · React/Electron</small></div>
          <span className="spacer" />
          <span className="pill">API 密钥：{config.apiKey ? "已配置" : "未配置"}</span>
          <button className="iconBtn" onClick={() => setTool(tool ? "" : "files")}><LayoutPanelRight size={19} /></button>
        </header>
        {page === "settings" ? <SettingsPage config={config} setConfig={setConfig} /> : <Chat messages={messages} reasoning={reasoning} config={config} setConfig={setConfig} onSend={send} busy={busy} onTool={(t) => t === "plugins" ? setPage("plugins") : setTool(t)} />}
      </section>
      <RightPanel tool={tool} close={() => setTool("")} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
