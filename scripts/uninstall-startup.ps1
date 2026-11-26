<#
.SYNOPSIS
  Stop PortView from starting automatically when you sign in.

.DESCRIPTION
  Removes the PortView shortcut from your Startup folder. A PortView that is
  already running keeps running until you close it or sign out.

.EXAMPLE
  npm run startup:uninstall

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-startup.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$startup = [Environment]::GetFolderPath('Startup')
if (-not $startup) {
  throw 'Could not locate your Startup folder.'
}

$link = Join-Path $startup 'PortView.lnk'

if (Test-Path $link) {
  Remove-Item $link -Force
  Write-Host ''
  Write-Host 'PortView will no longer start at login.' -ForegroundColor Green
  Write-Host "  Removed: $link"
} else {
  Write-Host 'PortView was not registered to start at login; nothing to remove.'
}
