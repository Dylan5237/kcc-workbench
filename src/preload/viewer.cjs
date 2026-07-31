const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('viewer:select-directory'),
  setRoot: root => ipcRenderer.invoke('viewer:set-root', root),
  forkCheckpoint: input => ipcRenderer.invoke('viewer:fork-checkpoint', input),
  copyFiles: paths => ipcRenderer.invoke('viewer:copy-files', paths),
  trashItem: paths => ipcRenderer.invoke('viewer:trash-item', paths)
})
