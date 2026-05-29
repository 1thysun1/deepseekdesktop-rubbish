$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
$Sed = Join-Path $PSScriptRoot "deepseek-installer.sed"
$Exe = Join-Path $Dist "DeepSeek Installer.exe"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

$InstallPs1 = Join-Path $PSScriptRoot "install.ps1"
$SedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=DeepSeek Windows installed.
TargetName=$Exe
FriendlyName=DeepSeek Installer
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$PSScriptRoot
[SourceFiles0]
%FILE0%=
[Strings]
FILE0=install.ps1
"@
Set-Content -Path $Sed -Value $SedContent -Encoding ASCII

$IExpress = Join-Path $env:SystemRoot "System32\iexpress.exe"
if (!(Test-Path $IExpress)) {
  throw "iexpress.exe not found. Use installer\install.ps1 directly or build with electron-builder/NSIS."
}
& $IExpress /N /Q $Sed
if (!(Test-Path $Exe)) {
  throw "Installer build failed: $Exe"
}
Write-Host $Exe
