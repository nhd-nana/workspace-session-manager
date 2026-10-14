# 生成扩展图标 —— 自有设计：紫色圆角底 + 白色文件夹（工作区存储）+ 三条会话条目（最后一条琥珀色 = 需要修复的那条）
# 用法: pwsh -File _tmp/make-icon.ps1
Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
    param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
    $d = $r * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

$size = 512
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# ① 紫色渐变圆角底（留 12px 透明边，避免在小尺寸下被裁）
$rect = New-Object System.Drawing.Rectangle 12, 12, ($size - 24), ($size - 24)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
    [System.Drawing.Color]::FromArgb(255, 67, 56, 202),
    45.0)
$bgPath = New-RoundedPath 12 12 ($size - 24) ($size - 24) 104
$g.FillPath($bg, $bgPath)

# ② 白色文件夹
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$tab = New-RoundedPath 104 128 176 72 26
$g.FillPath($white, $tab)
$body = New-RoundedPath 104 166 304 230 44
$g.FillPath($white, $body)

# ③ 文件夹里的三条会话条目（第三条琥珀色 = 待修复）
$violet = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 124, 58, 237))
$amber = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 217, 119, 6))
$g.FillPath($violet, (New-RoundedPath 148 216 216 30 15))
$g.FillPath($violet, (New-RoundedPath 148 272 216 30 15))
$g.FillPath($amber, (New-RoundedPath 148 328 152 30 15))

$g.Dispose()
$dir = Join-Path $PSScriptRoot "..\images"
if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$target = Join-Path $dir "icon.png"
$bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

# 小尺寸预览（拼成一条，方便肉眼判断可辨识度；只进 _tmp，不进 vsix）
$small = New-Object System.Drawing.Bitmap 200, 48
$sg = [System.Drawing.Graphics]::FromImage($small)
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sg.Clear([System.Drawing.Color]::FromArgb(255, 240, 240, 240))
$sizes = @(16, 24, 32, 48)
$x = 4
foreach ($s in $sizes) {
    $sg.DrawImage($bmp, $x, (48 - $s) / 2, $s, $s)
    $x += $s + 8
}
$sg.Dispose()
$preview = Join-Path $PSScriptRoot "icon-preview.png"
$small.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
$small.Dispose()
$bmp.Dispose()

$info = Get-Item $target
"已生成: $($info.FullName)  ($($info.Length) bytes)"
"预览  : $preview"
