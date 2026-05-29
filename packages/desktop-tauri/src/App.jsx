import { useMemo, useState } from "react";
import { Bot, Folder, Globe, PanelLeft, Plus, Search, Settings, Shield, Terminal, Wrench } from "lucide-react";
import "./styles.css";

const presetLabels = {
  default: "默认权限",
  "auto-review": "自动审查",
  "full-access": "完全访问权限",
  custom: "自定义"
};

const starterPrompts = [
  "解释当前项目结构，并给出下一步实现计划",
  "检查安全策略和配置目录是否合理",
  "用 deepseek-reasoner 分析一个复杂 bug"
];

function Sidebar({ collapsed, active, onNavigate }) {
  const nav = [
    ["chat", "新对话", Plus],
    ["search", "搜索", Search],
    ["plugins", "插件", Wrench],
    ["settings", "设置", Settings]
  ];
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand"><span className="dot" /><strong>DeepSeek</strong></div>
      <nav>
        {nav.map(([key, label, Icon]) => (
          <button key={key} className={active === key ? "active" : ""} onClick={() => onNavigate(key)}>
            <Icon size={17} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <section>
        <h4>项目</h4>
        <button className="project"><Folder size={16} /><span>D:\project</span></button>
      </section>
      <section>
        <h4>对话</h4>
        <button className="thread active"><span>设计 DeepSeek Windows 客户端</span><small>现在</small></button>
      </section>
    </aside>
  );
}

function Composer({ permission, setPermission }) {
  const [open, setOpen] = useState(false);
  return (
    <form className="composer" onSubmit={(event) => event.preventDefault()}>
      <textarea placeholder="尽管问" />
      <div className="composerBar">
        <div className="leftTools">
          <button type="button" className="icon">+</button>
          <div className="menuWrap">
            <button type="button" className="pill" onClick={() => setOpen(!open)}>
              <Shield size={14} /> {presetLabels[permission]}⌄
            </button>
            {open && (
              <div className="permissionMenu">
                {Object.entries(presetLabels).map(([key, label]) => (
                  <button type="button" key={key} onClick={() => { setPermission(key); setOpen(false); }}>
                    <span>{label}</span><small>{key === "full-access" ? "不限制文件系统" : key === "auto-review" ? "敏感动作先审查" : key === "default" ? "工作区写入，按需批准" : "使用 config.toml"}</small>
                    <b>{permission === key ? "✓" : ""}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="rightTools">
          <select defaultValue="deepseek-chat"><option>deepseek-chat</option><option>deepseek-reasoner</option></select>
          <button className="send">↑</button>
        </div>
      </div>
    </form>
  );
}

function ChatView({ permission, setPermission }) {
  return (
    <main className="chat">
      <div className="empty">
        <h1>我们应该用 DeepSeek 做些什么？</h1>
        <p>桌面端与命令行共用 <code>~\.deepseek</code>；运行逻辑采用 Reasonix 式稳定前缀缓存、可审计计划和工具事件流。</p>
        <div className="starters">
          {starterPrompts.map((prompt) => <button key={prompt}>{prompt}</button>)}
        </div>
      </div>
      <Composer permission={permission} setPermission={setPermission} />
    </main>
  );
}

function ContextPanel() {
  const rows = useMemo(() => [
    ["上下文", "稳定系统提示 + 工具定义优先进入前缀缓存"],
    ["记忆", "memories / memory 目录预留长期记忆与用户偏好"],
    ["规则", "rules / AGENTS.md 作为项目级行为约束"],
    ["工具", "文件、浏览器、终端、侧边聊天按标签页打开"]
  ], []);
  return (
    <aside className="context">
      <header><strong>上下文</strong><span>Reasonix-like</span></header>
      <div className="meter"><span style={{ width: "18%" }} /><span style={{ width: "9%" }} /></div>
      {rows.map(([title, desc]) => <div className="ctxRow" key={title}><b>{title}</b><small>{desc}</small></div>)}
      <div className="toolGrid">
        <button><Folder />文件</button>
        <button><Globe />浏览器</button>
        <button><Terminal />终端</button>
        <button><Bot />侧边聊天</button>
      </div>
    </aside>
  );
}

export default function App() {
  const [view, setView] = useState("chat");
  const [leftClosed, setLeftClosed] = useState(false);
  const [permission, setPermission] = useState("custom");
  return (
    <div className="app">
      <Sidebar collapsed={leftClosed} active={view} onNavigate={setView} />
      <section className="shell">
        <header className="topbar">
          <button className="icon" onClick={() => setLeftClosed(!leftClosed)}><PanelLeft size={18} /></button>
          <div><strong>{view === "chat" ? "新对话" : view === "plugins" ? "插件" : view === "search" ? "搜索" : "设置"}</strong><small>DeepSeek 桌面端</small></div>
          <span className="spacer" />
          <button className="pill">API 密钥：读取本地配置</button>
          <button className="primary">登录</button>
        </header>
        {view === "chat" ? <ChatView permission={permission} setPermission={setPermission} /> : <div className="page"><h1>{view}</h1><p>React/Tauri 组件骨架已就绪，后续接入同一套 IPC runtime。</p></div>}
      </section>
      <ContextPanel />
    </div>
  );
}
