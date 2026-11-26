<#
.SYNOPSIS
  Start PortView automatically when you sign in.

.DESCRIPTION
  Creates a shortcut named PortView in your Startup folder. The shortcut runs
  scripts/startup.vbs with wscript.exe, so the server starts hidden and the
  entry appears in Settings > Apps > Startup (and Task Manager > Startup apps).

  The shortcut points at this checkout, so PortView starts from the same files
  you run with `npm start`. Move the folder and re-run this script.

.PARAMETER Repo
  The PortView checkout. Defaults to the parent of this script's folder.

.EXAMPLE
  npm run startup:install

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-startup.ps1
#>
[CmdletBinding()]
param(
  [string]$Repo
)

$ErrorActionPreference = 'Stop'

if (-not $Repo) {
  $Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} else {
  $Repo = (Resolve-Path $Repo).Path
}

$server = Join-Path $Repo 'server.js'
$script = Join-Path $Repo 'scripts\startup.vbs'

if (-not (Test-Path $server)) {
  throw "server.js was not found in $Repo"
}
if (-not (Test-Path $script)) {
  throw "scripts\startup.vbs was not found in $Repo"
}

try {
  $node = (Get-Command node -ErrorAction Stop).Source
} catch {
  throw 'Node.js was not found on PATH. Install it, then open a new terminal and try again.'
}

$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path $wscript)) {
  throw "wscript.exe was not found at $wscript"
}

$startup = [Environment]::GetFolderPath('Startup')
if (-not $startup) {
  throw 'Could not locate your Startup folder.'
}

$link = Join-Path $startup 'PortView.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $wscript
# //B keeps a script error from popping up a dialog at login.
$shortcut.Arguments = '//B "' + $script + '" "' + $node + '"'
$shortcut.WorkingDirectory = $Repo
$shortcut.Description = 'PortView - local port viewer'
$shortcut.WindowStyle = 7
$shortcut.IconLocation = "$node,0"
$shortcut.Save()

Write-Host ''
Write-Host 'PortView will start at login.' -ForegroundColor Green
Write-Host "  Shortcut : $link"
Write-Host "  Command  : $wscript $($shortcut.Arguments)"
Write-Host "  Folder   : $Repo"
Write-Host ''
Write-Host 'It starts hidden in the background. Open http://localhost:6969 to use it.'
Write-Host 'Remove it again with: npm run startup:uninstall'
