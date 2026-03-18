import React, { useState } from 'react'
import { SavedHost } from '../App'

interface Connection {
  id: string
  label: string
  host: string
  username: string
  status: 'connected' | 'connecting' | 'disconnected'
  cwd?: string
}

interface Props {
  savedHosts: SavedHost[]
  connections: Connection[]
  activeConnId: string | null
  showFilePanel: boolean
  onConnect: () => void
  onSelectHost: (host: SavedHost) => void
  onEditHost: (host: SavedHost) => void
  onDeleteHost: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onToggleFiles: () => void
}

export default function Sidebar({
  savedHosts, connections, activeConnId, showFilePanel,
  onConnect, onSelectHost, onEditHost, onDeleteHost,
  onSelectTab, onCloseTab, onToggleFiles
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [hoveredHost, setHoveredHost] = useState<string | null>(null)
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  if (collapsed) {
    return (
      <div style={{ width: 36, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 8 }}>
        <button onClick={() => setCollapsed(false)} style={iconBtn} title="展开侧边栏">☰</button>
        <button onClick={onConnect} style={iconBtn} title="新建连接">＋</button>
      </div>
    )
  }

  return (
    <div style={{ width: 220, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* 标题栏 */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 16 }}>🐦</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>鸬鹚SSH</span>
        <button onClick={() => setCollapsed(true)} style={iconBtn} title="收起">◀</button>
      </div>

      {/* 工具栏 */}
      <div style={{ padding: '6px 8px', display: 'flex', gap: 6, borderBottom: '1px solid var(--border)' }}>
        <button onClick={onConnect} style={{ ...toolBtn, color: 'var(--accent)', fontWeight: 700 }}>＋ 连接</button>
        <button
          onClick={onToggleFiles}
          style={{ ...toolBtn, color: showFilePanel ? 'var(--success)' : 'var(--text-secondary)' }}
        >
          📁 文件
        </button>
      </div>

      {/* 活跃会话 */}
      {connections.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 1, textTransform: 'uppercase' }}>
            活跃会话
          </div>
          {connections.map(conn => (
            <div
              key={conn.id}
              onClick={() => onSelectTab(conn.id)}
              onMouseEnter={() => setHoveredTab(conn.id)}
              onMouseLeave={() => setHoveredTab(null)}
              style={{
                padding: '6px 10px', cursor: 'pointer', position: 'relative',
                background: activeConnId === conn.id ? 'var(--bg-hover)' : 'transparent',
                borderLeft: activeConnId === conn.id ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* 状态指示灯 */}
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: conn.status === 'connected' ? 'var(--success)' : conn.status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conn.label}
                  </div>
                  {conn.cwd && (
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conn.cwd}
                    </div>
                  )}
                </div>
                {hoveredTab === conn.id && (
                  <button
                    onClick={e => { e.stopPropagation(); onCloseTab(conn.id) }}
                    style={{ ...iconBtn, fontSize: 11, color: 'var(--danger)', padding: '1px 4px' }}
                  >✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 已保存主机 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 1, textTransform: 'uppercase' }}>
          已保存主机
        </div>
        {savedHosts.length === 0 ? (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
            暂无保存的主机
          </div>
        ) : (
          savedHosts.map(host => (
            <div
              key={host.id}
              onClick={() => onSelectHost(host)}
              onMouseEnter={() => setHoveredHost(host.id)}
              onMouseLeave={() => setHoveredHost(null)}
              style={{
                padding: '7px 10px', cursor: 'pointer', position: 'relative',
                background: hoveredHost === host.id ? 'var(--bg-hover)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>🖥</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {host.label}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 1, color: 'var(--text-secondary)' }}>
                    {host.username}@{host.host}:{host.port}
                  </div>
                </div>
                {/* 编辑 & 删除按钮（hover 时显示） */}
                {hoveredHost === host.id && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={e => { e.stopPropagation(); onEditHost(host) }}
                      title="编辑"
                      style={{ ...iconBtn, fontSize: 12, color: 'var(--accent)', padding: '2px 5px' }}
                    >✎</button>
                    <button
                      onClick={e => { e.stopPropagation(); onDeleteHost(host.id) }}
                      title="删除"
                      style={{ ...iconBtn, fontSize: 12, color: 'var(--danger)', padding: '2px 5px' }}
                    >✕</button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 14, padding: '4px',
  borderRadius: 4, lineHeight: 1,
}

const toolBtn: React.CSSProperties = {
  flex: 1, padding: '5px 8px', background: 'var(--bg-hover)',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
}
