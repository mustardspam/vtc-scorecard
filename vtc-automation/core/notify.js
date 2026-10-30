import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeJsonAtomic } from './fsutil.js'

const SEND_MAIL = fileURLToPath(new URL('../scripts/send-mail.ps1', import.meta.url))

/**
 * Sends an email through desktop Outlook (COM automation via scripts/send-mail.ps1).
 * Needs the user to be logged on, which the scheduled task requires anyway.
 * to: an address, or "me" for the Outlook profile's own address.
 */
export function sendMail({ to = 'me', subject, body }) {
  const file = path.join(os.tmpdir(), `vtc-mail-${process.pid}-${Date.now()}.json`)
  writeJsonAtomic(file, { to, subject, body })
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SEND_MAIL, '-MessageFile', file],
      { timeout: 120000, windowsHide: true },
      (err, stdout, stderr) => {
        fs.rmSync(file, { force: true })
        if (err) reject(new Error(`Outlook email failed: ${(stderr || err.message).trim()}`))
        else resolve(stdout.trim())
      })
  })
}
