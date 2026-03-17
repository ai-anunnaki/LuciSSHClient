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
}

export default function App() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [showFilePanel, setShowFilePanel] = useState(false)
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>(() => {
    try { return JSON.parse(localStorage.getItem('savedHosts') || '[]') }
    catch { return [] }
  })

  const handleConnect = async (config: any) => {
    const tempId = Date.now().toString()
    const newConn: Connection = {
      id: tempId,
      label: config.label || `${config.username}@${config.host}`,
      host: config.host,
      username: config.username,
      status: 'connecting',
      cwd: '~'
    }

    setConnections(prev => [...prev, newConn])
    setActiveConnId(tempId)
    setShowConnectModal(false)

    try {
      const result = await (window as any).electronAPI.sshConnect(config)
      if (result.success) {
        setConnections(prev => prev.map(c =>
          c.id === tempId ? { ...c, connId: result.connId, status: 'connected' } : c
        ))
      }
    } catch {
      setConnections(prev => prev.map(c =>
        c.id === tempId ? { ...c, status: 'disconnected' } : c
      ))
    }

    if (config.save) {
      const newHost: SavedHost = {
        id: tempId, label: config.label || `${config.username}@${config.host}`,
        host: config.host, port: config.port || 22, username: config.username,
        authType: config.authType,
        ...(config.authType === 'password' ? { password: config.password } : { privateKeyPath: config.privateKeyPath })
      }
      const updated = [...savedHosts, newHost]
      setSavedHosts(updated)
      localStorage.setItem('savedHosts', JSON.stringify(updated))
    }
  }

  const handleCloseTab = (id: string) => {
    const conn = connections.find(c => c.id === id)
    if (conn?.connId) (window as any).electronAPI.sshDisconnect(conn.connId)
    setConnections(prev => prev.filter(c => c.id !== id))
    if (activeConnId === id) {
      const remaining = connections.filter(c => c.id !== id)
      setActiveConnId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  // 接收终端 cwd 变化，同步到连接状态
  const handleCwdChange = useCallback((tabId: string, cwd: string) => {
    setConnections(prev => prev.map(c => c.id === tabId ? { ...c, cwd } : c))
  }, [])

  const activeConn = connections.find(c => c.id === activeConnId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)' }}>
      <div className="titlebar" />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          savedHosts={savedHosts}
          connections={connections}
          activeConnId={activeConnId}
          onConnect={() => setShowConnectModal(true)}
          onSelectHost={(host) => handleConnect({ ...host, save: false })}
          onSelectTab={setActiveConnId}
          onToggleFiles={() => setShowFilePanel(p => !p)}
          showFilePanel={showFilePanel}
          onDeleteHost={(id) => {
            const updated = savedHosts.filter(h => h.id !== id)
            setSavedHosts(updated)
            localStorage.setItem('savedHosts', JSON.stringify(updated))
          }}
        />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 终端区域 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* 标签页 */}
            {connections.length > 0 && (
              <div style={{
                display: 'flex', background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0
              }}>
                {connections.map(conn => (
                  <div
                    key={conn.id}
                    onClick={() => setActiveConnId(conn.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 14px', cursor: 'pointer',
                      borderRight: '1px solid var(--border)',
                      background: conn.id === activeConnId ? 'var(--bg-tertiary)' : 'transparent',
                      color: conn.id === activeConnId ? 'var(--text-primary)' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap', fontSize: 13
                    }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: conn.status === 'connected' ? 'var(--success)' :
                        conn.status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
                    }} />
                    <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{conn.label}</span>
                    {/* 当前目录提示 */}
                    {conn.cwd && conn.id === activeConnId && (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {conn.cwd}
                      </span>
                    )}
                    <span
                      onClick={(e) => { e.stopPropagation(); handleCloseTab(conn.id) }}
                      style={{ marginLeft: 2, opacity: 0.4, cursor: 'pointer' }}
                    >✕</span>
                  </div>
                ))}
                <div
                  onClick={() => setShowConnectModal(true)}
                  style={{ padding: '6px 14px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}
                >+</div>
              </div>
            )}

            {/* 终端内容 */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {connections.length === 0 ? (
                <WelcomeScreen onConnect={() => setShowConnectModal(true)} />
              ) : (
                connections.map(conn => (
                  <div key={conn.id} style={{ height: '100%', display: conn.id === activeConnId ? 'block' : 'none' }}>
                    {conn.connId && (
                      <Terminal
                        connId={conn.connId}
                        active={conn.id === activeConnId}
                        onCwdChange={(cwd) => handleCwdChange(conn.id, cwd)}
                      />
                    )}
                    {conn.status === 'connecting' && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', gap: 10 }}>
                        <span>⏳</span> 正在连接 {conn.host}...
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 文件面板 - 接收 cwd 同步 */}
          {showFilePanel && activeConn?.connId && activeConn.status === 'connected' && (
            <FilePanel
              connId={activeConn.connId}
              syncPath={activeConn.cwd}
              onClose={() => setShowFilePanel(false)}
            />
          )}
        </div>
      </div>

      {showConnectModal && (
        <ConnectModal
          onConnect={handleConnect}
          onClose={() => setShowConnectModal(false)}
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
