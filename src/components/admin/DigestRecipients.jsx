import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { logActivity } from '../../hooks/useActivityLog'
import { Mail, Plus, Trash2, Users } from 'lucide-react'

export default function DigestRecipients() {
  const { user } = useAuth()
  const [emails, setEmails] = useState([])
  const [users, setUsers] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [configRes, usersRes] = await Promise.all([
        supabase.from('system_config').select('value').eq('key', 'digest_recipients').single(),
        supabase.from('profiles').select('email, full_name, role').eq('is_active', true).order('email'),
      ])

      const { data, error } = configRes
      if (error && error.code !== 'PGRST116') throw error
      if (data?.value) {
        try {
          const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
          setEmails(Array.isArray(parsed) ? parsed : [])
        } catch { setEmails([]) }
      } else {
        setEmails([])
      }

      if (usersRes.error) throw usersRes.error
      setUsers(usersRes.data || [])
    } catch (err) {
      console.error('DigestRecipients load error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function save(list) {
    setSaving(true)
    setMsg('')
    try {
      const { error } = await supabase.from('system_config').upsert(
        { key: 'digest_recipients', value: JSON.stringify(list), updated_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      if (error) throw error
      await logActivity('rules_updated', 'Updated digest recipients', { recipients: list })
      setMsg('Saved')
      setTimeout(() => setMsg(''), 3000)
    } catch (err) {
      setMsg('Error: ' + (err.message || 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  function addEmail() {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return
    if (emails.includes(trimmed) || userEmails.has(trimmed)) { setNewEmail(''); return }
    const updated = [...emails, trimmed]
    setEmails(updated)
    setNewEmail('')
    save(updated)
  }

  function removeEmail(email) {
    const updated = emails.filter(e => e !== email)
    setEmails(updated)
    save(updated)
  }

  const userEmails = new Set(users.map(u => (u.email || '').trim().toLowerCase()).filter(Boolean))
  // Hide any manual address that duplicates an account email.
  const externalEmails = emails.filter(e => !userEmails.has((e || '').trim().toLowerCase()))
  const totalRecipients = userEmails.size + externalEmails.length

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Mail className="w-4 h-4 text-teal-600" />
          Digest Email Recipients
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">Every active user automatically receives the weekly digest (sent Mondays at 8am ET). Use the box below only to add <span className="font-medium">extra</span> external addresses that don't have an account.</p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Active users (auto-enrolled)</span>
          <span className="text-xs text-gray-400">{userEmails.size}</span>
        </div>
        {users.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No active users.</p>
        ) : (
          <ul className="space-y-1.5">
            {users.map(u => (
              <li key={u.email} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-sm text-gray-700">
                  {u.email}
                  {u.full_name && <span className="text-gray-400"> · {u.full_name}</span>}
                </span>
                <span className="text-[11px] text-gray-400 capitalize px-2 py-0.5 bg-white rounded border border-gray-100">{u.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Plus className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Extra external addresses</span>
        <span className="text-xs text-gray-400">{externalEmails.length}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addEmail()}
          placeholder="name@company.com"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:border-teal-500"
        />
        <button
          onClick={addEmail}
          disabled={saving || !newEmail.trim()}
          className="flex items-center gap-1 px-3 py-2 text-sm text-white rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#087482' }}
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {externalEmails.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No external addresses added.</p>
      ) : (
        <ul className="space-y-1.5">
          {externalEmails.map(email => (
            <li key={email} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-sm text-gray-700">{email}</span>
              <button onClick={() => removeEmail(email)} className="text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
        {totalRecipients} total recipient{totalRecipients === 1 ? '' : 's'} will receive the next digest.
      </p>

      {msg && (
        <p className={`text-xs font-medium ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>
      )}
    </div>
  )
}
