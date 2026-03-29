const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Productos
  productos: {
    getAll: () => ipcRenderer.invoke('productos:getAll'),
    create: (p) => ipcRenderer.invoke('productos:create', p),
    update: (p) => ipcRenderer.invoke('productos:update', p),
    delete: (id) => ipcRenderer.invoke('productos:delete', id),
  },
  // Proveedores
  proveedores: {
    getAll: () => ipcRenderer.invoke('proveedores:getAll'),
    create: (p) => ipcRenderer.invoke('proveedores:create', p),
    update: (p) => ipcRenderer.invoke('proveedores:update', p),
    delete: (id) => ipcRenderer.invoke('proveedores:delete', id),
  },
  // Listas
  listas: {
    getAll: () => ipcRenderer.invoke('listas:getAll'),
    insertMany: (rows) => ipcRenderer.invoke('listas:insertMany', rows),
    updateMatch: (data) => ipcRenderer.invoke('listas:updateMatch', data),
    delete: (id) => ipcRenderer.invoke('listas:delete', id),
    deleteByProveedor: (id_prov) => ipcRenderer.invoke('listas:deleteByProveedor', id_prov),
    archiveByProveedor: (id_prov) => ipcRenderer.invoke('listas:archiveByProveedor', id_prov),
  },
  // Equivalencias
  equivalencias: {
    getAll: () => ipcRenderer.invoke('equivalencias:getAll'),
    create: (e) => ipcRenderer.invoke('equivalencias:create', e),
    delete: (id) => ipcRenderer.invoke('equivalencias:delete', id),
  },
  // Comparador
  comparador: {
    getComparativa: (filtros) => ipcRenderer.invoke('comparador:getComparativa', filtros),
    exportarSeleccion: (data) => ipcRenderer.invoke('comparador:exportarSeleccion', data),
  },
  // Archivos
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  },
  file: {
    readExcel: (path) => ipcRenderer.invoke('file:readExcel', path),
  },
  // Maxirest
  maxirest: {
    parseInsumos: (path) => ipcRenderer.invoke('maxirest:parseInsumos', path),
    importarInsumos: (items) => ipcRenderer.invoke('maxirest:importarInsumos', items),
    exportarComparativa: (data) => ipcRenderer.invoke('maxirest:exportarComparativa', data),
  },
})
