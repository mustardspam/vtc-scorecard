import os from 'node:os'
import path from 'node:path'

// Everything the job writes lives outside OneDrive, under %LOCALAPPDATA%\vtc-automation.
// VTC_AUTOMATION_HOME overrides it (tests).
const base = process.env.VTC_AUTOMATION_HOME
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'vtc-automation')

export const paths = {
  base,
  logs: path.join(base, 'logs'),
  archive: path.join(base, 'archive'),
  stateDir: path.join(base, 'state'),
  state: path.join(base, 'state', 'state.json'),
  lock: path.join(base, 'state', 'run.lock'),
  configOverride: path.join(base, 'config.json'),
}
