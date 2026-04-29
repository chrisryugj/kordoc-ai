# KorDoc Shell — 빌드 스크립트
# Rust 런처 + MSIX 패키지 생성
#
# 사용:
#   .\scripts\build.ps1                  # release 빌드
#   .\scripts\build.ps1 -Release         # 동일
#   .\scripts\build.ps1 -SkipPackage     # exe만, MSIX는 스킵
#
# 요구:
#   - Rust toolchain (cargo)
#   - Windows SDK 10.0.17763.0+ (MakeAppx.exe)

param(
    [switch]$Release = $true,
    [switch]$SkipPackage = $false
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$buildDir = Join-Path $root "build"
$pkgDir = Join-Path $buildDir "package"
$outMsix = Join-Path $buildDir "KorDocShell.msix"

Write-Host "=== KorDoc Shell 빌드 ===" -ForegroundColor Cyan
Write-Host "root: $root"

# 1. Rust 런처 빌드
Write-Host "`n[1/3] kordoc-launcher.exe 빌드..." -ForegroundColor Yellow
Push-Location (Join-Path $root "kordoc-launcher")
try {
    if ($Release) {
        & cargo build --release
        $exePath = "target\release\kordoc-launcher.exe"
    } else {
        & cargo build
        $exePath = "target\debug\kordoc-launcher.exe"
    }
    if ($LASTEXITCODE -ne 0) { throw "cargo build 실패" }
    if (-not (Test-Path $exePath)) { throw "빌드 산출물 없음: $exePath" }
    Write-Host "  ✓ $exePath" -ForegroundColor Green
} finally {
    Pop-Location
}

if ($SkipPackage) {
    Write-Host "`n--SkipPackage 지정됨. MSIX 빌드 스킵." -ForegroundColor Yellow
    return
}

# 2. 패키지 디렉토리 구성
Write-Host "`n[2/3] MSIX 패키지 디렉토리 구성..." -ForegroundColor Yellow
if (Test-Path $pkgDir) { Remove-Item $pkgDir -Recurse -Force }
New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null

# manifest 파일들 복사
Copy-Item (Join-Path $root "manifest\AppxManifest.xml") $pkgDir
Copy-Item (Join-Path $root "manifest\Microsoft.Registry.xml") $pkgDir

# assets 복사
$assetsSrc = Join-Path $root "assets"
$assetsDst = Join-Path $pkgDir "assets"
if (Test-Path $assetsSrc) {
    Copy-Item $assetsSrc $assetsDst -Recurse
}

# 런처 exe 복사
$exeSrc = Join-Path $root "kordoc-launcher\$exePath"
Copy-Item $exeSrc $pkgDir

Write-Host "  ✓ $pkgDir" -ForegroundColor Green

# 3. MakeAppx pack
Write-Host "`n[3/3] MSIX 패키지 생성 (MakeAppx.exe)..." -ForegroundColor Yellow
$makeAppx = Get-Command "MakeAppx.exe" -ErrorAction SilentlyContinue
if (-not $makeAppx) {
    # SDK 표준 경로 시도
    $candidates = @(
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\MakeAppx.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\MakeAppx.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\MakeAppx.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\x64\MakeAppx.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $makeAppx = @{ Source = $c }; break }
    }
}
if (-not $makeAppx) {
    throw "MakeAppx.exe를 찾을 수 없습니다. Windows SDK 설치 후 다시 시도하세요."
}

if (Test-Path $outMsix) { Remove-Item $outMsix -Force }
& $makeAppx.Source pack /d $pkgDir /p $outMsix /nv
if ($LASTEXITCODE -ne 0) { throw "MakeAppx pack 실패" }

Write-Host "  ✓ $outMsix" -ForegroundColor Green
Write-Host "`n=== 빌드 완료 ===" -ForegroundColor Cyan
Write-Host "다음: scripts\sign.ps1 실행 (자체서명)"
Write-Host "      또는 scripts\install-dev.ps1 (서명+설치)"
