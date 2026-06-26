import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authErrorMessage } from '../lib/auth-errors'
import AppBrand from '../components/layout/AppBrand'

async function establishRecoverySession() {
  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const searchParams = new URLSearchParams(window.location.search)
  const code = searchParams.get('code')
  const hashType = hashParams.get('type')
  const hasHashToken = hashParams.has('access_token')

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
    return true
  }

  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (session && (hashType === 'recovery' || hasHashToken)) return true

  return new Promise((resolve) => {
    let subscription
    const timeout = setTimeout(() => {
      subscription?.unsubscribe()
      resolve(false)
    }, 12000)

    const listener = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && nextSession && (hashType === 'recovery' || hasHashToken || code))) {
        clearTimeout(timeout)
        subscription?.unsubscribe()
        resolve(true)
      }
    })
    subscription = listener.data.subscription
  })
}

export default function ResetPasswordPage() {
  const [status, setStatus] = useState('loading')
  const [initError, setInitError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const ready = await establishRecoverySession()
        if (cancelled) return
        if (ready) setStatus('ready')
        else setStatus('invalid')
      } catch (err) {
        if (cancelled) return
        setInitError(authErrorMessage(err))
        setStatus('invalid')
      }
    }

    init()
    return () => { cancelled = true }
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
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(authErrorMessage(err))
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
            <p className="text-sm mt-4" style={{ color: 'var(--g-dim)' }}>Verifying reset link...</p>
          </div>
        )}

        {status === 'invalid' && (
          <div className="text-center py-4">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--g-text)' }}>Invalid or expired link</p>
            <p className="text-sm mb-4" style={{ color: 'var(--g-dim)' }}>
              {initError || 'This password reset link has expired or was already used. Request a new one from the sign-in page.'}
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--g-dim)' }}>
              Tip: open the reset link on the same device and browser where you clicked &quot;Forgot password?&quot; Links expire after about an hour.
            </p>
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
            <p className="text-sm mt-1" style={{ color: 'var(--g-dim)' }}>Taking you to sign in...</p>
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
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="glass-input w-full" placeholder="Min. 8 characters" required autoComplete="new-password" />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="glass-input w-full" required autoComplete="new-password" />
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
