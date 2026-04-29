# KorDoc Shell — 개발 설치 제거

$ErrorActionPreference = "Continue"

Write-Host "=== KorDoc Shell 제거 ===" -ForegroundColor Cyan

# 1. AppxPackage 제거
$pkg = Get-AppxPackage -Name "KorDoc.Shell" -ErrorAction SilentlyContinue
if ($pkg) {
    Write-Host "[1/2] AppxPackage 제거..."
    Remove-AppxPackage -Package $pkg.PackageFullName
    Write-Host "  ✓ 제거 완료" -ForegroundColor Green
} else {
    Write-Host "[1/2] 설치된 KorDoc.Shell 패키지 없음."
}

# 2. registry 잔여 정리 (Sparse Package가 자동 정리하지만 명시적으로)
Write-Host "[2/2] registry 잔여 정리..."
$regPaths = @(
    "HKCU:\Software\Classes\.hwp\shell\KorDoc",
    "HKCU:\Software\Classes\.hwpx\shell\KorDoc",
    "HKCU:\Software\Classes\.pdf\shell\KorDoc",
    "HKCU:\Software\Classes\.xls\shell\KorDoc",
    "HKCU:\Software\Classes\.xlsx\shell\KorDoc",
    "HKCU:\Software\Classes\.doc\shell\KorDoc",
    "HKCU:\Software\Classes\.docx\shell\KorDoc",
    "HKCU:\Software\Classes\KorDoc"
)
foreach ($p in $regPaths) {
    if (Test-Path $p) {
        Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  - $p"
    }
}

Write-Host "`n=== 제거 완료 ===" -ForegroundColor Cyan
