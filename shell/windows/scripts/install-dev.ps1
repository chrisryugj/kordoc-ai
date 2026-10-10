# KorDoc Shell — 개발 환경 설치
# build → sign → Add-AppxPackage 일괄 실행

param(
    [switch]$SkipBuild,
    [switch]$SkipSign
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$msix = Join-Path $root "build\KorDocShell.msix"

Write-Host "=== KorDoc Shell 개발 설치 ===" -ForegroundColor Cyan

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "build.ps1")
}

if (-not $SkipSign) {
    & (Join-Path $PSScriptRoot "sign.ps1") -Msix $msix
}

if (-not (Test-Path $msix)) {
    throw "MSIX 파일 없음: $msix"
}

# Sparse Package: ExternalLocation 필요
# 단순 dev 설치는 일반 Add-AppxPackage 도 가능하지만, 본 프로젝트는 SparsePackage 모드 사용.
$externalLocation = $root.Path

Write-Host "`n[install] Add-AppxPackage..." -ForegroundColor Yellow
Write-Host "  MSIX: $msix"
Write-Host "  ExternalLocation: $externalLocation"

try {
    Add-AppxPackage -Path $msix -ExternalLocation $externalLocation -AllowUnsigned:$false -ForceTargetApplicationShutdown
    Write-Host "  ✓ 설치 완료" -ForegroundColor Green
} catch {
    Write-Host "  설치 실패: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  대안: Add-AppxPackage -Register .\manifest\AppxManifest.xml" -ForegroundColor Yellow
    throw
}

Write-Host "`n탐색기에서 .hwp/.pdf/.xlsx 등 우클릭 → KorDoc 메뉴 확인" -ForegroundColor Cyan
Write-Host "제거: scripts\uninstall-dev.ps1"
