import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AppBrand from '../components/layout/AppBrand'

export default function ResetPasswordPage() {
  const [status, setStatus] = useState('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const searchParams = new URLSearchParams(window.location.search)
    const hasRecoveryToken = hashParams.get('access_token') || searchParams.get('code')

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready')
      else if (event === 'SIGNED_IN' && hasRecoveryToken) setStatus('ready')
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setStatus('ready')
      else if (!hasRecoveryToken) setStatus('invalid')
    })

    const timeout = setTimeout(() => {
      setStatus(prev => prev === 'loading' ? 'invalid' : prev)
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const labelClass = 'block text-sm font-medium mb-1'
  const labelStyle = { color: 'var(--g-text)' }

  return (
    <div className="glass-auth-screen">
      <div className="glass-auth-card">
        <div className="mb-6">
          <AppBrand centered />
        </div>

        {status === 'loading' && (
          <div className="text-center py-6">
            <div className="app-loading-spinner mx-auto" />
          </div>
        )}

        {status === 'invalid' && (
          <div className="text-center py-4">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--g-text)' }}>Invalid or expired link</p>
            <p className="text-sm mb-4" style={{ color: 'var(--g-dim)' }}>This password reset link has expired. Please request a new one.</p>
            <button type="button" onClick={() => navigate('/login')} className="glass-link text-sm bg-transparent border-none cursor-pointer">
              Back to sign in →
            </button>
          </div>
        )}

        {status === 'ready' && success && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: '#dcf2e4' }}>
              <svg className="w-6 h-6" style={{ color: '#1f7a44' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--g-text)' }}>Password updated!</p>
            <p className="text-sm mt-1" style={{ color: 'var(--g-dim)' }}>Taking you to the dashboard...</p>
          </div>
        )}

        {status === 'ready' && !success && (
          <>
            <div className="mb-6">
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--g-text)' }}>Set a new password</p>
              <p className="text-sm" style={{ color: 'var(--g-dim)' }}>Choose a strong password for your account.</p>
            </div>
            {error && (
              <div className="mb-4 p-3 text-sm rounded-xl" style={{ background: '#f8dada', color: '#a72727' }}>{error}</div>
            )}
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className={labelClass} style={labelStyle}>New Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="glass-input w-full" placeholder="Min. 8 characters" required />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="glass-input w-full" required />
              </div>
              <button type="submit" disabled={loading} className="glass-btn-primary w-full py-2.5">
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
