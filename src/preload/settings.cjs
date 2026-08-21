const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopSettings', {
  getState: () => ipcRenderer.invoke('settings:get-state'),
  save: payload => ipcRenderer.invoke('settings:save', payload),
  selectDirectory: () => ipcRenderer.invoke('settings:select-directory'),
  addSkill: payload => ipcRenderer.invoke('settings:skills-add', payload),
  removeSkill: payload => ipcRenderer.invoke('settings:skills-remove', payload),
  restoreSkill: payload => ipcRenderer.invoke('settings:skills-restore', payload),
  syncSkills: payload => ipcRenderer.invoke('settings:skills-sync', payload)
})
