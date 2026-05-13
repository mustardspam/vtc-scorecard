import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useState } from 'react'
import {
  LayoutDashboard, Table2, MessageSquare, Upload, Camera,
  Activity, Settings, LogOut, Send, KeyRound, X
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'manager', 'viewer'] },
  { to: '/scores', icon: Table2, label: 'Scores', roles: ['admin', 'manager', 'viewer'] },
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
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">VTC Scorecard</h1>
        <p className="text-xs text-gray-500 mt-1 truncate">{profile?.full_name || profile?.email}</p>
        <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
          {profile?.role}
        </span>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {items.filter(item => item.roles.includes(profile?.role)).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200 space-y-1">
        {/* Change password modal */}
        {showChangePassword && (
          <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-700">Change Password</span>
              <button onClick={() => { setShowChangePassword(false); setPwError(''); setPwMsg('') }}>
                <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-2">
              {pwError && <p className="text-xs text-red-600">{pwError}</p>}
              {pwMsg && <p className="text-xs text-green-600">{pwMsg}</p>}
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                required
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                required
              />
              <button
                type="submit"
                disabled={pwLoading}
                className="w-full py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {pwLoading ? 'Saving...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

        <button
          onClick={() => setShowChangePassword(v => !v)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 w-full"
        >
          <KeyRound className="w-5 h-5" />
          Change Password
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 w-full"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
