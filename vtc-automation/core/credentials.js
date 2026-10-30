// Secrets live in Windows Credential Manager (generic credentials, service "vtc-automation"),
// never in code, config, OneDrive or logs.
const SERVICE = 'vtc-automation'

export const CREDENTIALS = {
  'supabase-email': 'Email of the VTC Scorecard automation account (an admin)',
  'supabase-password': 'Password of that account',
  'supabase-anon-key': 'Supabase anon (public) key, the same one the web app uses',
  'resplan-token': 'ResPlan key (ResPlan > Settings > VTC Scorecard)',
}

async function entry(name) {
  const { Entry } = await import('@napi-rs/keyring')
  return new Entry(SERVICE, name)
}

export async function getCredential(name) {
  return (await entry(name)).getPassword() || null
}

export async function setCredential(name, value) {
  ;(await entry(name)).setPassword(value)
}

/** Reads the named credentials; throws listing every missing one. */
export async function requireCredentials(names) {
  const values = {}
  const missing = []
  for (const name of names) {
    values[name] = await getCredential(name)
    if (!values[name]) missing.push(name)
  }
  if (missing.length) {
    const err = new Error(`Missing credentials in Windows Credential Manager: ${missing.join(', ')}. Run: npm run credentials (in %LOCALAPPDATA%\\vtc-automation\\app)`)
    err.permanent = true
    throw err
  }
  return values
}
