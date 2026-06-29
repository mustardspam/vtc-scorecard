import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../context/ThemeContext'
import { useState } from 'react'
import { cn } from '../../lib/cn'
import {
  LayoutDashboard, Table2, MessageSquare, Upload, Camera,
  Activity, Settings, LogOut, Send, KeyRound, X, Database, Sun, Moon, MapPin, Mail, Map, Users
} from 'lucide-react'
import { authErrorMessage } from '../../lib/auth-errors'
import { supabase } from '../../lib/supabase'
import AppBrand from './AppBrand'

const ALL_STAFF = ['admin', 'manager', 'viewer']

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_STAFF },
  { to: '/scores', icon: Table2, label: 'Scores', roles: ALL_STAFF },
  { to: '/data', icon: Database, label: 'Data', roles: ALL_STAFF },
  { to: '/feedback/submit', icon: Send, label: 'Submit Feedback', roles: ALL_STAFF },
  { to: '/feedback', icon: MessageSquare, label: 'Feedback Review', roles: ALL_STAFF, end: true },
  { to: '/uploads', icon: Upload, label: 'Uploads', roles: ALL_STAFF },
  { to: '/community', icon: MapPin, label: 'Communities', roles: ALL_STAFF },
  { to: '/teams', icon: Users, label: 'Teams', roles: ALL_STAFF },
  { to: '/map', icon: Map, label: 'Coverage Map', roles: ALL_STAFF },
  { to: '/permits', icon: Activity, label: 'Permit Pulse', roles: ALL_STAFF },
  { to: '/snapshots', icon: Camera, label: 'Snapshots', roles: ALL_STAFF },
  { to: '/activity', icon: Activity, label: 'Activity', roles: ALL_STAFF },
  { to: '/digest', icon: Mail, label: 'Digest Email', roles: ALL_STAFF },
  { to: '/admin', icon: Settings, label: 'Admin', roles: ['admin'] },
]

function initials(name, email) {
  if (name) return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (email || '?')[0].toUpperCase()
}

export default function Sidebar() {
  const { profile, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const items = navItems

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwError('')
    setPwMsg('')
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match.'); return }
    if (newPassword.length < 8) { setPwError('Min. 8 characters.'); return }
    setPwLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwLoading(false)
    if (error) { setPwError(authErrorMessage(error)); return }
    setPwMsg('Password updated successfully.')
    setNewPassword('')
    setConfirmPassword('')
    setTimeout(() => { setShowChangePassword(false); setPwMsg('') }, 2000)
  }

  return (
    <aside className="w-[236px] flex flex-col h-screen fixed left-0 top-0 z-30 glass-sidebar" style={{ padding: '22px 14px' }}>
      {/* Logo */}
      <div className="pb-5 mb-1 border-b" style={{ borderColor: 'var(--g-line)' }}>
        <AppBrand />
      </div>

      <nav className="flex-1 overflow-y-auto space-y-0.5 py-2">
        {items.filter(item => item.roles.includes(profile?.role)).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all duration-[120ms]',
              isActive ? 'glass-nav-active' : 'glass-nav-item'
            )}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="pt-3 border-t space-y-0.5" style={{ borderColor: 'var(--g-line)' }}>
        {/* Avatar + profile */}
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: 'var(--g-accent-gradient)', color: '#fff' }}
          >
            {initials(profile?.full_name, profile?.email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--g-text)' }}>
              {profile?.full_name || profile?.email}
            </p>
            <p className="text-[10px] capitalize" style={{ color: 'var(--g-dim)' }}>{profile?.role}</p>
          </div>
        </div>

        {showChangePassword && (
          <div className="mb-2 p-3 rounded-xl border" style={{ background: 'var(--g-panel-2)', borderColor: 'var(--g-line)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: 'var(--g-text)' }}>Change Password</span>
              <button type="button" onClick={() => { setShowChangePassword(false); setPwError(''); setPwMsg('') }}>
                <X className="w-3.5 h-3.5" style={{ color: 'var(--g-dim)' }} />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-2">
              {pwError && <p className="text-xs" style={{ color: '#a72727' }}>{pwError}</p>}
              {pwMsg && <p className="text-xs" style={{ color: '#1f7a44' }}>{pwMsg}</p>}
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password" className="glass-input w-full text-xs" required />
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" className="glass-input w-full text-xs" required />
              <button type="submit" disabled={pwLoading} className="glass-btn-primary w-full text-xs py-1.5">
                {pwLoading ? 'Saving...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium w-full glass-nav-item"
        >
          <span className="flex items-center gap-3">
            {dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {dark ? 'Dark Mode' : 'Light Mode'}
          </span>
          <span
            className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200"
            style={{ background: dark ? 'var(--g-accent)' : 'var(--g-line)' }}
          >
            <span
              className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
              style={{ transform: dark ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </span>
        </button>

        <button type="button" onClick={() => setShowChangePassword(v => !v)} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full glass-nav-item">
          <KeyRound className="w-4 h-4" />
          Change Password
        </button>
        <button type="button" onClick={logout} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full glass-nav-item">
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
