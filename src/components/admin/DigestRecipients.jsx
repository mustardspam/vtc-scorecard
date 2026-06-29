import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { logActivity } from '../../hooks/useActivityLog'
import { Mail, Plus, Trash2 } from 'lucide-react'

export default function DigestRecipients() {
  const { user } = useAuth()
  const [emails, setEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'digest_recipients')
        .single()
      if (error && error.code !== 'PGRST116') throw error
      if (data?.value) {
        try { setEmails(JSON.parse(data.value)) } catch { setEmails([]) }
      }
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
    if (emails.includes(trimmed)) { setNewEmail(''); return }
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

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Mail className="w-4 h-4 text-teal-600" />
          Digest Email Recipients
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">Every signed-in user automatically receives the weekly digest (sent Mondays at 8am ET). Use the box below only to add <span className="font-medium">extra</span> external addresses that don't have an account.</p>
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

      {emails.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No recipients yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {emails.map(email => (
            <li key={email} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-sm text-gray-700">{email}</span>
              <button onClick={() => removeEmail(email)} className="text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {msg && (
        <p className={`text-xs font-medium ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>
      )}
    </div>
  )
}
