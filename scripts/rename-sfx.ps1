# SFX File Renamer - Standardizes naming convention
# Run this in the sfx folder

$ErrorActionPreference = "Stop"
$sfxFolder = "d:\PROJECTS\capcut-killer\assets\sfx"

Write-Host "Renaming SFX files to standardized names..." -ForegroundColor Green
Write-Host ""

$renameMap = @{
    # UI Sounds
    "dragon-studio-pop-402324.mp3" = "pop-1.mp3"
    "soundreality-pop-423717.mp3" = "pop-2.mp3"
    "universfield-computer-mouse-click-351398.mp3" = "click-1.mp3"
    "universfield-computer-mouse-click-352734.mp3" = "click-2.mp3"
    "soundshelfstudio-ui-chime-notification-sound-553111.mp3" = "notification-1.mp3"
    "soundshelfstudio-ui-success-chime-513565.mp3" = "success-chime.mp3"
    "spinopel-jackpot-coins-falling-393253.mp3" = "coin-drop.mp3"
    "u_xg7ssi08yr-coins-drop-1-404409.mp3" = "coin-collect.mp3"
    "dragon-studio-dropping-a-coin-478359.mp3" = "cash-register.mp3"
    "dragon-studio-correct-472358.mp3" = "ding-1.mp3"
    
    # Transitions
    "dragon-studio-simple-whoosh-382724.mp3" = "whoosh-1.mp3"
    "dragon-studio-whoosh-cinematic-376875.mp3" = "whoosh-2.mp3"
    "dragon-studio-riser-swoosh-transition-390289.mp3" = "swoosh-impact.mp3"
    "dragon-studio-quick-swipe-405450.mp3" = "swipe-left.mp3"
    "universfield-swoosh-015-383769.mp3" = "swipe-right.mp3"
    
    # Effects
    "dragon-studio-glitch-effect-1-397982.mp3" = "glitch-1.mp3"
    "soundreality-glitch-effect-3-530928.mp3" = "glitch-2.mp3"
    "soundreality-glitch-sfx-479202.mp3" = "glitch-3.mp3"
    "universfield-epic-cinematic-explosion-454857.mp3" = "explosion-1.mp3"
    "soundreality-explosion-fx-343683.mp3" = "explosion-2.mp3"
    "daviddumaisaudio-large-underwater-explosion-190270.mp3" = "explosion-3.mp3"
    "data_pion-st3-footstep-sfx-323056.mp3" = "footstep-1.mp3"
    "freesound_community-noisy-neighbors-foley-77988.mp3" = "door-close.mp3"
    "dragon-studio-thudding-heartbeat-372487.mp3" = "heartbeat-fast.mp3"
    "soundreality-heartbeat-549797.mp3" = "heartbeat-slow.mp3"
    
    # Reactions
    "universfield-surprised-male-wow-reaction-352683.mp3" = "wow-effect.mp3"
    "universfield-shock-gasp-female-383751.mp3" = "gasp.mp3"
    "universfield-gasp-242214.mp3" = "gasp-2.mp3"
    "freesoundsxx-woman-gasp-for-air-269717.mp3" = "gasp-3.mp3"
    "freesound_community-gasp-6253.mp3" = "gasp-4.mp3"
    "freesound_community-gasp-7063.mp3" = "gasp-5.mp3"
    "freesound_community-gasp-82819.mp3" = "gasp-6.mp3"
    "freesound_community-male-gasp-2-103066.mp3" = "gasp-7.mp3"
    "universfield-crowd-disappointment-reaction-352718.mp3" = "laugh-1.mp3"
    "soundreality-crowd-noise-375725.mp3" = "cheering.mp3"
    "freesound_community-crowd-talking-quietly-stadium-102065.mp3" = "clapping.mp3"
    "freesound_community-crowd-murmuring-60721.mp3" = "crowd-ambient.mp3"
}

$renamed = 0
$skipped = 0
$errors = 0

foreach ($oldName in $renameMap.Keys) {
    $newName = $renameMap[$oldName]
    $oldPath = Join-Path $sfxFolder $oldName
    $newPath = Join-Path $sfxFolder $newName
    
    if (-not (Test-Path $oldPath)) {
        Write-Host "Skip: $oldName (not found)" -ForegroundColor Yellow
        $skipped++
        continue
    }
    
    if (Test-Path $newPath) {
        Write-Host "Skip: $newName (already exists)" -ForegroundColor Yellow
        $skipped++
        continue
    }
    
    try {
        Rename-Item -Path $oldPath -NewName $newName
        Write-Host "OK: $oldName -> $newName" -ForegroundColor Green
        $renamed++
    } catch {
        Write-Host "Error: $oldName - $_" -ForegroundColor Red
        $errors++
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "SFX RENAMING COMPLETE" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Renamed: $renamed" -ForegroundColor Green
Write-Host "Skipped: $skipped" -ForegroundColor Yellow
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host ""
