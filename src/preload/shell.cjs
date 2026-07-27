const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopShell', {
  getState: () => ipcRenderer.invoke('shell:get-state'),
  setTab: tab => ipcRenderer.invoke('shell:set-tab', tab),
  toggleQuota: () => ipcRenderer.invoke('shell:toggle-quota'),
  goBack: () => ipcRenderer.invoke('nav:back'),
  goForward: () => ipcRenderer.invoke('nav:forward'),
  reload: () => ipcRenderer.invoke('nav:reload'),
  onQuotaState: callback => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('quota:state', handler)
    return () => ipcRenderer.removeListener('quota:state', handler)
  },
  onQuotaVisibility: callback => {
    const handler = (_event, visible) => callback(visible)
    ipcRenderer.on('quota:visibility', handler)
    return () => ipcRenderer.removeListener('quota:visibility', handler)
  },
  onNavigationState: callback => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('navigation:state', handler)
    return () => ipcRenderer.removeListener('navigation:state', handler)
  },
  onTabChanged: callback => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('shell:tab-changed', handler)
    return () => ipcRenderer.removeListener('shell:tab-changed', handler)
  }
})
