import React, { useState, useEffect } from 'react'
import { SavedHost } from '../App'

interface Props {
  editHost?: SavedHost | null   // 有值则为编辑模式
  onConnect: (config: any) => void
  onClose: () => void
}

type AuthType = 'password' | 'privateKey'

export default function ConnectModal({ editHost, onConnect, onClose }: Props) {
  const isEdit = !!editHost

  const [form, setForm] = useState({
    label: '', host: '', port: '22', username: 'root',
    authType: 'password' as AuthType,
    password: '', privateKeyPath: '', passphrase: '', save: true
  })
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [error, setError] = useState('')

  // 编辑模式：预填表单
  useEffect(() => {
    if (editHost) {
      setForm({
        label: editHost.label,
        host: editHost.host,
        port: String(editHost.port),
        username: editHost.username,
        authType: editHost.authType,
        password: editHost.password || '',
        privateKeyPath: editHost.privateKeyPath || '',
        passphrase: editHost.passphrase || '',
        save: true
      })
    }
  }, [editHost])

  const set = (k: string, v: any) => {
    setForm(p => ({ ...p, [k]: v }))
    setTestResult(null)
    setError('')
  }

  // 连通性测试：尝试连接后立即断开
  const handleTest = async () => {
    if (!form.host || !form.username) {
      setError('请填写主机和用户名')
      return
    }
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const api = (window as any).electronAPI
      const res = await api.sshConnect({
        host: form.host,
        port: parseInt(form.port) || 22,
        username: form.username,
        authType: form.authType,
        password: form.password,
        privateKeyPath: form.privateKeyPath,
        passphrase: form.passphrase,
        testOnly: true   // 主进程收到此标志后连接成功即断开
      })
      if (res.success) {
        setTestResult({ ok: true, msg: `连接成功！延迟 ${res.latency ?? '--'}ms` })
      } else {
        setTestResult({ ok: false, msg: res.error || '连接失败' })
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message || '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.host || !form.username) { setError('请填写主机和用户名'); return }
    setConnecting(true)
    setError('')
    try {
      await onConnect({
        label: form.label || `${form.username}@${form.host}`,
        host: form.host,
        port: parseInt(form.port) || 22,
        username: form.username,
        authType: form.authType,
        password: form.password,
        privateKeyPath: form.privateKeyPath,
        passphrase: form.passphrase,
        save: form.save,
        editId: editHost?.id   // 编辑时传原 id
      })
    } catch (e: any) {
      setError(e.message || '连接失败')
      setConnecting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 12, padding: 24,
        width: 420, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
      }}>
        {/* 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {isEdit ? '✏️ 编辑连接' : '🔐 新建连接'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 名称 */}
          <div>
            <label style={labelStyle}>名称（可选）</label>
            <input style={inputStyle} value={form.label} onChange={e => set('label', e.target.value)} placeholder={`${form.username}@${form.host || 'host'}`} />
          </div>

          {/* 主机 + 端口 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
            <div>
              <label style={labelStyle}>主机</label>
              <input style={inputStyle} value={form.host} onChange={e => set('host', e.target.value)} placeholder="192.168.1.1" required />
            </div>
            <div>
              <label style={labelStyle}>端口</label>
              <input style={inputStyle} value={form.port} onChange={e => set('port', e.target.value)} placeholder="22" />
            </div>
          </div>

          {/* 用户名 */}
          <div>
            <label style={labelStyle}>用户名</label>
            <input style={inputStyle} value={form.username} onChange={e => set('username', e.target.value)} placeholder="root" required />
          </div>

          {/* 认证方式 */}
          <div>
            <label style={labelStyle}>认证方式</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['password', 'privateKey'] as AuthType[]).map(t => (
                <button key={t} type="button"
                  onClick={() => set('authType', t)}
                  style={{
                    flex: 1, padding: '7px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    border: `1px solid ${form.authType === t ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.authType === t ? 'rgba(91,141,238,0.15)' : 'var(--bg-tertiary)',
                    color: form.authType === t ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {t === 'password' ? '🔑 密码' : '📄 私钥'}
                </button>
              ))}
            </div>
          </div>

          {/* 密码 / 私钥 */}
          {form.authType === 'password' ? (
            <div>
              <label style={labelStyle}>密码</label>
              <input style={inputStyle} type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••••" />
            </div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>私钥路径</label>
                <input style={inputStyle} value={form.privateKeyPath} onChange={e => set('privateKeyPath', e.target.value)} placeholder="~/.ssh/id_rsa" />
              </div>
              <div>
                <label style={labelStyle}>Passphrase（可选）</label>
                <input style={inputStyle} type="password" value={form.passphrase} onChange={e => set('passphrase', e.target.value)} placeholder="私钥密码" />
              </div>
            </>
          )}

          {/* 连通性测试结果 */}
          {testResult && (
            <div style={{
              padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: testResult.ok ? 'rgba(80,250,123,0.1)' : 'rgba(255,85,85,0.1)',
              color: testResult.ok ? 'var(--success)' : 'var(--danger)',
              border: `1px solid ${testResult.ok ? 'rgba(80,250,123,0.3)' : 'rgba(255,85,85,0.3)'}`,
            }}>
              {testResult.ok ? '✅ ' : '❌ '}{testResult.msg}
            </div>
          )}

          {/* 错误 */}
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 12, padding: '6px 10px', background: 'rgba(255,85,85,0.1)', borderRadius: 6 }}>
              {error}
            </div>
          )}

          {/* 保存开关 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={form.save} onChange={e => set('save', e.target.checked)} />
            保存到主机列表
          </label>

          {/* 按钮行 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || connecting}
              style={{
                flex: 1, padding: '10px', background: 'var(--bg-hover)',
                border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                opacity: testing ? 0.7 : 1
              }}
            >
              {testing ? '测试中...' : '🔍 测试连接'}
            </button>
            <button
              type="submit"
              disabled={connecting || testing}
              style={{
                flex: 2, padding: '10px', background: 'var(--accent)',
                border: 'none', borderRadius: 8, color: '#fff',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                opacity: connecting ? 0.7 : 1
              }}
            >
              {connecting ? '连接中...' : isEdit ? '保存并连接' : '连接'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 4, fontSize: 11,
  color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase'
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, outline: 'none',
}
