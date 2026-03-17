import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TransferFile {
  id: string
  name: string
  size: number
  percent: number
  status: 'uploading' | 'done' | 'error'
}

interface Props {
  connId: string
  active: boolean
  onCwdChange?: (cwd: string) => void
}

export default function Terminal({ connId, active, onCwdChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cwdRef = useRef<string>('~')
  const api = (window as any).electronAPI

  const [isDragging, setIsDragging] = useState(false)
  const [dragCount, setDragCount] = useState(0) // 用计数解决拖出子元素误触
  const [transfers, setTransfers] = useState<TransferFile[]>([])
  const [showOverlay, setShowOverlay] = useState(false)

  // 初始化 xterm
  useEffect(() => {
    if (!termRef.current) return

    const term = new XTerm({
      theme: {
        background: '#0d0d1a', foreground: '#f8f8f2', cursor: '#50fa7b',
        black: '#21222c', red: '#ff5555', green: '#50fa7b',
        yellow: '#f1fa8c', blue: '#6272a4', magenta: '#ff79c6',
        cyan: '#8be9fd', white: '#f8f8f2',
        brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
        brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
        brightCyan: '#a4ffff', brightWhite: '#ffffff',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      fontSize: 13, lineHeight: 1.4, cursorBlink: true, scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(termRef.current)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    setTimeout(() => {
      fitAddon.fit()
      api.sshResize(connId, term.cols, term.rows)
    }, 50)

    // SSH 数据
    api.onSshData(connId, (data: string) => term.write(data))

    // 目录同步
    api.onSshCwd(connId, (cwd: string) => {
      cwdRef.current = cwd
      onCwdChange?.(cwd)
    })

    // 用户输入
    term.onData((data) => api.sshWrite(connId, data))

    // 连接关闭
    api.onSshClosed(connId, () => {
      term.write('\r\n\x1b[33m[连接已断开]\x1b[0m\r\n')
    })

    // SFTP 进度
    api.onSftpProgress((data: any) => {
      setTransfers(prev => prev.map(t =>
        t.name === data.file
          ? { ...t, percent: data.percent, status: data.percent >= 100 ? 'done' : 'uploading' }
          : t
      ))
    })

    // resize
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); api.sshResize(connId, term.cols, term.rows) } catch {}
    })
    if (termRef.current.parentElement) ro.observe(termRef.current.parentElement)

    return () => {
      api.offSshData(connId)
      api.offSshCwd(connId)
      ro.disconnect()
      term.dispose()
    }
  }, [connId])

  // 激活时聚焦并 refit
  useEffect(() => {
    if (active) {
      setTimeout(() => {
        try { fitAddonRef.current?.fit() } catch {}
        xtermRef.current?.focus()
      }, 50)
    }
  }, [active])

  // ========================
  // 拖拽上传逻辑
  // ========================
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragCount(c => {
      if (c === 0) setIsDragging(true)
      return c + 1
    })
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragCount(c => {
      const next = c - 1
      if (next <= 0) { setIsDragging(false); return 0 }
      return next
    })
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    setDragCount(0)

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (!droppedFiles.length) return

    const targetDir = cwdRef.current || '~'

    // 加入待上传列表
    const newTransfers: TransferFile[] = droppedFiles.map(f => ({
      id: `${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      percent: 0,
      status: 'uploading'
    }))
    setTransfers(prev => [...prev, ...newTransfers])

    // 逐个上传
    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i]
      const transfer = newTransfers[i]
      const localPath = (file as any).path
      if (!localPath) {
        setTransfers(prev => prev.map(t => t.id === transfer.id ? { ...t, status: 'error' } : t))
        continue
      }

      try {
        await api.sftpUpload(connId, localPath, targetDir + '/')
        setTransfers(prev => prev.map(t => t.id === transfer.id ? { ...t, percent: 100, status: 'done' } : t))
        // 在终端显示上传成功提示
        xtermRef.current?.write(`\r\n\x1b[32m✓ 已上传: ${file.name} → ${targetDir}/\x1b[0m\r\n`)
      } catch (err: any) {
        setTransfers(prev => prev.map(t => t.id === transfer.id ? { ...t, status: 'error' } : t))
        xtermRef.current?.write(`\r\n\x1b[31m✗ 上传失败: ${file.name}\x1b[0m\r\n`)
      }
    }

    // 3秒后清除完成的项目
    setTimeout(() => {
      setTransfers(prev => prev.filter(t => t.status !== 'done'))
    }, 3000)
  }, [connId])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }

  return (
    <div
      ref={containerRef}
      style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 终端本体 */}
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden', background: '#0d0d1a' }} />

      {/* 拖拽遮罩层 */}
      {isDragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16,
          // 动画背景
          background: 'rgba(91,141,238,0.12)',
          backdropFilter: 'blur(2px)',
          animation: 'dragPulse 1.2s ease-in-out infinite',
          pointerEvents: 'none',
        }}>
          {/* 虚线边框 */}
          <div style={{
            position: 'absolute', inset: 12,
            border: '2px dashed var(--accent)',
            borderRadius: 16,
            animation: 'dashRotate 8s linear infinite',
          }} />

          {/* 图标和文字 */}
          <div style={{
            fontSize: 56,
            animation: 'bounce 0.8s ease-in-out infinite alternate',
            filter: 'drop-shadow(0 0 20px rgba(91,141,238,0.8))',
          }}>📤</div>
          <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>
            松开即可上传
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            上传到：{cwdRef.current || '~'}
          </div>
        </div>
      )}

      {/* 传输进度浮层 */}
      {transfers.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 16, right: 16, zIndex: 30,
          width: 280, background: 'rgba(18,18,42,0.95)',
          border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          animation: 'slideUp 0.2s ease-out',
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>文件传输</span>
            <span>{transfers.filter(t => t.status === 'done').length}/{transfers.length}</span>
          </div>
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {transfers.map(t => (
              <div key={t.id} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(42,42,74,0.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>
                    {t.status === 'done' ? '✅' : t.status === 'error' ? '❌' : '⬆️'}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 12, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {t.status === 'error' ? '失败' : t.status === 'done' ? '完成' : `${t.percent}%`}
                  </span>
                </div>
                {/* 进度条 */}
                {t.status !== 'error' && (
                  <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${t.percent}%`,
                      background: t.status === 'done'
                        ? 'var(--success)'
                        : 'linear-gradient(90deg, var(--accent), #a78bfa)',
                      transition: 'width 0.3s ease',
                      // 上传中的闪烁效果
                      animation: t.status === 'uploading' && t.percent > 0 && t.percent < 100
                        ? 'shimmer 1.5s ease-in-out infinite'
                        : 'none',
                    }} />
                  </div>
                )}
                {t.size > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3 }}>
                    {formatSize(Math.round(t.size * t.percent / 100))} / {formatSize(t.size)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CSS 动画 */}
      <style>{`
        @keyframes dragPulse {
          0%, 100% { background: rgba(91,141,238,0.10); }
          50%       { background: rgba(91,141,238,0.20); }
        }
        @keyframes bounce {
          from { transform: translateY(0px); }
          to   { transform: translateY(-12px); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { box-shadow: 0 0 0 0 rgba(91,141,238,0.4); }
          50%  { box-shadow: 0 0 8px 2px rgba(91,141,238,0.6); }
          100% { box-shadow: 0 0 0 0 rgba(91,141,238,0.4); }
        }
        @keyframes dashRotate {
          from { border-color: var(--accent); }
          50%  { border-color: #a78bfa; }
          to   { border-color: var(--accent); }
        }
      `}</style>
    </div>
  )
}
