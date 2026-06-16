import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPasswordPage() {
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'invalid'
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStatus('ready')
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(prev => prev !== 'loading' ? prev : session ? 'ready' : 'invalid')
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleReset(e) {
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

  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm focus:ring-2 focus:border-transparent transition-colors"
  const inputStyle = { '--tw-ring-color': '#087482' }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f3f1ea' }}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8">
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

        {status === 'loading' && (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: '#087482' }} />
          </div>
        )}

        {status === 'invalid' && (
          <div className="text-center py-4">
            <p className="text-sm font-medium text-gray-900 mb-1">Invalid or expired link</p>
            <p className="text-sm text-gray-500 mb-4">This password reset link has expired. Please request a new one.</p>
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-medium transition-colors"
              style={{ color: '#087482' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#076570' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#087482' }}
            >
              Back to sign in →
            </button>
          </div>
        )}

        {status === 'ready' && success && (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">Password updated!</p>
            <p className="text-sm text-gray-500 mt-1">Taking you to the dashboard...</p>
          </div>
        )}

        {status === 'ready' && !success && (
          <>
            <div className="mb-6">
              <p className="text-sm font-semibold text-gray-900 mb-1">Set a new password</p>
              <p className="text-sm text-gray-500">Choose a strong password for your account.</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
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
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
