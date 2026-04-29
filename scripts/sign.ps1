# KorDoc Shell — 자체 서명 스크립트
# 개발/테스트용. 배포 시에는 EV 코드사인 인증서 사용 권장.
#
# 흐름:
#   1. CN=KorDoc 자체 서명 cert가 없으면 생성 → CurrentUser\My
#   2. cert를 LocalMachine\Root + LocalMachine\TrustedPeople 에 설치 (관리자 권한 필요)
#   3. SignTool로 .msix 서명
#
# 요구: 관리자 PowerShell, Windows SDK (signtool.exe)

param(
    [string]$Subject = "CN=KorDoc",
    [string]$Msix = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
if (-not $Msix) { $Msix = Join-Path $root "build\KorDocShell.msix" }
if (-not (Test-Path $Msix)) {
    throw "MSIX 파일 없음: $Msix (먼저 build.ps1 실행)"
}

Write-Host "=== KorDoc Shell 자체서명 ===" -ForegroundColor Cyan

# 관리자 권한 확인
$admin = [Security.Principal.WindowsIdentity]::GetCurrent().Groups -contains "S-1-5-32-544"
if (-not $admin) {
    throw "관리자 권한 PowerShell 에서 실행하세요 (인증서를 LocalMachine 저장소에 설치)."
}

# 1. cert 확보
Write-Host "`n[1/3] 자체서명 인증서 확인/생성..."
$cert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Subject } | Select-Object -First 1
if (-not $cert) {
    Write-Host "  새 인증서 생성: $Subject"
    $cert = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $Subject `
        -KeyUsage DigitalSignature `
        -FriendlyName "KorDoc Shell Dev Cert" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
}
Write-Host "  ✓ Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green

# 2. cert를 신뢰 저장소에 설치
Write-Host "`n[2/3] LocalMachine\Root + TrustedPeople 에 설치..."
$pfxPath = Join-Path $root "build\kordoc-shell-dev.pfx"
$pfxPwd = ConvertTo-SecureString -String "kordoc-dev" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pfxPwd | Out-Null

Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\LocalMachine\Root -Password $pfxPwd | Out-Null
Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pfxPwd | Out-Null
Write-Host "  ✓ 신뢰 저장소 등록 완료" -ForegroundColor Green

# 3. signtool sign
Write-Host "`n[3/3] SignTool 서명..."
$signTool = Get-Command "SignTool.exe" -ErrorAction SilentlyContinue
if (-not $signTool) {
    $candidates = @(
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\SignTool.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\SignTool.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\x64\SignTool.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $signTool = @{ Source = $c }; break }
    }
}
if (-not $signTool) { throw "SignTool.exe를 찾을 수 없습니다." }

& $signTool.Source sign /fd SHA256 /a /f $pfxPath /p "kordoc-dev" $Msix
if ($LASTEXITCODE -ne 0) { throw "SignTool 서명 실패" }

Write-Host "  ✓ $Msix 서명 완료" -ForegroundColor Green
Write-Host "`n=== 서명 완료 ===" -ForegroundColor Cyan
Write-Host "다음: scripts\install-dev.ps1"
