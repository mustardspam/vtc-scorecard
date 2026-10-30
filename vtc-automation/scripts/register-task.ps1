# Registers the vtc-automation scheduled tasks for the current user. No admin rights needed.
#   powershell -ExecutionPolicy Bypass -File vtc-automation\scripts\register-task.ps1
#   powershell -ExecutionPolicy Bypass -File vtc-automation\scripts\register-task.ps1 -RequestsOnly
#
# "VTC Nightly Import": daily at 12:00 AM (local time; this PC must be on Central time) and at
# logon (5 minutes after you sign in), so a missed midnight run catches up when you log in.
# Wakes the computer, runs as soon as possible after a missed start, one run at a time.
#
# "VTC Nightly Import - Refresh Requests": every 5 minutes, runs any "Refresh now" request
# queued from the Uploads page; exits straight away when nothing is queued.
#
# -RequestsOnly: no scheduled pulls at all, only the button. Registers just the Refresh
# Requests task and removes the nightly task if it was registered before.
#
# Both run only while you are logged on (a locked screen counts). ResPlan, Outlook and Windows
# Credential Manager all live in your session, so a logged-off run could not reach any of them.
param(
  [string]$TaskName = 'VTC Nightly Import',
  [string]$At = '00:00',
  [switch]$RequestsOnly
)
$ErrorActionPreference = 'Stop'

$app = Join-Path $env:LOCALAPPDATA 'vtc-automation\app'
$job = Join-Path $app 'vtc-automation\jobs\nightly_import.js'
if (-not (Test-Path $job)) { throw "Not installed: $job is missing. Run scripts\install.ps1 first." }
$node = (Get-Command node).Source
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$requestsTask = "$TaskName - Refresh Requests"

if ($RequestsOnly) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed '$TaskName' (no scheduled pulls; the Refresh now button only)." -ForegroundColor Yellow
  }
} else {
  $tz = (Get-TimeZone).Id
  if ($tz -ne 'Central Standard Time') {
    Write-Warning "This PC's time zone is '$tz', not Central. The task runs at $At local time."
  }

  # conhost --headless keeps a console window from popping up at midnight and at logon.
  $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
    -Argument "--headless `"$node`" `"$job`"" -WorkingDirectory $app

  $daily = New-ScheduledTaskTrigger -Daily -At $At
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
  $logon.Delay = 'PT5M'

  $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $daily, $logon -Settings $settings `
    -Principal $principal -Description 'Pulls schedule, rework, safety and JC vendor data through ResPlan and imports it into the VTC Scorecard. Source: vtc-automation (OneDrive); runtime: %LOCALAPPDATA%\vtc-automation.' `
    -Force | Out-Null
  Write-Host "Registered '$TaskName' for $user (daily $At + at logon)." -ForegroundColor Green
}

# Every 5 minutes, run any "Refresh now" request queued from the Uploads page.
# It exits straight away when nothing is queued, and waits while the nightly run is going.
$reqAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
  -Argument "--headless `"$node`" `"$job`" --requests" -WorkingDirectory $app
$reqTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$reqSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $requestsTask -Action $reqAction -Trigger $reqTrigger -Settings $reqSettings `
  -Principal $principal -Description "Runs 'Refresh now' requests from the VTC Scorecard Uploads page (checks every 5 minutes)." `
  -Force | Out-Null
Write-Host "Registered '$requestsTask' for $user (every 5 minutes)." -ForegroundColor Green

Write-Host "Last result:  Get-ScheduledTaskInfo -TaskName '$requestsTask'"
if (-not $RequestsOnly) {
  Write-Host "Run nightly now: Start-ScheduledTask -TaskName '$TaskName'"
  Write-Host ""
  Write-Host "Also check: Power Options > Sleep > 'Allow wake timers' is Enabled (plugged in), or the PC will not wake at midnight." -ForegroundColor Yellow
}
Write-Host "Remove:       Unregister-ScheduledTask -TaskName '$requestsTask' -Confirm:`$false$(if (-not $RequestsOnly) { "; Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false" })"
