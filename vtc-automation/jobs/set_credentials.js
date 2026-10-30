#!/usr/bin/env node
// Stores the job's secrets in Windows Credential Manager. Input is hidden; nothing is
// printed or logged.
//   node vtc-automation/jobs/set_credentials.js          prompt for every credential
//   node vtc-automation/jobs/set_credentials.js --status show which are set
//   node vtc-automation/jobs/set_credentials.js resplan-token   set one
import { CREDENTIALS, getCredential, setCredential } from '../core/credentials.js'

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY) return reject(new Error('Run this in an interactive terminal.'))
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n')
          return resolve(value)
        }
        if (ch === '\u0003') { stdout.write('\n'); process.exit(130) }
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

const args = process.argv.slice(2)
if (args[0] === '--status') {
  for (const name of Object.keys(CREDENTIALS)) console.log(`${(await getCredential(name)) ? 'set    ' : 'MISSING'}  ${name}`)
} else {
  const names = args.length ? args : Object.keys(CREDENTIALS)
  for (const name of names) {
    if (!CREDENTIALS[name]) { console.error(`Unknown credential ${name}. Known: ${Object.keys(CREDENTIALS).join(', ')}`); process.exit(2) }
    const current = await getCredential(name)
    const value = (await promptHidden(`${name} - ${CREDENTIALS[name]}${current ? ' [Enter keeps the current value]' : ''}: `)).trim()
    if (value) { await setCredential(name, value); console.log(`  saved ${name}`) }
    else if (!current) console.log(`  skipped ${name} (still missing)`)
  }
}
