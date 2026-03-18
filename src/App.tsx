import React, { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Terminal from './components/Terminal'
import FilePanel from './components/FilePanel'
import ConnectModal from './components/ConnectModal'

export interface Connection {
  id: string
  label: string
  host: string
  username: string
  connId?: string
  status: 'connected' | 'connecting' | 'disconnected'
  cwd?: string
}

export interface SavedHost {
  id: string
  label: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

const api = () => (window as any).electronAPI

export default function App() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [showFilePanel, setShowFilePanel] = useState(false)
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [editingHost, setEditingHost] = useState<SavedHost | null>(null)
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>(() => {
    try { return JSON.parse(localStorage.getItem('savedHosts') || '[]') } catch { return [] }
  })

  const persistHosts = (hosts: SavedHost[]) => {
    setSavedHosts(hosts)
    localStorage.setItem('savedHosts', JSON.stringify(hosts))
  }

  const handleConnect = useCallback(async (config: any) => {
    const id = Date.now().toString()
    const newConn: Connection = {
      id, label: config.label || `${config.username}@${config.host}`,
      host: config.host, username: config.username, status: 'connecting'
    }
    setConnections(prev => [...prev, newConn])
    setActiveConnId(id)

    if (config.save) {
      const host: SavedHost = {
        id: config.existingId || Date.now().toString(),
        label: config.label || `${config.username}@${config.host}`,
        host: config.host, port: config.port || 22,
        username: config.username, authType: config.authType,
        password: config.password, privateKeyPath: config.privateKeyPath,
        passphrase: config.passphrase
      }
      const existing = savedHosts.findIndex(h => h.id === host.id)
      const updated = existing >= 0
        ? savedHosts.map((h, i) => i === existing ? host : h)
        : [...savedHosts, host]
      persistHosts(updated)
    }

    try {
      const result = await api().sshConnect(config)
      if (result.success) {
        setConnections(prev => prev.map(c =>
          c.id === id ? { ...c, connId: result.connId, status: 'connected' } : c
        ))
      } else {
        setConnections(prev => prev.map(c =>
          c.id === id ? { ...c, status: 'disconnected' } : c
        ))
      }
    } catch {
      setConnections(prev => prev.map(c =>
        c.id === id ? { ...c, status: 'disconnected' } : c
      ))
    }
  }, [savedHosts])

  const handleCwdChange = useCallback((connId: string, cwd: string) => {
    setConnections(prev => prev.map(c => c.id === connId ? { ...c, cwd } : c))
  }, [])

  const handleCloseTab = useCallback((id: string) => {
    setConnections(prev => {
      const next = prev.filter(c => c.id !== id)
      if (activeConnId === id) setActiveConnId(next.length > 0 ? next[next.length - 1].id : null)
      return next
    })
  }, [activeConnId])

  const handleDeleteHost = useCallback((id: string) => {
    persistHosts(savedHosts.filter(h => h.id !== id))
  }, [savedHosts])

  const handleEditHost = useCallback((host: SavedHost) => {
    setEditingHost(host)
    setShowConnectModal(true)
  }, [])

  const activeConn = connections.find(c => c.id === activeConnId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)' }}>
      {/* macOS 拖拽标题栏 */}
      <div className="titlebar" />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 侧边栏 */}
        <Sidebar
          savedHosts={savedHosts}
          connections={connections}
          activeConnId={activeConnId}
          showFilePanel={showFilePanel}
          onConnect={() => { setEditingHost(null); setShowConnectModal(true) }}
          onSelectHost={(host) => { setEditingHost(null); handleConnect({ ...host, save: false }) }}
          onSelectTab={setActiveConnId}
          onCloseTab={handleCloseTab}
          onToggleFiles={() => setShowFilePanel(p => !p)}
          onDeleteHost={handleDeleteHost}
          onEditHost={handleEditHost}
        />

        {/* 主区域 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {/* 标签栏 */}
          {connections.length > 0 && (
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
              {connections.map(conn => (
                <div
                  key={conn.id}
                  onClick={() => setActiveConnId(conn.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border)', fontSize: 12,
                    background: conn.id === activeConnId ? 'var(--bg-primary)' : 'transparent',
                    color: conn.id === activeConnId ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: conn.status === 'connected' ? 'var(--success)' : conn.status === 'connecting' ? 'var(--warning)' : '#666'
                  }} />
                  <span>{conn.label}</span>
                  {conn.cwd && <span style={{ fontSize: 10, opacity: 0.5, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{conn.cwd}</span>}
                  <button
                    onClick={e => { e.stopPropagation(); handleCloseTab(conn.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.5, padding: '0 2px', fontSize: 13, lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* 终端区域 — 全部渲染，用 display 控制显隐，保证 xterm 容器始终存在 */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {connections.length === 0 ? (
              <WelcomeScreen onConnect={() => { setEditingHost(null); setShowConnectModal(true) }} />
            ) : (
              connections.map(conn => (
                <div
                  key={conn.id}
                  style={{
                    position: 'absolute', inset: 0,
                    // 用 visibility + pointerEvents 代替 display:none，保证 xterm 能正确计算尺寸
                    visibility: conn.id === activeConnId ? 'visible' : 'hidden',
                    pointerEvents: conn.id === activeConnId ? 'auto' : 'none',
                  }}
                >
                  {conn.connId && (
                    <Terminal
                      connId={conn.connId}
                      active={conn.id === activeConnId}
                      onCwdChange={(cwd) => handleCwdChange(conn.id, cwd)}
                    />
                  )}
                  {conn.status === 'connecting' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>⏳</span> 连接中 {conn.label}...
                    </div>
                  )}
                  {conn.status === 'disconnected' && !conn.connId && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--danger)', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>✕</span> 连接失败
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 文件面板 */}
        {showFilePanel && activeConn?.connId && (
          <FilePanel
            connId={activeConn.connId}
            syncPath={activeConn.cwd}
            onClose={() => setShowFilePanel(false)}
          />
        )}
      </div>

      {/* 连接/编辑弹窗 */}
      {showConnectModal && (
        <ConnectModal
          editHost={editingHost}
          onConnect={handleConnect}
          onClose={() => { setShowConnectModal(false); setEditingHost(null) }}
        />
      )}
    </div>
  )
}

function WelcomeScreen({ onConnect }: { onConnect: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, color: 'var(--text-secondary)' }}>
      <div style={{ fontSize: 64 }}>🐦</div>
      <div style={{ fontSize: 22, color: 'var(--text-primary)', fontWeight: 600 }}>鸬鹚SSH客户端</div>
      <div style={{ fontSize: 14 }}>简洁 · 跨平台 · 支持拖拽文件传输</div>
      <button
        onClick={onConnect}
        style={{ marginTop: 10, padding: '10px 28px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
      >
        + 新建连接
      </button>
    </div>
  )
}
