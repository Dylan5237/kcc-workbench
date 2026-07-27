const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('viewer:select-directory'),
  copyFiles: paths => ipcRenderer.invoke('viewer:copy-files', paths)
})
