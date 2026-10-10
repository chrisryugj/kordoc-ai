# KorDoc Shell — 관리자 권한 단계만 분리한 자동 elevation 스크립트
# sign.ps1 + install-dev.ps1 의 LocalMachine\Root 등록 + Add-AppxPackage 부분만 elevated 실행

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$msix = Join-Path $root "build\KorDocShell.msix"
$pfx = Join-Path $root "build\kordoc-shell-dev.pfx"

if (-not (Test-Path $msix)) { throw "MSIX 없음: $msix (먼저 build.ps1)" }
if (-not (Test-Path $pfx))  { throw "PFX 없음: $pfx (먼저 sign.ps1)" }

# 이미 관리자면 본 작업, 아니면 자기 자신을 RunAs로 재실행
$admin = [Security.Principal.WindowsIdentity]::GetCurrent().Groups -contains "S-1-5-32-544"
if (-not $admin) {
    Write-Host "관리자 권한 필요 — UAC 다이얼로그 표시" -ForegroundColor Yellow
    $self = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$self`""
    ) -Wait
    exit $LASTEXITCODE
}

Write-Host "=== KorDoc Shell — 관리자 단계 ===" -ForegroundColor Cyan

# 1. cert를 LocalMachine\Root + TrustedPeople 등록
Write-Host "`n[1/2] LocalMachine\Root + TrustedPeople 등록..." -ForegroundColor Yellow
$pwd = ConvertTo-SecureString -String "kordoc-dev" -AsPlainText -Force
Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\Root -Password $pwd | Out-Null
Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pwd | Out-Null
Write-Host "  ✓ 신뢰 저장소 등록" -ForegroundColor Green

# 2. Add-AppxPackage Sparse
Write-Host "`n[2/2] Add-AppxPackage..." -ForegroundColor Yellow
Add-AppxPackage -Path $msix -ExternalLocation $root.Path -ForceTargetApplicationShutdown
Write-Host "  ✓ 설치 완료" -ForegroundColor Green

Write-Host "`n탐색기에서 .hwp/.pdf/.xlsx 등 우클릭 → KorDoc 메뉴 확인" -ForegroundColor Cyan
Write-Host "엔터로 종료..."
Read-Host
