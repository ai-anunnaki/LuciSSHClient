const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { Client } = require('ssh2')
const fs = require('fs')

let mainWindow
const sshConnections = new Map() // 管理多个SSH连接

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png')
  })

  const startUrl = process.env.ELECTRON_START_URL ||
    `file://${path.join(__dirname, '../build/index.html')}`

  mainWindow.loadURL(startUrl)

  if (process.env.ELECTRON_START_URL) {
    mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ========================
// SSH 连接管理
// ========================

ipcMain.handle('ssh:connect', async (event, config) => {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const connId = Date.now().toString()

    conn.on('ready', () => {
      sshConnections.set(connId, { conn, config })

      // 创建Shell会话
      conn.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
        if (err) {
          reject({ success: false, error: err.message })
          return
        }

        sshConnections.get(connId).stream = stream

        // 追踪当前目录
        let outputBuffer = ''
        let lastCwd = null

        // 连接后立即注入 PROMPT_COMMAND 来广播 OSC7 目录信息
        setTimeout(() => {
          stream.write(
            'export PROMPT_COMMAND=\'printf "\\033]7;file://$HOSTNAME$PWD\\033\\\\"\'$\'\\n\'' +
            ' 2>/dev/null; echo\n'
          )
        }, 500)

        stream.on('data', (data) => {
          const str = data.toString()
          mainWindow.webContents.send(`ssh:data:${connId}`, str)

          // 解析 OSC 7 (file:// URL) 来同步目录
          outputBuffer += str
          const oscMatch = outputBuffer.match(/\x1b\]7;file:\/\/[^/]*(\/.+?)\x07/)
          if (oscMatch) {
            const newCwd = decodeURIComponent(oscMatch[1]).trim()
            if (newCwd && newCwd !== lastCwd) {
              lastCwd = newCwd
              mainWindow.webContents.send(`ssh:cwd:${connId}`, newCwd)
            }
          }
          if (outputBuffer.length > 8192) outputBuffer = outputBuffer.slice(-2048)
        })

        stream.stderr.on('data', (data) => {
          mainWindow.webContents.send(`ssh:data:${connId}`, data.toString())
        })

        stream.on('close', () => {
          mainWindow.webContents.send(`ssh:closed:${connId}`)
          sshConnections.delete(connId)
        })

        resolve({ success: true, connId })
      })
    })

    conn.on('error', (err) => {
      reject({ success: false, error: err.message })
    })

    const connectConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    }

    if (config.authType === 'password') {
      connectConfig.password = config.password
    } else if (config.authType === 'privateKey') {
      try {
        connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase
        }
      } catch (err) {
        reject({ success: false, error: `无法读取私钥文件: ${err.message}` })
        return
      }
    }

    conn.connect(connectConfig)
  })
})

ipcMain.handle('ssh:write', (event, { connId, data }) => {
  const session = sshConnections.get(connId)
  if (session?.stream) {
    session.stream.write(data)
  }
})

ipcMain.handle('ssh:resize', (event, { connId, cols, rows }) => {
  const session = sshConnections.get(connId)
  if (session?.stream) {
    session.stream.setWindow(rows, cols, 0, 0)
  }
})

ipcMain.handle('ssh:disconnect', (event, { connId }) => {
  const session = sshConnections.get(connId)
  if (session) {
    session.conn.end()
    sshConnections.delete(connId)
  }
})

// ========================
// SFTP 文件操作
// ========================

ipcMain.handle('sftp:list', async (event, { connId, remotePath }) => {
  return new Promise((resolve, reject) => {
    const session = sshConnections.get(connId)
    if (!session) return reject({ error: '连接不存在' })

    session.conn.sftp((err, sftp) => {
      if (err) return reject({ error: err.message })

      sftp.readdir(remotePath, (err, list) => {
        if (err) return reject({ error: err.message })

        const files = list.map(item => ({
          name: item.filename,
          isDirectory: item.attrs.isDirectory(),
          size: item.attrs.size,
          modifiedAt: new Date(item.attrs.mtime * 1000).toISOString(),
          permissions: item.attrs.permissions
        }))

        resolve({ files })
        sftp.end()
      })
    })
  })
})

ipcMain.handle('sftp:upload', async (event, { connId, localPath, remotePath }) => {
  return new Promise((resolve, reject) => {
    const session = sshConnections.get(connId)
    if (!session) return reject({ error: '连接不存在' })

    session.conn.sftp((err, sftp) => {
      if (err) return reject({ error: err.message })

      const remoteFile = remotePath.endsWith('/')
        ? remotePath + path.basename(localPath)
        : remotePath

      sftp.fastPut(localPath, remoteFile, {
        step: (transferred, chunk, total) => {
          mainWindow.webContents.send('sftp:progress', {
            file: path.basename(localPath),
            transferred,
            total,
            percent: Math.round((transferred / total) * 100)
          })
        }
      }, (err) => {
        if (err) return reject({ error: err.message })
        resolve({ success: true })
        sftp.end()
      })
    })
  })
})

ipcMain.handle('sftp:download', async (event, { connId, remotePath, localDir }) => {
  return new Promise((resolve, reject) => {
    const session = sshConnections.get(connId)
    if (!session) return reject({ error: '连接不存在' })

    const fileName = path.basename(remotePath)
    const localPath = path.join(localDir, fileName)

    session.conn.sftp((err, sftp) => {
      if (err) return reject({ error: err.message })

      sftp.fastGet(remotePath, localPath, {
        step: (transferred, chunk, total) => {
          mainWindow.webContents.send('sftp:progress', {
            file: fileName,
            transferred,
            total,
            percent: Math.round((transferred / total) * 100)
          })
        }
      }, (err) => {
        if (err) return reject({ error: err.message })
        resolve({ success: true, localPath })
        sftp.end()
      })
    })
  })
})

ipcMain.handle('sftp:delete', async (event, { connId, remotePath, isDirectory }) => {
  return new Promise((resolve, reject) => {
    const session = sshConnections.get(connId)
    if (!session) return reject({ error: '连接不存在' })

    session.conn.sftp((err, sftp) => {
      if (err) return reject({ error: err.message })

      const op = isDirectory ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp)
      op(remotePath, (err) => {
        if (err) return reject({ error: err.message })
        resolve({ success: true })
        sftp.end()
      })
    })
  })
})

ipcMain.handle('sftp:mkdir', async (event, { connId, remotePath }) => {
  return new Promise((resolve, reject) => {
    const session = sshConnections.get(connId)
    if (!session) return reject({ error: '连接不存在' })

    session.conn.sftp((err, sftp) => {
      if (err) return reject({ error: err.message })

      sftp.mkdir(remotePath, (err) => {
        if (err) return reject({ error: err.message })
        resolve({ success: true })
        sftp.end()
      })
    })
  })
})

// 选择本地文件
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections']
  })
  return result.filePaths
})

// 选择下载目录
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.filePaths[0]
})
