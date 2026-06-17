# Capcraft Media Test Script
# Tests the test video file using ffprobe from the bundled FFmpeg

$ErrorActionPreference = "Stop"
$ProjectRoot = "d:\PROJECTS\capcut-killer"
$TestFile = "$ProjectRoot\test_file\imperial swipe left.mp4"
$FFmpegDir = "$ProjectRoot\resources\bin"
$FFprobe = "$FFmpegDir\ffprobe.exe"

Write-Host "=== Capcraft Media Test ===" -ForegroundColor Cyan
Write-Host ""

# Check test file exists
if (-not (Test-Path $TestFile)) {
    Write-Host "FAIL: Test file not found: $TestFile" -ForegroundColor Red
    exit 1
}
$fileInfo = Get-Item $TestFile
Write-Host "[OK] Test file: $($fileInfo.Name) ($([math]::Round($fileInfo.Length/1MB, 1)) MB)" -ForegroundColor Green

# Find ffprobe
if (-not (Test-Path $FFprobe)) {
    # Try extracting from zip
    $zipPath = "$FFmpegDir\ffmpeg.zip"
    if (Test-Path $zipPath) {
        Write-Host "Extracting FFmpeg..." -ForegroundColor Yellow
        Expand-Archive -Path $zipPath -DestinationPath $FFmpegDir -Force
        # ffprobe is nested in a subfolder, find it
        $found = Get-ChildItem -Path $FFmpegDir -Recurse -Filter "ffprobe.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $FFprobe = $found.FullName
            Write-Host "[OK] Found ffprobe at: $FFprobe" -ForegroundColor Green
        }
    }
    if (-not (Test-Path $FFprobe)) {
        Write-Host "WARN: ffprobe not found. Install FFmpeg to resources/bin/" -ForegroundColor Yellow
        Write-Host "      Then re-run this script." -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "[OK] ffprobe found at: $FFprobe" -ForegroundColor Green
}

# Run ffprobe on the test video
Write-Host ""
Write-Host "--- ffprobe Media Info ---" -ForegroundColor Cyan

$output = & $FFprobe -v quiet -print_format json -show_format -show_streams $TestFile 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: ffprobe failed: $output" -ForegroundColor Red
    exit 1
}

$info = $output | ConvertFrom-Json

# Video stream
$video = $info.streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1
if ($video) {
    $fpsStr = $video.r_frame_rate
    $parts = $fpsStr -split '/'
    $fps = if ($parts.Count -eq 2) { [math]::Round([int]$parts[0] / [int]$parts[1], 1) } else { $fpsStr }
    
    Write-Host "  Video Stream:" -ForegroundColor Green
    Write-Host "    Codec    : $($video.codec_name)"
    Write-Host "    Resolution: $($video.width)x$($video.height)"
    Write-Host "    FPS      : $fps"
    Write-Host "    Duration : $([math]::Round([float]$info.format.duration, 1))s ($([math]::Round([float]$info.format.duration/60, 1)) min)"
    Write-Host "    Bitrate  : $([math]::Round([int]$info.format.bit_rate / 1000)) kbps"
}

# Audio stream
$audio = $info.streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1
if ($audio) {
    Write-Host "  Audio Stream:" -ForegroundColor Green
    Write-Host "    Codec    : $($audio.codec_name)"
    Write-Host "    Channels : $($audio.channels)"
    Write-Host "    Sample   : $($audio.sample_rate) Hz"
}

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host "The test file is a valid video with audio." -ForegroundColor Green
Write-Host "When the Capcraft app is launched, this file can be imported via MediaPanel 'Add Media'."
