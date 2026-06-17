import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { RefreshCw, UserCheck, UserX, Info } from 'lucide-react'

const ROLES = ['admin', 'manager', 'viewer']

const ROLE_DESCRIPTIONS = {
  admin: 'Full access — manage users, uploads, settings',
  manager: 'Upload data, review feedback, view all reports',
  viewer: 'Read-only access to everything except Admin; can submit their own feedback (Construction Managers)',
}

export default function UserManager() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }

  async function handleRoleChange(userId, newRole, email) {
    const oldUser = users.find(u => u.id === userId)
    await supabase.from('profiles')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
    await logActivity('user_role_changed', `Changed role for ${email}`, {
      target_user: email, before_role: oldUser?.role, after_role: newRole
    })
    loadUsers()
  }

  async function handleNameSave(userId, fullName, email) {
    await supabase.from('profiles').update({ full_name: fullName }).eq('id', userId)
    await logActivity('user_updated', `Updated name for ${email}`, { full_name: fullName })
    loadUsers()
  }

  async function handleToggleActive(userId, email, currentActive) {
    await supabase.from('profiles')
      .update({ is_active: !currentActive })
      .eq('id', userId)
    await logActivity(
      currentActive ? 'user_disabled' : 'user_enabled',
      `${currentActive ? 'Disabled' : 'Enabled'} user ${email}`
    )
    loadUsers()
  }

  async function handleToggleAreaManager(userId, email, current) {
    await supabase.from('profiles').update({ is_area_manager: !current }).eq('id', userId)
    loadUsers()
  }

  const pending = users.filter(u => u.role === 'viewer' && !u.full_name)
  const active = users.filter(u => !(u.role === 'viewer' && !u.full_name))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
        <button onClick={loadUsers} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-1">How to add users (no email required)</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-700 text-xs">
            <li>Send the user to <span className="font-mono bg-blue-100 px-1 rounded">vtcouncil.online/login</span></li>
            <li>They click <strong>Create Account</strong>, enter their name, email and choose a password</li>
            <li>Their account appears below — set their role and they're in</li>
          </ol>
        </div>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-2 gap-2">
        {ROLES.map(r => (
          <div key={r} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded mt-0.5 ${
              r === 'admin' ? 'bg-purple-100 text-purple-700' :
              r === 'manager' ? 'bg-blue-100 text-blue-700' :
              r === 'viewer' ? 'bg-green-100 text-green-700' :
              'bg-yellow-100 text-yellow-700'
            }`}>{r}</span>
            <span className="text-xs text-gray-500">{ROLE_DESCRIPTIONS[r]}</span>
          </div>
        ))}
      </div>

      {/* Pending new signups */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-1">
            <span className="w-2 h-2 bg-orange-500 rounded-full inline-block" />
            New signups awaiting role assignment ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map(u => (
              <PendingUserRow
                key={u.id}
                u={u}
                isSelf={u.id === user.id}
                onRoleChange={handleRoleChange}
                onNameSave={handleNameSave}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        </div>
      )}

      {/* All users */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">All Users ({active.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Email</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Name</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Role</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Map Mgr</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Status</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {active.map(u => (
                <UserRow
                  key={u.id}
                  u={u}
                  isSelf={u.id === user.id}
                  onRoleChange={handleRoleChange}
                  onToggleActive={handleToggleActive}
                  onToggleAreaManager={handleToggleAreaManager}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PendingUserRow({ u, isSelf, onRoleChange, onNameSave, onToggleActive }) {
  const [role, setRole] = useState('viewer')
  const [name, setName] = useState(u.full_name || '')
  const [saving, setSaving] = useState(false)

  async function approve() {
    setSaving(true)
    if (name) await onNameSave(u.id, name, u.email)
    await onRoleChange(u.id, role, u.email)
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{u.email}</p>
        <p className="text-xs text-gray-400">{new Date(u.created_at).toLocaleString()}</p>
      </div>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Full name"
        className="px-2 py-1 border border-gray-300 rounded text-xs w-36"
      />
      <select
        value={role}
        onChange={e => setRole(e.target.value)}
        className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
      >
        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <button
        onClick={approve}
        disabled={saving}
        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        <UserCheck className="w-3.5 h-3.5" />
        {saving ? 'Saving...' : 'Approve'}
      </button>
    </div>
  )
}

function UserRow({ u, isSelf, onRoleChange, onToggleActive, onToggleAreaManager }) {
  return (
    <tr className={!u.is_active ? 'opacity-40' : ''}>
      <td className="px-3 py-2 text-xs text-gray-700">{u.email}</td>
      <td className="px-3 py-2 text-xs text-gray-500">{u.full_name || '—'}</td>
      <td className="px-3 py-2">
        <select
          value={u.role}
          onChange={e => onRoleChange(u.id, e.target.value, u.email)}
          disabled={isSelf}
          className={`px-2 py-1 border border-gray-300 rounded text-xs bg-white disabled:opacity-50 ${
            u.role === 'admin' ? 'text-purple-700' :
            u.role === 'manager' ? 'text-blue-700' :
            u.role === 'viewer' ? 'text-green-700' : 'text-yellow-700'
          }`}
        >
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <button
          onClick={() => onToggleAreaManager(u.id, u.email, u.is_area_manager)}
          title="Toggle Coverage Map area manager"
          className={`w-8 h-5 rounded-full transition-colors relative flex-shrink-0 ${u.is_area_manager ? 'bg-teal-500' : 'bg-gray-200'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${u.is_area_manager ? 'translate-x-3' : 'translate-x-0.5'}`} />
        </button>
      </td>
      <td className="px-3 py-2">
        <button
          onClick={() => onToggleActive(u.id, u.email, u.is_active)}
          disabled={isSelf}
          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded disabled:cursor-default ${
            u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {u.is_active ? <><UserCheck className="w-3 h-3" /> Active</> : <><UserX className="w-3 h-3" /> Disabled</>}
        </button>
      </td>
      <td className="px-3 py-2 text-xs text-gray-400">
        {new Date(u.created_at).toLocaleDateString()}
      </td>
    </tr>
  )
}
