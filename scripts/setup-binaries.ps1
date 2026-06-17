# Capcraft binary setup script
# Downloads FFmpeg + whisper.cpp and extracts them into resources/bin/

$ErrorActionPreference = "Stop"
$binDir = Join-Path (Join-Path (Join-Path $PSScriptRoot "..") "resources") "bin"

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

Write-Host "[1/3] Downloading FFmpeg..."
$ffmpegZip = Join-Path $binDir "ffmpeg.zip"
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip -UseBasicParsing
Write-Host "  Downloaded FFmpeg"

Write-Host "[1/3] Extracting FFmpeg..."
Expand-Archive -Path $ffmpegZip -DestinationPath $binDir -Force
# Move files from nested directory to bin root
$ffmpegSubdir = Get-ChildItem $binDir -Directory | Where-Object { $_.Name -like "ffmpeg-*" -or $_.Name -eq "bin" } | Select-Object -First 1
if ($ffmpegSubdir) {
    Get-ChildItem $ffmpegSubdir.FullName | Move-Item -Destination $binDir -Force
    Remove-Item $ffmpegSubdir.FullName -Recurse -Force
}
Remove-Item $ffmpegZip -Force
Write-Host "  FFmpeg ready: ffmpeg.exe + ffprobe.exe"

Write-Host "[2/3] Downloading whisper.cpp..."
$whisperZip = Join-Path $binDir "whisper.zip"
Invoke-WebRequest -Uri "https://github.com/ggerganov/whisper.cpp/releases/download/v1.8.6/whisper-bin-x64.zip" -OutFile $whisperZip -UseBasicParsing
Write-Host "  Downloaded whisper.cpp"

Write-Host "[2/3] Extracting whisper.cpp..."
Expand-Archive -Path $whisperZip -DestinationPath $binDir -Force
# whisper-bin-x64.zip may extract into a Release/ subfolder
$whisperSubdir = Get-ChildItem $binDir -Directory | Where-Object { $_.Name -eq "Release" } | Select-Object -First 1
if ($whisperSubdir) {
    Get-ChildItem $whisperSubdir.FullName | Move-Item -Destination $binDir -Force
    Remove-Item $whisperSubdir.FullName -Recurse -Force
}
Remove-Item $whisperZip -Force
Write-Host "  whisper.cpp ready: whisper-cli.exe"

Write-Host "[3/3] Verifying binaries..."
$ffmpegExe = Join-Path $binDir "ffmpeg.exe"
$ffprobeExe = Join-Path $binDir "ffprobe.exe"
$whisperExe = Join-Path $binDir "whisper-cli.exe"
if (Test-Path $ffmpegExe) { Write-Host "  [OK] ffmpeg.exe" } else { Write-Host "  [MISSING] ffmpeg.exe" }
if (Test-Path $ffprobeExe) { Write-Host "  [OK] ffprobe.exe" } else { Write-Host "  [MISSING] ffprobe.exe" }
if (Test-Path $whisperExe) { Write-Host "  [OK] whisper-cli.exe" } else { Write-Host "  [MISSING] whisper-cli.exe" }

Write-Host "Setup complete!"
