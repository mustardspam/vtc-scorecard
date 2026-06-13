import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useState } from 'react'
import {
  LayoutDashboard, Table2, MessageSquare, Upload, Camera,
  Activity, Settings, LogOut, Send, KeyRound, X, Database
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'manager', 'viewer'] },
  { to: '/scores', icon: Table2, label: 'Scores', roles: ['admin', 'manager', 'viewer'] },
  { to: '/data', icon: Database, label: 'Data', roles: ['admin', 'manager', 'viewer'] },
  { to: '/feedback/submit', icon: Send, label: 'Submit Feedback', roles: ['admin', 'manager', 'viewer'] },
  { to: '/feedback', icon: MessageSquare, label: 'Feedback Review', roles: ['admin', 'manager'] },
  { to: '/uploads', icon: Upload, label: 'Uploads', roles: ['admin', 'manager'] },
  { to: '/snapshots', icon: Camera, label: 'Snapshots', roles: ['admin', 'manager', 'viewer'] },
  { to: '/activity', icon: Activity, label: 'Activity', roles: ['admin', 'manager', 'viewer'] },
  { to: '/admin', icon: Settings, label: 'Admin', roles: ['admin'] },
]

const builderNav = [
  { to: '/feedback/submit', icon: MessageSquare, label: 'Submit Feedback', roles: ['builder'] },
]

export default function Sidebar() {
  const { profile, logout } = useAuth()
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const items = profile?.role === 'builder' ? builderNav : navItems

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwError('')
    setPwMsg('')
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match.'); return }
    if (newPassword.length < 8) { setPwError('Min. 8 characters.'); return }
    setPwLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwLoading(false)
    if (error) { setPwError(error.message); return }
    setPwMsg('Password updated successfully.')
    setNewPassword('')
    setConfirmPassword('')
    setTimeout(() => { setShowChangePassword(false); setPwMsg('') }, 2000)
  }

  return (
    <aside className="w-64 flex flex-col h-screen fixed left-0 top-0" style={{ backgroundColor: '#1c1c1a' }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <img
          src="/vtc-scorecard/aw-stl-logo.jpg"
          alt="Ashton Woods / Starlight Homes"
          className="w-full max-w-[180px]"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
        <p className="text-xs mt-3 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {profile?.full_name || profile?.email}
        </p>
        <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded" style={{ backgroundColor: 'rgba(8,116,130,0.35)', color: '#6dd4de' }}>
          {profile?.role}
        </span>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {items.filter(item => item.roles.includes(profile?.role)).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'text-white'
                  : 'hover:text-white'
              }`
            }
            style={({ isActive }) => isActive
              ? { backgroundColor: '#087482', color: '#fff' }
              : { color: 'rgba(255,255,255,0.55)' }
            }
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-0.5">
        {showChangePassword && (
          <div className="mb-3 p-3 rounded-lg border border-white/10" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>Change Password</span>
              <button onClick={() => { setShowChangePassword(false); setPwError(''); setPwMsg('') }}>
                <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.4)' }} />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-2">
              {pwError && <p className="text-xs text-red-400">{pwError}</p>}
              {pwMsg && <p className="text-xs text-green-400">{pwMsg}</p>}
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full px-2 py-1.5 text-xs rounded outline-none border border-white/10"
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)' }}
                required
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-2 py-1.5 text-xs rounded outline-none border border-white/10"
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)' }}
                required
              />
              <button
                type="submit"
                disabled={pwLoading}
                className="w-full py-1.5 text-xs text-white rounded disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#087482' }}
              >
                {pwLoading ? 'Saving...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

        <button
          onClick={() => setShowChangePassword(v => !v)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full transition-colors hover:text-white"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          <KeyRound className="w-4 h-4" />
          Change Password
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full transition-colors hover:text-white"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
