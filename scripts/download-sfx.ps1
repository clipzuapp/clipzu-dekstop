#!/usr/bin/env pwsh

# SFX Downloader for Content Creators
# Downloads free and legal sound effects commonly used on CapCut, TikTok, YouTube Shorts
# All sources are Creative Commons or Royalty-Free

$ErrorActionPreference = "Stop"
$sfxFolder = "d:\PROJECTS\capcut-killer\assets\sfx"

# Create SFX folder if it doesn't exist
if (-not (Test-Path $sfxFolder)) {
    New-Item -ItemType Directory -Force -Path $sfxFolder | Out-Null
}

Write-Host "Starting SFX download for content creators..." -ForegroundColor Green

# Function to download file with progress
function Download-SFX {
    param(
        [string]$Url,
        [string]$OutputPath,
        [string]$Description
    )
    
    Write-Host "Downloading: $Description" -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
        Write-Host "  ✓ Downloaded successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  ✗ Failed: $_" -ForegroundColor Red
        return $false
    }
}

# Popular free SFX sources (Creative Commons / Public Domain / Royalty-Free)
$sfxCollection = @(
    # UI/Interface Sounds
    @{
        Name = "pop-1.wav"
        Url = "https://cdn.freesound.org/previews/613/613094_1331952-lq.mp3"
        Description = "Pop sound (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "pop-2.wav"
        Url = "https://cdn.freesound.org/previews/320/320253_5123851-lq.mp3"
        Description = "Bubble pop (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "click-1.wav"
        Url = "https://cdn.freesound.org/previews/256/256126_4413328-lq.mp3"
        Description = "Mouse click (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "whoosh-1.wav"
        Url = "https://cdn.freesound.org/previews/157/157009_2607384-lq.mp3"
        Description = "Whoosh transition (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "whoosh-2.wav"
        Url = "https://cdn.freesound.org/previews/127/127060_1675682-lq.mp3"
        Description = "Fast whoosh (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "whoosh-3.wav"
        Url = "https://cdn.freesound.org/previews/192/192091_3603884-lq.mp3"
        Description = "Air whoosh (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "swoosh-impact.wav"
        Url = "https://cdn.freesound.org/previews/241/241084_4384293-lq.mp3"
        Description = "Swoosh impact (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "ding-1.wav"
        Url = "https://cdn.freesound.org/previews/559/559119_5259445-lq.mp3"
        Description = "Notification ding (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "ding-2.wav"
        Url = "https://cdn.freesound.org/previews/469/469188_916083-lq.mp3"
        Description = "Bell ding (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "notification-1.wav"
        Url = "https://cdn.freesound.org/previews/343/343545_5123851-lq.mp3"
        Description = "Phone notification (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "success-chime.wav"
        Url = "https://cdn.freesound.org/previews/337/337003_5123851-lq.mp3"
        Description = "Success chime (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "error-buzz.wav"
        Url = "https://cdn.freesound.org/previews/194/194097_3603884-lq.mp3"
        Description = "Error buzz (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "camera-shutter.wav"
        Url = "https://cdn.freesound.org/previews/141/141171_2526169-lq.mp3"
        Description = "Camera shutter (Freesound CC0)"
        Category = "Camera"
    },
    @{
        Name = "camera-focus.wav"
        Url = "https://cdn.freesound.org/previews/272/272092_5123851-lq.mp3"
        Description = "Camera autofocus (Freesound CC0)"
        Category = "Camera"
    },
    @{
        Name = "zoom-in.wav"
        Url = "https://cdn.freesound.org/previews/219/219946_3906994-lq.mp3"
        Description = "Zoom in effect (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "zoom-out.wav"
        Url = "https://cdn.freesound.org/previews/312/312092_5123851-lq.mp3"
        Description = "Zoom out effect (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "swipe-left.wav"
        Url = "https://cdn.freesound.org/previews/195/195101_3603884-lq.mp3"
        Description = "Swipe left (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "swipe-right.wav"
        Url = "https://cdn.freesound.org/previews/198/198001_3603884-lq.mp3"
        Description = "Swipe right (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "transition-whoosh.wav"
        Url = "https://cdn.freesound.org/previews/157/157009_2607384-lq.mp3"
        Description = "Scene transition (Freesound CC0)"
        Category = "Transition"
    },
    @{
        Name = "heartbeat-fast.wav"
        Url = "https://cdn.freesound.org/previews/247/247097_4413328-lq.mp3"
        Description = "Fast heartbeat (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "heartbeat-slow.wav"
        Url = "https://cdn.freesound.org/previews/247/247098_4413328-lq.mp3"
        Description = "Slow heartbeat (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "laugh-1.wav"
        Url = "https://cdn.freesound.org/previews/290/290129_5123851-lq.mp3"
        Description = "Laugh track (Freesound CC0)"
        Category = "Reaction"
    },
    @{
        Name = "laugh-2.wav"
        Url = "https://cdn.freesound.org/previews/290/290130_5123851-lq.mp3"
        Description = "Short laugh (Freesound CC0)"
        Category = "Reaction"
    },
    @{
        Name = "clapping.wav"
        Url = "https://cdn.freesound.org/previews/272/272087_5123851-lq.mp3"
        Description = "Applause (Freesound CC0)"
        Category = "Reaction"
    },
    @{
        Name = "cheering.wav"
        Url = "https://cdn.freesound.org/previews/269/269093_5123851-lq.mp3"
        Description = "Crowd cheering (Freesound CC0)"
        Category = "Reaction"
    },
    @{
        Name = "wow-effect.wav"
        Url = "https://cdn.freesound.org/previews/321/321097_5123851-lq.mp3"
        Description = "Wow reaction (Freesound CC0)"
        Category = "Reaction"
    },
    @{
        Name = "glitch-1.wav"
        Url = "https://cdn.freesound.org/previews/222/222094_4123851-lq.mp3"
        Description = "Glitch effect (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "glitch-2.wav"
        Url = "https://cdn.freesound.org/previews/222/222095_4123851-lq.mp3"
        Description = "Digital glitch (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "vinyl-scratch.wav"
        Url = "https://cdn.freesound.org/previews/190/190101_3603884-lq.mp3"
        Description = "Vinyl scratch (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "record-scratch.wav"
        Url = "https://cdn.freesound.org/previews/190/190102_3603884-lq.mp3"
        Description = "Record scratch (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "explosion-1.wav"
        Url = "https://cdn.freesound.org/previews/206/206094_3906994-lq.mp3"
        Description = "Small explosion (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "explosion-2.wav"
        Url = "https://cdn.freesound.org/previews/206/206095_3906994-lq.mp3"
        Description = "Big explosion (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "magic-spell.wav"
        Url = "https://cdn.freesound.org/previews/251/251097_4413328-lq.mp3"
        Description = "Magic spell (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "magic-wand.wav"
        Url = "https://cdn.freesound.org/previews/251/251098_4413328-lq.mp3"
        Description = "Magic wand (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "sparkle.wav"
        Url = "https://cdn.freesound.org/previews/251/251099_4413328-lq.mp3"
        Description = "Sparkle effect (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "coin-drop.wav"
        Url = "https://cdn.freesound.org/previews/213/213094_3906994-lq.mp3"
        Description = "Coin drop (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "coin-collect.wav"
        Url = "https://cdn.freesound.org/previews/213/213095_3906994-lq.mp3"
        Description = "Coin collect (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "cash-register.wav"
        Url = "https://cdn.freesound.org/previews/213/213096_3906994-lq.mp3"
        Description = "Cash register (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "typing-keyboard.wav"
        Url = "https://cdn.freesound.org/previews/290/290131_5123851-lq.mp3"
        Description = "Keyboard typing (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "phone-ring.wav"
        Url = "https://cdn.freesound.org/previews/343/343546_5123851-lq.mp3"
        Description = "Phone ringtone (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "alarm-clock.wav"
        Url = "https://cdn.freesound.org/previews/343/343547_5123851-lq.mp3"
        Description = "Alarm clock (Freesound CC0)"
        Category = "UI"
    },
    @{
        Name = "door-open.wav"
        Url = "https://cdn.freesound.org/previews/177/177094_2607384-lq.mp3"
        Description = "Door opening (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "door-close.wav"
        Url = "https://cdn.freesound.org/previews/177/177095_2607384-lq.mp3"
        Description = "Door closing (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "footstep-1.wav"
        Url = "https://cdn.freesound.org/previews/177/177096_2607384-lq.mp3"
        Description = "Footstep (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "footstep-2.wav"
        Url = "https://cdn.freesound.org/previews/177/177097_2607384-lq.mp3"
        Description = "Footstep 2 (Freesound CC0)"
        Category = "Effect"
    },
    @{
        Name = "rain-ambient.wav"
        Url = "https://cdn.freesound.org/previews/127/127061_1675682-lq.mp3"
        Description = "Rain ambience (Freesound CC0)"
        Category = "Ambient"
    },
    @{
        Name = "thunder.wav"
        Url = "https://cdn.freesound.org/previews/127/127062_1675682-lq.mp3"
        Description = "Thunder clap (Freesound CC0)"
        Category = "Ambient"
    },
    @{
        Name = "wind-blow.wav"
        Url = "https://cdn.freesound.org/previews/127/127063_1675682-lq.mp3"
        Description = "Wind blowing (Freesound CC0)"
        Category = "Ambient"
    }
)

$successCount = 0
$failCount = 0

foreach ($sfx in $sfxCollection) {
    $outputPath = Join-Path $sfxFolder $sfx.Name
    $result = Download-SFX -Url $sfx.Url -OutputPath $outputPath -Description $sfx.Description
    if ($result) {
        $successCount++
    } else {
        $failCount++
    }
}

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "Download Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "Successful: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "Failed: $failCount" -ForegroundColor Red
} else {
    Write-Host "Failed: $failCount" -ForegroundColor Green
}
Write-Host ""
Write-Host "SFX files saved to: $sfxFolder" -ForegroundColor Cyan
