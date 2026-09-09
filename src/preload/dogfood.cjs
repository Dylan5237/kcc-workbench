const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dogfoodInbox', {
  getState: () => ipcRenderer.invoke('dogfood:get-state'),
  create: input => ipcRenderer.invoke('dogfood:create', input),
  update: input => ipcRenderer.invoke('dogfood:update', input),
  remove: id => ipcRenderer.invoke('dogfood:delete', { id }),
  close: () => ipcRenderer.invoke('dogfood:close'),
  onState: callback => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('dogfood:state', handler)
    return () => ipcRenderer.removeListener('dogfood:state', handler)
  },
  onFocusEditor: callback => {
    const handler = () => callback()
    ipcRenderer.on('dogfood:focus-editor', handler)
    return () => ipcRenderer.removeListener('dogfood:focus-editor', handler)
  }
})
