# KorDoc Shell 아이콘

MSIX AppxManifest가 요구하는 PNG 아이콘 placeholder.

## 필요한 파일

| 파일 | 크기 | 용도 |
|------|------|------|
| `StoreLogo.png` | 50x50 | Windows Store 로고 |
| `Square150.png` | 150x150 | 시작 메뉴 타일 |
| `Square44.png` | 44x44 | 컨텍스트 메뉴 / 작업표시줄 |

## TODO

Phase 2 W1 D5까지 디자이너 또는 [Figma](https://www.figma.com) 또는 임시 PNG 생성:

```powershell
# 임시 단색 PNG 생성 (.NET)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 150, 150
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(40, 110, 200))
$bmp.Save("$PSScriptRoot\Square150.png", [System.Drawing.Imaging.ImageFormat]::Png)
```

또는 디자인 후 [imagemagick](https://imagemagick.org)으로 일괄 리사이즈:
```bash
magick source.png -resize 50x50 StoreLogo.png
magick source.png -resize 44x44 Square44.png
magick source.png -resize 150x150 Square150.png
```
