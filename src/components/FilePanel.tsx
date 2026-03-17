import React, { useState, useEffect, useCallback } from 'react'

interface FileItem {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: string
}

interface TransferItem {
  id: string
  name: string
  percent: number
  status: 'uploading' | 'downloading' | 'done' | 'error'
}

interface Props {
  connId: string
  onClose: () => void
  syncPath?: string  // 从终端同步过来的当前目录
}

export default function FilePanel({ connId, onClose, syncPath }: Props) {
  const [currentPath, setCurrentPath] = useState('/')
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [syncEnabled, setSyncEnabled] = useState(true) // 是否启用目录同步
  const api = (window as any).electronAPI

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const result = await api.sftpList(connId, path)
      setFiles(result.files.sort((a: FileItem, b: FileItem) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      }))
      setCurrentPath(path)
    } catch (err) {
      console.error('Failed to list files:', err)
    } finally {
      setLoading(false)
    }
  }, [connId])

  useEffect(() => {
    loadFiles('/')

    api.onSftpProgress((data: any) => {
      setTransfers(prev => prev.map(t =>
        t.name === data.file ? { ...t, percent: data.percent, status: data.percent === 100 ? 'done' : t.status } : t
      ))
    })
  }, [])

  // 监听终端目录变化，同步文件面板
  useEffect(() => {
    if (syncEnabled && syncPath && syncPath !== currentPath) {
      loadFiles(syncPath)
    }
  }, [syncPath, syncEnabled])

  // 拖拽上传
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    for (const file of droppedFiles) {
      const localPath = (file as any).path
      if (!localPath) continue

      const transferId = Date.now().toString()
      setTransfers(prev => [...prev, {
        id: transferId, name: file.name, percent: 0, status: 'uploading'
      }])

      try {
        await api.sftpUpload(connId, localPath, currentPath)
        setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, percent: 100, status: 'done' } : t))
        loadFiles(currentPath)
      } catch (err: any) {
        setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: 'error' } : t))
      }
    }

    setTimeout(() => {
      setTransfers(prev => prev.filter(t => t.status !== 'done'))
    }, 3000)
  }

  const handleDownload = async (file: FileItem) => {
    const localDir = await api.openDirectory()
    if (!localDir) return

    const remotePath = `${currentPath}/${file.name}`.replace('//', '/')
    const transferId = Date.now().toString()
    setTransfers(prev => [...prev, {
      id: transferId, name: file.name, percent: 0, status: 'downloading'
    }])

    try {
      await api.sftpDownload(connId, remotePath, localDir)
      setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, percent: 100, status: 'done' } : t))
    } catch (err: any) {
      setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: 'error' } : t))
    }

    setTimeout(() => {
      setTransfers(prev => prev.filter(t => t.status !== 'done'))
    }, 3000)
  }

  const handleUpload = async () => {
    const filePaths = await api.openFile()
    if (!filePaths?.length) return

    for (const localPath of filePaths) {
      const name = localPath.split('/').pop() || localPath
      const transferId = Date.now().toString()
      setTransfers(prev => [...prev, {
        id: transferId, name, percent: 0, status: 'uploading'
      }])

      try {
        await api.sftpUpload(connId, localPath, currentPath)
        setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, percent: 100, status: 'done' } : t))
        loadFiles(currentPath)
      } catch (err: any) {
        setTransfers(prev => prev.map(t => t.id === transferId ? { ...t, status: 'error' } : t))
      }
    }

    setTimeout(() => {
      setTransfers(prev => prev.filter(t => t.status !== 'done'))
    }, 3000)
  }

  const handleDelete = async (file: FileItem) => {
    if (!window.confirm(`确认删除 ${file.name}？`)) return
    const remotePath = `${currentPath}/${file.name}`.replace('//', '/')
    try {
      await api.sftpDelete(connId, remotePath, file.isDirectory)
      loadFiles(currentPath)
    } catch (err) {
      alert('删除失败')
    }
  }

  const navigateTo = (dir: string) => {
    let newPath: string
    if (dir === '..') {
      const parts = currentPath.split('/').filter(Boolean)
      parts.pop()
      newPath = '/' + parts.join('/')
    } else {
      newPath = `${currentPath}/${dir}`.replace('//', '/')
    }
    loadFiles(newPath || '/')
  }

  const formatSize = (size: number) => {
    if (size < 1024) return `${size}B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`
    return `${(size / 1024 / 1024).toFixed(1)}MB`
  }

  return (
    <div style={{
      width: 340, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0
    }}>
      {/* 头部 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>📁 文件管理</span>
        {/* 目录同步开关 */}
        <button
          onClick={() => setSyncEnabled(p => !p)}
          title={syncEnabled ? '同步终端目录（点击关闭）' : '已关闭同步（点击开启）'}
          style={{
            ...smallBtn,
            color: syncEnabled ? 'var(--success)' : 'var(--text-secondary)',
            background: syncEnabled ? 'rgba(80,250,123,0.1)' : 'var(--bg-hover)',
            fontSize: 11, fontWeight: 600
          }}
        >
          {syncEnabled ? '⇄ 同步' : '⇄ 手动'}
        </button>
        <button onClick={handleUpload} style={smallBtn} title="上传文件">⬆</button>
        <button onClick={() => loadFiles(currentPath)} style={smallBtn} title="刷新">↺</button>
        <button onClick={onClose} style={{ ...smallBtn, color: 'var(--danger)' }}>✕</button>
      </div>

      {/* 路径栏 */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => navigateTo('..')} disabled={currentPath === '/'} style={{ ...smallBtn, opacity: currentPath === '/' ? 0.3 : 1 }}>←</button>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentPath}
        </span>
      </div>

      {/* 拖拽上传区域 + 文件列表 */}
      <div
        style={{
          flex: 1, overflow: 'auto', position: 'relative',
          border: isDragging ? '2px dashed var(--accent)' : '2px solid transparent',
          transition: 'border 0.2s',
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(91,141,238,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)', fontSize: 14, fontWeight: 600, zIndex: 10, pointerEvents: 'none'
          }}>
            松开鼠标上传文件
          </div>
        )}

        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>加载中...</div>
        ) : files.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>空文件夹</div>
        ) : (
          files.map(file => (
            <div
              key={file.name}
              onDoubleClick={() => file.isDirectory && navigateTo(file.name)}
              onClick={() => setSelected(file.name)}
              style={{
                padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                background: selected === file.name ? 'var(--bg-hover)' : 'transparent',
                cursor: file.isDirectory ? 'pointer' : 'default',
                borderBottom: '1px solid rgba(42,42,74,0.5)',
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{file.isDirectory ? '📁' : '📄'}</span>
              <span style={{
                flex: 1, fontSize: 12, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{file.name}</span>
              {!file.isDirectory && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>{formatSize(file.size)}</span>
              )}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {!file.isDirectory && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(file) }}
                    style={microBtn} title="下载"
                  >⬇</button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(file) }}
                  style={{ ...microBtn, color: 'var(--danger)' }} title="删除"
                >✕</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 拖拽提示 */}
      {transfers.length === 0 && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
          拖拽文件到此处上传
        </div>
      )}

      {/* 传输进度 */}
      {transfers.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px', maxHeight: 120, overflow: 'auto' }}>
          {transfers.map(t => (
            <div key={t.id} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 11 }}>
                <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{t.name}</span>
                <span style={{ color: t.status === 'error' ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--accent)', flexShrink: 0, marginLeft: 8 }}>
                  {t.status === 'error' ? '失败' : t.status === 'done' ? '完成' : `${t.percent}%`}
                </span>
              </div>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, transition: 'width 0.3s',
                  width: `${t.percent}%`,
                  background: t.status === 'error' ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--accent)'
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const smallBtn: React.CSSProperties = {
  background: 'var(--bg-hover)', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 12, padding: '3px 7px',
  borderRadius: 4,
}

const microBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 11, padding: '1px 4px',
  borderRadius: 3, opacity: 0.7,
}
