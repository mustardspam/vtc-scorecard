# Sends one email through desktop (classic) Outlook. Called by core/notify.js.
# The message file is JSON: { "to": "<address>|me", "subject": "...", "body": "..." }
param([Parameter(Mandatory = $true)][string]$MessageFile)
$ErrorActionPreference = 'Stop'

$m = Get-Content -Raw -Encoding UTF8 -LiteralPath $MessageFile | ConvertFrom-Json
$outlook = New-Object -ComObject Outlook.Application
$session = $outlook.Session

$to = $m.to
if (-not $to -or $to -eq 'me') {
  $exUser = $session.CurrentUser.AddressEntry.GetExchangeUser()
  $to = if ($exUser) { $exUser.PrimarySmtpAddress } else { $session.CurrentUser.Address }
}

$mail = $outlook.CreateItem(0)
$mail.To = $to
$mail.Subject = $m.subject
$mail.Body = $m.body
$mail.Send()

# When Outlook was started just for this, give it time to push the Outbox before exiting.
$outbox = $session.GetDefaultFolder(4)
$session.SendAndReceive($false)
for ($i = 0; $i -lt 30 -and $outbox.Items.Count -gt 0; $i++) { Start-Sleep -Seconds 2 }
if ($outbox.Items.Count -gt 0) { Write-Output "Queued in Outbox (Outlook will send it when it next syncs)" } else { Write-Output "Sent to $to" }
