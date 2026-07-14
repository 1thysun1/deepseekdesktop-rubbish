$ErrorActionPreference = "Stop"

param(
  [switch]$Uninstall,
  [switch]$Repair
)

$SourceRoot = Split-Path -Parent $PSScriptRoot
if (!(Test-Path (Join-Path $SourceRoot "packages\cli\bin\deepseek.js")) -and (Test-Path "D:\deepseekdesktop\packages\cli\bin\deepseek.js")) {
  $SourceRoot = "D:\deepseekdesktop"
}
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\DeepSeekWindows"
$BinDir = Join-Path $InstallDir "bin"
$ConfigDir = Join-Path $env:USERPROFILE ".deepseek"
$UninstallKey = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekWindows"
$UninstallKeyUser = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekWindows"

function Uninstall {
  Write-Host "Uninstalling DeepSeek Windows..."
  $Desktop = [Environment]::GetFolderPath("Desktop")
  foreach ($sc in @("DeepSeek.lnk", "DeepSeek Desktop.lnk")) {
    $p = Join-Path $Desktop $sc
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Force; Write-Host "  Removed shortcut: $p" }
  }
  $CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $newPath = ($CurrentPath -split ";") | Where-Object { $_ -ne $BinDir } | Join-String -Separator ";"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "  Removed PATH entry: $BinDir"
  if (Test-Path $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
    Write-Host "  Removed install directory: $InstallDir"
  }
  foreach ($key in @($UninstallKey, $UninstallKeyUser)) {
    if (Test-Path $key) { Remove-Item -LiteralPath $key -Recurse -Force }
  }
  Write-Host "Uninstall complete. Runtime data at $ConfigDir was preserved."
  Write-Host "To also remove runtime data, delete: $ConfigDir"
}

if ($Uninstall) {
  Uninstall
  return
}

if ($Repair -and (Test-Path $InstallDir)) {
  Write-Host "Repairing DeepSeek Windows at $InstallDir..."
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

Write-Host "Installing DeepSeek Windows to $InstallDir..."

New-Item -ItemType Directory -Force -Path $InstallDir, $BinDir, $ConfigDir | Out-Null
@("sessions","archived_sessions","plugins","skills","browser","cache","log","tmp","worktrees","automations","rules","memories","memory","hooks","semantic","sqlite") | ForEach-Object {
  New-Item -ItemType Directory -Force -Path (Join-Path $ConfigDir $_) | Out-Null
}
if (!(Test-Path (Join-Path $ConfigDir "config.json"))) {
  Set-Content -Path (Join-Path $ConfigDir "config.json") -Value '{"baseUrl":"https://api.deepseek.com","model":"deepseek-chat","reasonerModel":"deepseek-reasoner","workspace":"D:\\deepseek","approvalPolicy":"on-request","sandboxMode":"workspace-write"}' -Encoding UTF8
}
if (!(Test-Path (Join-Path $ConfigDir "config.toml"))) {
  @'
model = "deepseek-chat"
reasoner_model = "deepseek-reasoner"
base_url = "https://api.deepseek.com"
sandbox_mode = "workspace-write"
approval_policy = "on-request"
permission_preset = "custom"
reasoning_effort = "medium"

[network]
enabled = true
require_approval = true
allowed_domains = []

[agent]
loop = "reasonix-inspired"
cache_policy = "stable-prefix-first"
tool_repair = true
visible_reasoning = "status-only"

[projects.'D:\\deepseek']
trust_level = "trusted"
'@ | Set-Content -Path (Join-Path $ConfigDir "config.toml") -Encoding UTF8
}
foreach ($file in @("session_index.jsonl","history.jsonl","AGENTS.md")) {
  $target = Join-Path $ConfigDir $file
  if (!(Test-Path $target)) { New-Item -ItemType File -Path $target | Out-Null }
}
Copy-Item -Path (Join-Path $SourceRoot "*") -Destination $InstallDir -Recurse -Force -Exclude "dist","node_modules"

$Cmd = @"
@echo off
node "%LOCALAPPDATA%\Programs\DeepSeekWindows\packages\cli\bin\deepseek.js" %*
"@
Set-Content -Path (Join-Path $BinDir "deepseek.cmd") -Value $Cmd -Encoding ASCII

$Ps1 = @"
#!/usr/bin/env pwsh
node "`$env:LOCALAPPDATA\Programs\DeepSeekWindows\packages\cli\bin\deepseek.js" @args
"@
Set-Content -Path (Join-Path $BinDir "deepseek.ps1") -Value $Ps1 -Encoding UTF8

$DesktopCmd = @"
@echo off
cd /d "%LOCALAPPDATA%\Programs\DeepSeekWindows"
"%LOCALAPPDATA%\Programs\DeepSeekWindows\node_modules\electron\dist\electron.exe" packages\desktop\main.js
"@
Set-Content -Path (Join-Path $BinDir "deepseek-desktop.cmd") -Value $DesktopCmd -Encoding ASCII

$UninstallCmd = @"
@echo off
powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\DeepSeekWindows\installer\install.ps1" -Uninstall
"@
Set-Content -Path (Join-Path $BinDir "deepseek-uninstall.cmd") -Value $UninstallCmd -Encoding ASCII

$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($CurrentPath -split ";") -notcontains $BinDir) {
  [Environment]::SetEnvironmentVariable("Path", "$CurrentPath;$BinDir", "User")
}

