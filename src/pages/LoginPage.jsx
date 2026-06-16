import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

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
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (resetError) throw resetError
      setForgotSent(true)
    } catch (err) {
      setError(err.message)
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
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      })
      if (signUpError) throw signUpError
      setSignupSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm focus:ring-2 focus:border-transparent transition-colors"
  const inputStyle = { '--tw-ring-color': '#087482' }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f3f1ea' }}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        {/* Logo */}
        <div className="text-center mb-7">
          <img
            src="/aw-stl-logo.jpg"
            alt="Ashton Woods / Starlight Homes"
            className="h-12 mx-auto object-contain"
          />
          <p className="text-xs mt-3" style={{ color: '#525249', opacity: 0.65 }}>
            Vendor &amp; Trade Performance Portal
          </p>
        </div>

        {tab === 'forgot' && (
          <button
            onClick={() => switchTab('signin')}
            className="flex items-center gap-1 text-sm mb-6 transition-colors"
            style={{ color: '#087482' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#076570' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#087482' }}
          >
            ← Back to sign in
          </button>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {error}
          </div>
        )}

        {/* Sign In */}
        {tab === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputClass}
                style={inputStyle}
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <button
                  type="button"
                  onClick={() => switchTab('forgot')}
                  className="text-xs transition-colors"
                  style={{ color: '#087482' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#076570' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#087482' }}
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
                style={inputStyle}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-white font-medium rounded-lg disabled:opacity-50 transition-colors text-sm"
              style={{ backgroundColor: loading ? '#087482' : '#087482' }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.backgroundColor = '#076570' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#087482' }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800 mb-2">
                <span className="font-semibold">First time here?</span> Your Okta login will not work on this portal — you need to create a separate account.
              </p>
              <button
                type="button"
                onClick={() => switchTab('signup')}
                className="w-full py-2 text-sm font-medium rounded-lg border transition-colors"
                style={{ borderColor: '#087482', color: '#087482', backgroundColor: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#087482'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#087482' }}
              >
                Create an Account
              </button>
            </div>
          </form>
        )}

        {/* Sign Up */}
        {tab === 'signup' && (
          signupSuccess ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900">Account created!</p>
              <p className="text-sm text-gray-500 mt-1">
                Your account is pending approval. An admin will assign your access level shortly.
              </p>
              <button
                onClick={() => { switchTab('signin'); setPassword(''); setConfirmPassword('') }}
                className="mt-4 text-sm font-medium transition-colors"
                style={{ color: '#087482' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#076570' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#087482' }}
              >
                Go to Sign In →
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="John Smith"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="Min. 8 characters"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-white font-medium rounded-lg disabled:opacity-50 transition-colors text-sm"
                style={{ backgroundColor: '#087482' }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.backgroundColor = '#076570' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#087482' }}
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
              <p className="text-xs text-center text-gray-400">
                After creating your account, an admin will set your access level before you can log in.
              </p>
              <p className="text-xs text-center">
                <button
                  type="button"
                  onClick={() => switchTab('signin')}
                  className="transition-colors"
                  style={{ color: '#087482' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#076570' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#087482' }}
                >
                  ← Back to sign in
                </button>
              </p>
            </form>
          )
        )}
        {/* Forgot Password */}
        {tab === 'forgot' && (
          forgotSent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: '#e6f3f4' }}>
                <svg className="w-6 h-6" style={{ color: '#087482' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900">Check your email</p>
              <p className="text-sm text-gray-500 mt-1">
                If an account exists for <span className="font-medium">{email}</span>, you'll receive a reset link shortly.
              </p>
              <button
                onClick={() => switchTab('signin')}
                className="mt-4 text-sm font-medium transition-colors"
                style={{ color: '#087482' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#076570' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#087482' }}
              >
                Back to sign in →
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Reset your password</p>
                <p className="text-sm text-gray-500 mb-4">Enter your email and we'll send you a reset link.</p>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-white font-medium rounded-lg disabled:opacity-50 transition-colors text-sm"
                style={{ backgroundColor: '#087482' }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.backgroundColor = '#076570' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#087482' }}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          )
        )}
      </div>
    </div>
  )
}
