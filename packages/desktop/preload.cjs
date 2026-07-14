const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("deepseek", {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    save: (patch) => ipcRenderer.invoke("config:save", patch),
    path: () => ipcRenderer.invoke("config:path"),
    home: () => ipcRenderer.invoke("config:home"),
    plugins: () => ipcRenderer.invoke("config:plugins"),
    skills: () => ipcRenderer.invoke("config:skills"),
    auditLog: () => ipcRenderer.invoke("config:audit-log")
  },
  sessions: {
    list: () => ipcRenderer.invoke("sessions:list"),
    listArchived: () => ipcRenderer.invoke("sessions:list-archived"),
    save: (sessionData) => ipcRenderer.invoke("sessions:save", sessionData),
    archive: (id) => ipcRenderer.invoke("sessions:archive", id),
    restore: (id) => ipcRenderer.invoke("sessions:restore", id),
    delete: (id) => ipcRenderer.invoke("sessions:delete", id),
    search: (query) => ipcRenderer.invoke("sessions:search", query)
  },
  memory: {
    list: () => ipcRenderer.invoke("memory:list"),
    save: (memory) => ipcRenderer.invoke("memory:save", memory),
    delete: (id) => ipcRenderer.invoke("memory:delete", id),
    context: () => ipcRenderer.invoke("memory:context")
  },
  login: {
    open: () => ipcRenderer.invoke("login:open"),
    status: () => ipcRenderer.invoke("login:status")
  },
  chat: {
    complete: (payload) => ipcRenderer.invoke("chat:complete", payload)
  },
  agent: {
    run: (payload) => ipcRenderer.invoke("agent:run", payload),
    runStream: (payload) => ipcRenderer.invoke("agent:run-stream", payload),
    onStatus: (callback) => ipcRenderer.on("agent:status", (_event, payload) => callback(payload)),
    onChunk: (callback) => ipcRenderer.on("agent:chunk", (_event, payload) => callback(payload))
  },
  files: {
    list: (dir) => ipcRenderer.invoke("files:list", dir),
    open: (filePath) => ipcRenderer.invoke("file:open", filePath),
    read: (filePath) => ipcRenderer.invoke("file:read", filePath),
    pickAttachments: () => ipcRenderer.invoke("files:pick-attachments"),
    attachPaths: (paths) => ipcRenderer.invoke("files:attach-paths", paths),
    pathForFile: (file) => {
      try {
        return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file && file.path) || "";
      } catch {
        return (file && file.path) || "";
      }
    }
  },
  browser: {
    open: (url) => ipcRenderer.invoke("browser:open", url)
  },
  terminal: {
    run: (command) => ipcRenderer.invoke("terminal:run", command),
    create: (id) => ipcRenderer.invoke("terminal:create", id),
    write: (id, input) => ipcRenderer.invoke("terminal:write", id, input),
    kill: (id) => ipcRenderer.invoke("terminal:kill", id),
    onData: (callback) => ipcRenderer.on("terminal:data", (_event, payload) => callback(payload))
  },
  workspace: {
    index: (dir) => ipcRenderer.invoke("workspace:index", dir),
    search: (query) => ipcRenderer.invoke("workspace:search", query)
  },
  events: {
    onLoginStatus: (callback) => ipcRenderer.on("login-status", (_event, payload) => callback(payload)),
    onMenuAction: (callback) => ipcRenderer.on("menu:action", (_event, payload) => callback(payload))
  }
});