if (Get-Command npm -ErrorAction SilentlyContinue) {
  Push-Location $InstallDir
  npm install --omit=dev
  Pop-Location
}

$Desktop = [Environment]::GetFolderPath("Desktop")
Remove-Item -Path (Join-Path $Desktop "DeepSeek*.lnk") -Force -ErrorAction SilentlyContinue
$ShortcutPath = Join-Path $Desktop "DeepSeek.lnk"
$ElectronExe = Join-Path $InstallDir "node_modules\electron\dist\electron.exe"
$IconPath = Join-Path $InstallDir "packages\desktop\assets\deepseek.ico"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = if (Test-Path $ElectronExe) { $ElectronExe } else { "powershell.exe" }
$Shortcut.Arguments = if (Test-Path $ElectronExe) { "packages\desktop\main.js" } else { "-ExecutionPolicy Bypass -File `"$InstallDir\installer\install.ps1`"" }
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.IconLocation = if (Test-Path $IconPath) { $IconPath } else { "$ElectronExe,0" }
$Shortcut.Save()

# Register uninstall in Add/Remove Programs
$UninstallData = @{
  "DisplayName" = "DeepSeek Windows"
  "DisplayVersion" = "0.1.0"
  "Publisher" = "DeepSeek"
  "InstallLocation" = $InstallDir
  "UninstallString" = "powershell -ExecutionPolicy Bypass -File `"$InstallDir\installer\install.ps1`" -Uninstall"
  "DisplayIcon" = $IconPath
  "NoModify" = 1
  "NoRepair" = 0
}
try {
  New-Item -ItemType Directory -Force -Path $UninstallKeyUser | Out-Null
  foreach ($kv in $UninstallData.GetEnumerator()) {
    Set-ItemProperty -LiteralPath $UninstallKeyUser -Name $kv.Key -Value $kv.Value
  }
} catch {
  Write-Host "  (Add/Remove Programs registration skipped: admin rights may be needed)"
}

Write-Host "Installation complete!"
Write-Host "  Install dir: $InstallDir"
Write-Host "  Desktop shortcut: $ShortcutPath"
Write-Host "  Add to PATH: $BinDir"
Write-Host "  Uninstall: $BinDir\deepseek-uninstall.cmd"
Write-Host "  Or: Settings > Apps > DeepSeek Windows"
Write-Host ""
Write-Host "Open a new terminal and run: deepseek doctor"
