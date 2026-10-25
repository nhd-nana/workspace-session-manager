# manage-task.ps1 -- install / uninstall / status of the scheduled task that
# applies pending session renames while VS Code is closed.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as GBK,
# and non-ASCII comments would break parsing.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File manage-task.ps1 -Action install
#   powershell -NoProfile -ExecutionPolicy Bypass -File manage-task.ps1 -Action uninstall
#   powershell -NoProfile -ExecutionPolicy Bypass -File manage-task.ps1 -Action status
param([Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall', 'status')][string]$Action)

$ErrorActionPreference = 'Stop'
$TaskName = 'WorkspaceSessionManager-ApplyPending'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Entry = Join-Path $ScriptDir 'auto-apply.js'

function Get-NodePath {
    $c = Get-Command node -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    throw 'node.exe not found in PATH. Install Node.js or add it to PATH first.'
}

switch ($Action) {
    'status' {
        $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $t) {
            Write-Host "Task '$TaskName' is NOT installed." -ForegroundColor Yellow
        }
        else {
            $i = Get-ScheduledTaskInfo -TaskName $TaskName
            Write-Host "Task '$TaskName' is installed." -ForegroundColor Green
            Write-Host ("  State     : " + $t.State)
            Write-Host ("  LastRun   : " + $i.LastRunTime)
            Write-Host ("  LastResult: " + $i.LastTaskResult)
            Write-Host ("  NextRun   : " + $i.NextRunTime)
        }
        $log = Join-Path $env:APPDATA 'Code\User\globalStorage\gy903.workspace-session-manager\auto-apply.log'
        if (Test-Path $log) {
            Write-Host "`nLast 5 log lines ($log):"
            Get-Content $log -Tail 5 | ForEach-Object { Write-Host "  $_" }
        }
        else {
            Write-Host "`nNo log yet (the task has not run)."
        }
    }

    'install' {
        if (-not (Test-Path $Entry)) { throw "auto-apply.js not found at $Entry" }
        $vbs = Join-Path $ScriptDir 'auto-apply-hidden.vbs'
        if (-not (Test-Path $vbs)) { throw "auto-apply-hidden.vbs not found at $vbs" }
        $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
        $tr = '"' + $wscript + '" "' + $vbs + '"'

        # schtasks instead of Register-ScheduledTask: the latter needs elevation
        # (Access is denied for a standard user registering a task).
        # Running through wscript keeps the console window hidden.
        & schtasks.exe /create /tn $TaskName /tr $tr /sc minute /mo 5 /f | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "schtasks failed with exit code $LASTEXITCODE" }

        Write-Host "Installed task '$TaskName'." -ForegroundColor Green
        Write-Host "  Runs : $tr"
        Write-Host "  When : every 5 minutes (while you are logged on)"
        Write-Host "  Skips: whenever Code.exe is running, or the queue is empty"
        Write-Host "  Log  : %APPDATA%\Code\User\globalStorage\gy903.workspace-session-manager\auto-apply.log"
        Write-Host "`nRemove it any time with: -Action uninstall"
    }

    'uninstall' {
        $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $t) { Write-Host "Task '$TaskName' is not installed." -ForegroundColor Yellow; break }
        & schtasks.exe /delete /tn $TaskName /f | Out-Null
        Write-Host "Removed task '$TaskName'." -ForegroundColor Green
    }
}
