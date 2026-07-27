const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('quotaPanel', {
  getState: () => ipcRenderer.invoke('quota:get-state'),
  refresh: () => ipcRenderer.invoke('quota:refresh'),
  close: () => ipcRenderer.invoke('quota:close'),
  setPreferredHeight: height => ipcRenderer.invoke('quota:set-preferred-height', height),
  onState: callback => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('quota:state', handler)
    return () => ipcRenderer.removeListener('quota:state', handler)
  }
})
