$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repo

$status = git status --short
if (-not $status) {
  Write-Host "No changes to sync."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$message = "Sync harness updates $timestamp"

git add AGENTS.md newyorkwatch_editorial_learning_log.md newyorkwatch_harness.html newyorkwatch_weekly_stats_log.md sync-harness.ps1
git commit -m $message
git push origin main

