import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { authErrorMessage, normalizeEmail } from '../lib/auth-errors'
import { cn } from '../lib/cn'
import AppBrand from '../components/layout/AppBrand'

export default function LoginPage() {
  const [tab, setTab] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(normalizeEmail(email), password)
      navigate('/dashboard')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const normalized = normalizeEmail(email)
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (resetError) throw resetError
      setForgotSent(true)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  function switchTab(newTab) {
    setTab(newTab)
    setError('')
    setSignupSuccess(false)
    setForgotSent(false)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const normalized = normalizeEmail(email)
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: { data: { full_name: fullName.trim() } },
      })
      if (signUpError) throw signUpError
      if (data.session) {
        await supabase.auth.signOut()
      }
      setSignupSuccess(true)
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

        {tab !== 'forgot' && (
          <div className="glass-auth-tabs">
            <button type="button" onClick={() => switchTab('signin')} className={cn('glass-auth-tab', tab === 'signin' && 'glass-auth-tab-active')}>
              Sign In
            </button>
            <button type="button" onClick={() => switchTab('signup')} className={cn('glass-auth-tab', tab === 'signup' && 'glass-auth-tab-active')}>
              Create Account
            </button>
          </div>
        )}

        {tab === 'forgot' && (
          <button type="button" onClick={() => switchTab('signin')} className="glass-link text-sm mb-4 bg-transparent border-none cursor-pointer">
            ← Back to sign in
          </button>
        )}

        {error && (
          <div className="mb-4 p-3 text-sm rounded-xl" style={{ background: '#f8dada', color: '#a72727', border: '1px solid #f8dada' }}>
            {error}
          </div>
        )}

        {tab === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className={labelClass} style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="glass-input w-full" required autoComplete="email" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelClass} style={labelStyle}>Password</label>
                <button type="button" onClick={() => switchTab('forgot')} className="glass-link text-xs bg-transparent border-none cursor-pointer">
                  Forgot password?
                </button>
              </div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="glass-input w-full" required autoComplete="current-password" />
            </div>
            <button type="submit" disabled={loading} className="glass-btn-primary w-full py-2.5">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <div className="rounded-xl p-3" style={{ background: 'rgba(217,147,22,0.12)', border: '1px solid rgba(217,147,22,0.25)' }}>
              <p className="text-xs mb-2" style={{ color: '#8a5a08' }}>
                <span className="font-semibold">First time here?</span> Your Okta login will not work on this portal — you need to create a separate account with a new password.
              </p>
              <button type="button" onClick={() => switchTab('signup')} className="glass-btn-secondary w-full text-sm py-2">
                Create an Account
              </button>
            </div>
          </form>
        )}

        {tab === 'signup' && (
          signupSuccess ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: '#dcf2e4' }}>
                <svg className="w-6 h-6" style={{ color: '#1f7a44' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--g-text)' }}>Account created!</p>
              <p className="text-sm mt-1" style={{ color: 'var(--g-dim)' }}>
                You can sign in now. An admin may adjust your role later, but you don&apos;t need to wait for approval to log in.
              </p>
              <button type="button" onClick={() => { switchTab('signin'); setPassword(''); setConfirmPassword('') }} className="glass-link text-sm mt-4 bg-transparent border-none cursor-pointer">
                Go to Sign In →
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className={labelClass} style={labelStyle}>Full Name</label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="glass-input w-full" placeholder="John Smith" required autoComplete="name" />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Work Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="glass-input w-full" required autoComplete="email" />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="glass-input w-full" placeholder="Min. 8 characters" required autoComplete="new-password" />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="glass-input w-full" required autoComplete="new-password" />
              </div>
              <button type="submit" disabled={loading} className="glass-btn-primary w-full py-2.5">
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
              <p className="text-xs text-center" style={{ color: 'var(--g-dim)' }}>
                Use your work email. If you already signed up, use Sign In or Forgot password instead.
              </p>
            </form>
          )
        )}

        {tab === 'forgot' && (
          forgotSent ? (
            <div className="text-center py-4">
              <p className="text-sm font-medium" style={{ color: 'var(--g-text)' }}>Check your email</p>
              <p className="text-sm mt-1" style={{ color: 'var(--g-dim)' }}>
                If an account exists for <span className="font-medium">{normalizeEmail(email)}</span>, you&apos;ll receive a reset link shortly.
              </p>
              <p className="text-xs mt-3" style={{ color: 'var(--g-dim)' }}>
                Open the link on the same device and browser where you requested it. Links expire after about an hour and can only be used once.
              </p>
              <button type="button" onClick={() => switchTab('signin')} className="glass-link text-sm mt-4 bg-transparent border-none cursor-pointer">
                Back to sign in →
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--g-text)' }}>Reset your password</p>
                <p className="text-sm mb-4" style={{ color: 'var(--g-dim)' }}>Enter your email and we&apos;ll send you a reset link.</p>
                <label className={labelClass} style={labelStyle}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="glass-input w-full" required autoComplete="email" />
              </div>
              <button type="submit" disabled={loading} className="glass-btn-primary w-full py-2.5">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          )
        )}
      </div>
    </div>
  )
}
