import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jarvis', {
  // ── Auth ──────────────────────────────────────────────────────────────
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  verifyPin: (pin: string) => ipcRenderer.invoke('auth:verify-pin', pin),
  setPin: (pin: string) => ipcRenderer.invoke('auth:set-pin', pin),

  // ── Screen ────────────────────────────────────────────────────────────
  captureScreen: () => ipcRenderer.invoke('screen:capture'),

  // ── File system ───────────────────────────────────────────────────────
  readFile: (path: string) => ipcRenderer.invoke('fs:read', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:write', path, content),
  appendFile: (path: string, content: string) => ipcRenderer.invoke('fs:append', path, content),
  listDir: (path: string) => ipcRenderer.invoke('fs:list', path),

  // ── Shell ─────────────────────────────────────────────────────────────
  runExec: (exe: string, args: string[]) => ipcRenderer.invoke('exec:run', exe, args),

  // ── Window ────────────────────────────────────────────────────────────
  expandSidebar: () => ipcRenderer.send('expand-sidebar'),
  collapseBubble: () => ipcRenderer.send('collapse-bubble'),
  pinScreenOpen: () => ipcRenderer.send('pin-screen-open'),
  pinScreenClose: () => ipcRenderer.send('pin-screen-close'),

  // ── Events ────────────────────────────────────────────────────────────
  onToggleSidebar: (cb: () => void) => {
    ipcRenderer.on('toggle-sidebar', cb);
    return () => ipcRenderer.removeListener('toggle-sidebar', cb);
  },
});
