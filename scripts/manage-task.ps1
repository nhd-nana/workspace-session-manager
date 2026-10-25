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
        $node = Get-NodePath
        $q = '"' + $node + '"'
        $arg = '"' + $Entry + '"'

        # Trigger 1: at logon. Trigger 2: every 5 minutes, forever.
        $t1 = New-ScheduledTaskTrigger -AtLogOn
        $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
            -RepetitionInterval (New-TimeSpan -Minutes 5)
        $act = New-ScheduledTaskAction -Execute $node -Argument $arg -WorkingDirectory $ScriptDir
        $set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
            -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $prn = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

        Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger @($t1, $t2) `
            -Settings $set -Principal $prn -Force `
            -Description 'Applies queued workspace-session-manager session renames while VS Code is closed. Exits immediately if Code.exe is running or the queue is empty.' | Out-Null

        Write-Host "Installed task '$TaskName'." -ForegroundColor Green
        Write-Host "  Runs : $q $arg"
        Write-Host "  When : at logon, and every 5 minutes"
        Write-Host "  Skips: whenever Code.exe is running, or the queue is empty"
        Write-Host "  Log  : %APPDATA%\Code\User\globalStorage\gy903.workspace-session-manager\auto-apply.log"
        Write-Host "`nRemove it any time with: -Action uninstall"
    }

    'uninstall' {
        $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $t) { Write-Host "Task '$TaskName' is not installed." -ForegroundColor Yellow; break }
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed task '$TaskName'." -ForegroundColor Green
    }
}
