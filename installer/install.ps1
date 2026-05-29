$ErrorActionPreference = "Stop"

$SourceRoot = Split-Path -Parent $PSScriptRoot
if (!(Test-Path (Join-Path $SourceRoot "packages\cli\bin\deepseek.js")) -and (Test-Path "D:\deepseek\packages\cli\bin\deepseek.js")) {
  $SourceRoot = "D:\deepseek"
}
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\DeepSeekWindows"
$BinDir = Join-Path $InstallDir "bin"
$ConfigDir = Join-Path $env:USERPROFILE ".deepseek"

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
Copy-Item -Path (Join-Path $SourceRoot "*") -Destination $InstallDir -Recurse -Force -Exclude "dist"

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
$OldShortcutPath = Join-Path $Desktop "DeepSeek Desktop.lnk"
if (Test-Path $OldShortcutPath) { Remove-Item -LiteralPath $OldShortcutPath -Force }
$ShortcutPath = Join-Path $Desktop "DeepSeek.lnk"
$ElectronExe = Join-Path $InstallDir "node_modules\electron\dist\electron.exe"
$IconPath = Join-Path $InstallDir "packages\desktop\assets\deepseek.ico"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ElectronExe
$Shortcut.Arguments = "packages\desktop\main.js"
$Shortcut.WorkingDirectory = $InstallDir
if (Test-Path $IconPath) {
  $Shortcut.IconLocation = $IconPath
} else {
  $Shortcut.IconLocation = "$ElectronExe,0"
}
$Shortcut.Save()

Write-Host "Installed DeepSeek Windows to $InstallDir"
Write-Host "Open a new terminal and run: deepseek doctor"
