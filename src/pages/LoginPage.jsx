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
            src="/vtc-scorecard/aw-stl-logo.jpg"
            alt="Ashton Woods / Starlight Homes"
            className="h-12 mx-auto object-contain"
          />
          <p className="text-xs mt-3" style={{ color: '#525249', opacity: 0.65 }}>
            Vendor &amp; Trade Performance Portal
          </p>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
          <button
            onClick={() => { setTab('signin'); setError(''); setSignupSuccess(false) }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'signin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setTab('signup'); setError(''); setSignupSuccess(false) }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Create Account
          </button>
        </div>

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
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
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
                onClick={() => { setTab('signin'); setSignupSuccess(false); setPassword(''); setConfirmPassword('') }}
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
            </form>
          )
        )}
      </div>
    </div>
  )
}
