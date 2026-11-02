# Starts the harness node agent at logon on Windows, using a Scheduled Task. Run it once from a normal
# (non-administrator) PowerShell in the repo root:   powershell -File deploy\windows\install-agent-task.ps1
#
#   Remove it again:   Unregister-ScheduledTask -TaskName "harness agent" -Confirm:$false
#   Start it now:      Start-ScheduledTask -TaskName "harness agent"
#
# The agent reads .env in the repo root (GATEWAY_URL, HARNESS_API_KEY, and optionally PROJECT_ROOTS,
# ALLOWED_TOOLS, CLAUDE_ENABLED, ALLOW_MODEL_CONTROL). Restart the task after changing it.

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$taskName = "harness agent"

# Run through cmd so the task keeps a log, and with the repo as the working directory so .env is found. It bundles the agent and runs it
# with plain node, so pnpm and tsx do not sit beside it using more memory than the agent does.
$log = Join-Path $env:LOCALAPPDATA "harness-agent.log"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$pnpm`" --silent build:agent >> `"$log`" 2>&1 && `"$node`" --env-file-if-exists=.env packages\node-agent\dist\agent.mjs >> `"$log`" 2>&1" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Connects this machine to the harness gateway" -Force | Out-Null

Write-Host "Registered the scheduled task '$taskName'. It starts at your next logon."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Log file: $log"
