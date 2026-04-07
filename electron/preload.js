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
    getComparativa:   (filtros) => ipcRenderer.invoke('comparador:getComparativa', filtros),
    exportarSeleccion:(data)    => ipcRenderer.invoke('comparador:exportarSeleccion', data),
    exportarLista:    (data)    => ipcRenderer.invoke('comparador:exportarLista', data),
  },
  // Archivos
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  },
  file: {
    readExcel: (path) => ipcRenderer.invoke('file:readExcel', path),
  },
  // Licencia
  license: {
    check:      ()              => ipcRenderer.invoke('license:check'),
    activate:   (data)          => ipcRenderer.invoke('license:activate', data),
    deactivate: ()              => ipcRenderer.invoke('license:deactivate'),
    generate:   (clienteId)     => ipcRenderer.invoke('license:generate', clienteId),
  },
  // Maxirest
  maxirest: {
    parseInsumos: (path) => ipcRenderer.invoke('maxirest:parseInsumos', path),
    importarInsumos: (items) => ipcRenderer.invoke('maxirest:importarInsumos', items),
    exportarComparativa: (data) => ipcRenderer.invoke('maxirest:exportarComparativa', data),
  },
  // Sync / Vincular con OPS Terminal
  sync: {
    exportJSON: () => ipcRenderer.invoke('sync:exportJSON'),
    importJSON: () => ipcRenderer.invoke('sync:importJSON'),
    pushToOPS: (url) => ipcRenderer.invoke('sync:pushToOPS', url),
    pullFromOPS: (url) => ipcRenderer.invoke('sync:pullFromOPS', url),
  },
  // Pedidos
  pedidos: {
    getAll:        ()             => ipcRenderer.invoke('pedidos:getAll'),
    create:        (data)         => ipcRenderer.invoke('pedidos:create', data),
    updateEstado:  ({ id, estado }) => ipcRenderer.invoke('pedidos:updateEstado', { id, estado }),
    delete:        (id)           => ipcRenderer.invoke('pedidos:delete', id),
  },
  // Backup / Restore
  backup: {
    export:  () => ipcRenderer.invoke('backup:export'),
    restore: () => ipcRenderer.invoke('backup:restore'),
  },
  // Zoom / Tamaño de fuente
  app: {
    setZoom: (factor) => ipcRenderer.invoke('app:setZoom', factor),
  },
  // Auth
  auth: {
    login:    (data)  => ipcRenderer.invoke('auth:login', data),
    validate: (token) => ipcRenderer.invoke('auth:validate', token),
    logout:   ()      => ipcRenderer.invoke('auth:logout'),
  },
  // Users (admin)
  users: {
    getAll: ()     => ipcRenderer.invoke('users:getAll'),
    create: (data) => ipcRenderer.invoke('users:create', data),
    update: (data) => ipcRenderer.invoke('users:update', data),
    delete: (id)   => ipcRenderer.invoke('users:delete', id),
  },
  // Network
  network: {
    getInfo:     () => ipcRenderer.invoke('network:getInfo'),
    openFirewall: () => ipcRenderer.invoke('network:openFirewall'),
  },
})
