import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import {
  LayoutDashboard, Table2, MessageSquare, Upload, Camera,
  Activity, Settings, LogOut, Send
} from 'lucide-react'

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
  const items = profile?.role === 'builder' ? builderNav : navItems

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">VTC Scorecard</h1>
        <p className="text-xs text-gray-500 mt-1">{profile?.full_name || profile?.email}</p>
        <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
          {profile?.role}
        </span>
      </div>

      <nav className="flex-1 p-4 space-y-1">
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

      <div className="p-4 border-t border-gray-200">
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
