const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // SSH 连接
  sshConnect: (config) => ipcRenderer.invoke('ssh:connect', config),
  sshWrite: (connId, data) => ipcRenderer.invoke('ssh:write', { connId, data }),
  sshResize: (connId, cols, rows) => ipcRenderer.invoke('ssh:resize', { connId, cols, rows }),
  sshDisconnect: (connId) => ipcRenderer.invoke('ssh:disconnect', { connId }),
  onSshData: (connId, callback) => ipcRenderer.on(`ssh:data:${connId}`, (_, data) => callback(data)),
  onSshClosed: (connId, callback) => ipcRenderer.on(`ssh:closed:${connId}`, callback),
  onSshCwd: (connId, callback) => ipcRenderer.on(`ssh:cwd:${connId}`, (_, cwd) => callback(cwd)),
  offSshData: (connId) => ipcRenderer.removeAllListeners(`ssh:data:${connId}`),
  offSshCwd: (connId) => ipcRenderer.removeAllListeners(`ssh:cwd:${connId}`),

  // SFTP
  sftpList: (connId, remotePath) => ipcRenderer.invoke('sftp:list', { connId, remotePath }),
  sftpUpload: (connId, localPath, remotePath) => ipcRenderer.invoke('sftp:upload', { connId, localPath, remotePath }),
  sftpDownload: (connId, remotePath, localDir) => ipcRenderer.invoke('sftp:download', { connId, remotePath, localDir }),
  sftpDelete: (connId, remotePath, isDirectory) => ipcRenderer.invoke('sftp:delete', { connId, remotePath, isDirectory }),
  sftpMkdir: (connId, remotePath) => ipcRenderer.invoke('sftp:mkdir', { connId, remotePath }),
  onSftpProgress: (callback) => ipcRenderer.on('sftp:progress', (_, data) => callback(data)),

  // 连通性测试
  sshTest: (config) => ipcRenderer.invoke('ssh:test', config),

  // 文件对话框
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
})
