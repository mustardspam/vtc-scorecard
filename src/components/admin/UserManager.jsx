import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { Save, UserPlus } from 'lucide-react'

const ROLES = ['admin', 'manager', 'viewer', 'builder']

export default function UserManager() {
  const [users, setUsers] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const { user } = useAuth()

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setUsers(data || [])
  }

  async function handleRoleChange(userId, newRole, email) {
    const oldUser = users.find(u => u.id === userId)
    await supabase.from('profiles').update({ role: newRole, updated_at: new Date().toISOString() }).eq('id', userId)
    await logActivity('user_role_changed', `Changed role for ${email}`, { target_user: email, before_role: oldUser?.role, after_role: newRole })
    loadUsers()
  }

  async function handleToggleActive(userId, email, currentActive) {
    await supabase.from('profiles').update({ is_active: !currentActive }).eq('id', userId)
    loadUsers()
  }

  async function handleInvite() {
    if (!inviteEmail) return
    setInviting(true)
    try {
      const { error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail)
      if (error) throw error
      setInviteEmail('')
      alert(`Invite sent to ${inviteEmail}`)
    } catch (err) {
      alert('Note: User invites require Supabase service role key (admin API). Add the user through the Supabase dashboard instead, then set their role here.')
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">User Management</h2>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-sm text-yellow-800 font-medium">Invite New User</p>
        <p className="text-xs text-yellow-600 mt-1 mb-3">New users should be created in the Supabase dashboard. Once they sign up, set their role below.</p>
        <div className="flex items-center gap-3">
          <input type="email" placeholder="email@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={handleInvite} disabled={inviting || !inviteEmail}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <UserPlus className="w-4 h-4" /> Invite
          </button>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Role</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Joined</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map(u => (
            <tr key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
              <td className="px-3 py-2">{u.email}</td>
              <td className="px-3 py-2 text-gray-500">{u.full_name || '—'}</td>
              <td className="px-3 py-2">
                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u.id, e.target.value, u.email)}
                  disabled={u.id === user.id}
                  className="px-2 py-1 border border-gray-300 rounded text-xs bg-white disabled:opacity-50"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td className="px-3 py-2">
                <button
                  onClick={() => handleToggleActive(u.id, u.email, u.is_active)}
                  disabled={u.id === user.id}
                  className={`text-xs px-2 py-0.5 rounded cursor-pointer disabled:cursor-default ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                >
                  {u.is_active ? 'Active' : 'Disabled'}
                </button>
              </td>
              <td className="px-3 py-2 text-gray-400 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
