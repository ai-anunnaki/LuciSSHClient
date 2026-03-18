import React, { useEffect, useRef, useState } from 'react'
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
  const wrapRef = useRef<HTMLDivElement>(null)   // 外层容器（用于拖拽检测）
  const termRef = useRef<HTMLDivElement>(null)   // xterm 挂载点
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [transfers, setTransfers] = useState<TransferFile[]>([])
  const [cwd, setCwd] = useState('~')
  const electronAPI = (window as any).electronAPI

  // ── 初始化 xterm（只执行一次）──────────────────────────────
  useEffect(() => {
    if (initializedRef.current || !termRef.current) return
    initializedRef.current = true

    const term = new XTerm({
      theme: {
        background: '#0d0d1a', foreground: '#f8f8f2',
        cursor: '#f8f8f2', selectionBackground: 'rgba(91,141,238,0.3)',
        black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
        blue: '#5b8dee', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
        brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
        brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
        brightCyan: '#a4ffff', brightWhite: '#ffffff',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(termRef.current)

    // 延迟 fit，确保容器已有尺寸
    setTimeout(() => {
      fitAddon.fit()
      electronAPI.sshResize(connId, term.cols, term.rows)
    }, 100)

    xtermRef.current = term
    fitRef.current = fitAddon

    // 键盘输入 → SSH
    term.onData((data) => electronAPI.sshWrite(connId, data))

    // SSH 数据 → 终端
    electronAPI.onSshData(connId, (data: string) => term.write(data))

    // 连接关闭
    electronAPI.onSshClosed(connId, () => {
      term.write('\r\n\x1b[33m[连接已断开]\x1b[0m\r\n')
    })

    // 目录同步（OSC7）
    electronAPI.onSshCwd(connId, (newCwd: string) => {
      setCwd(newCwd)
      onCwdChange?.(newCwd)
    })

    // 窗口 resize
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); electronAPI.sshResize(connId, term.cols, term.rows) } catch {}
    })
    if (termRef.current.parentElement) ro.observe(termRef.current.parentElement)

    return () => {
      electronAPI.offSshData(connId)
      electronAPI.offSshCwd(connId)
      ro.disconnect()
      term.dispose()
    }
  }, [connId])

  // ── 标签页激活时重新 fit + 聚焦 ──────────────────────────
  useEffect(() => {
    if (!active) return
    setTimeout(() => {
      try {
        fitRef.current?.fit()
        electronAPI.sshResize(connId, xtermRef.current!.cols, xtermRef.current!.rows)
        xtermRef.current?.focus()
      } catch {}
    }, 60)
  }, [active])

  // ── 拖拽上传 ─────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) setDragging(false)
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return

    for (const file of files) {
      const id = Math.random().toString(36).slice(2)
      const localPath = (file as any).path
      if (!localPath) continue
      const remotePath = `${cwd}/${file.name}`

      setTransfers(prev => [...prev, { id, name: file.name, size: file.size, percent: 0, status: 'uploading' }])
      xtermRef.current?.write(`\r\n\x1b[36m[上传] ${file.name} → ${remotePath}\x1b[0m\r\n`)

      try {
        await electronAPI.sftpUpload(connId, localPath, remotePath)
        setTransfers(prev => prev.map(t => t.id === id ? { ...t, percent: 100, status: 'done' } : t))
        xtermRef.current?.write(`\x1b[32m✓ 上传完成: ${file.name}\x1b[0m\r\n`)
      } catch {
        setTransfers(prev => prev.map(t => t.id === id ? { ...t, status: 'error' } : t))
        xtermRef.current?.write(`\x1b[31m✗ 上传失败: ${file.name}\x1b[0m\r\n`)
      }
    }
    setTimeout(() => setTransfers(prev => prev.filter(t => t.status === 'uploading')), 3000)
  }

  const formatSize = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${(b / 1024).toFixed(0)}KB`

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* xterm 挂载点 — 始终渲染，用 visibility 控制显隐 */}
      <div
        ref={termRef}
        style={{ flex: 1, minHeight: 0, padding: '4px 0', background: '#0d0d1a', visibility: active ? 'visible' : 'hidden' }}
      />

      {/* 拖拽遮罩 */}
      {dragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(13,13,26,0.85)',
          border: '2px dashed var(--accent)', borderRadius: 8,
          animation: 'dragPulse 1s ease-in-out infinite',
          gap: 12,
        }}>
          <div style={{ fontSize: 48, animation: 'bounce 0.6s ease-in-out infinite alternate' }}>⬆️</div>
          <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>松开即可上传</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>上传到：{cwd}</div>
        </div>
      )}

      {/* 传输进度浮层 */}
      {transfers.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 12, right: 12, zIndex: 20,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 14px', minWidth: 240,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'slideUp 0.2s ease',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>文件传输</div>
          {transfers.map(t => (
            <div key={t.id} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ color: t.status === 'error' ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--accent)', marginLeft: 8 }}>
                  {t.status === 'error' ? '失败' : t.status === 'done' ? '✓' : `${t.percent}%`}
                </span>
              </div>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
                <div style={{
                  height: '100%', borderRadius: 2, transition: 'width 0.3s',
                  width: `${t.percent}%`,
                  background: t.status === 'error' ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--accent)',
                  animation: t.status === 'uploading' ? 'shimmer 1.5s infinite' : 'none',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes dragPulse { 0%,100%{background:rgba(13,13,26,0.85)} 50%{background:rgba(13,13,26,0.92)} }
        @keyframes bounce { from{transform:translateY(0)} to{transform:translateY(-10px)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%,100%{box-shadow:0 0 0 0 rgba(91,141,238,0.4)} 50%{box-shadow:0 0 6px 2px rgba(91,141,238,0.6)} }
      `}</style>
    </div>
  )
}
