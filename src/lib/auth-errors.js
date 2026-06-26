export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase()
}

export function authErrorMessage(err) {
  const msg = err?.message || ''
  const code = err?.code || err?.error_code || ''

  if (code === 'invalid_credentials' || msg.includes('Invalid login credentials')) {
    return 'Incorrect email or password. This portal uses its own account — your Okta/work password will not work here. Use Forgot password if needed.'
  }
  if (code === 'user_already_registered' || msg.includes('already registered')) {
    return 'An account with this email already exists. Sign in instead, or use Forgot password to set a new password.'
  }
  if (msg.includes('Email link is invalid or has expired') || msg.includes('One-time token not found')) {
    return 'This reset link has expired or was already used. Request a new link from the sign-in page (links expire after about an hour).'
  }
  if (msg.includes('Password should be at least')) {
    return 'Password must be at least 8 characters.'
  }
  if (msg.includes('Unable to validate email address')) {
    return 'Enter a valid email address.'
  }
  if (msg.includes('Email rate limit exceeded')) {
    return 'Too many attempts. Wait a few minutes and try again.'
  }
  return msg || 'Something went wrong. Please try again.'
}
