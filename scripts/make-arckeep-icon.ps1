# Build Arckeep app.ico from the brand app-icon.png (single 256px PNG entry).
# Usage: powershell -NoProfile -File scripts/make-arckeep-icon.ps1
$sourcePath = Join-Path $PSScriptRoot '..\arckeep\shell\assets\app-icon.png'
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$iconImage = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($iconImage)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($sourceImage, 0, 0, 256, 256)
$buffer = [System.IO.MemoryStream]::new()
$iconImage.Save($buffer, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $buffer.ToArray()
$graphics.Dispose()
$iconImage.Dispose()
$sourceImage.Dispose()
$buffer.Dispose()

$outputPath = Join-Path $PSScriptRoot '..\arckeep\shell\assets\app.ico'
$file = [System.IO.File]::Create($outputPath)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Dispose()
$file.Dispose()
Write-Output $outputPath
