const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopSettings', {
  getState: () => ipcRenderer.invoke('settings:get-state'),
  save: payload => ipcRenderer.invoke('settings:save', payload)
})
