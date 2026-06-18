#!/usr/bin/env node

/**
 * SFX Organizer - Renames downloaded files to standardized naming convention
 * Organizes SFX by category for easy access
 */

const fs = require('fs');
const path = require('path');

const sfxFolder = path.join(__dirname, '../assets/sfx');

console.log('Organizing SFX files...\n');

// Mapping from downloaded files to standardized names
const renameMap = [
    // UI Sounds
    { old: 'dragon-studio-pop-402324.mp3', new: 'pop-1.mp3', category: 'UI' },
    { old: 'soundreality-pop-423717.mp3', new: 'pop-2.mp3', category: 'UI' },
    { old: 'universfield-computer-mouse-click-351398.mp3', new: 'click-1.mp3', category: 'UI' },
    { old: 'universfield-computer-mouse-click-352734.mp3', new: 'click-2.mp3', category: 'UI' },
    { old: 'soundshelfstudio-ui-chime-notification-sound-553111.mp3', new: 'notification-1.mp3', category: 'UI' },
    { old: 'soundshelfstudio-ui-success-chime-513565.mp3', new: 'success-chime.mp3', category: 'UI' },
    { old: 'spinopel-jackpot-coins-falling-393253.mp3', new: 'coin-drop.mp3', category: 'UI' },
    { old: 'u_xg7ssi08yr-coins-drop-1-404409.mp3', new: 'coin-collect.mp3', category: 'UI' },
    { old: 'dragon-studio-dropping-a-coin-478359.mp3', new: 'cash-register.mp3', category: 'UI' },
    
    // Transitions
    { old: 'dragon-studio-simple-whoosh-382724.mp3', new: 'whoosh-1.mp3', category: 'Transition' },
    { old: 'dragon-studio-whoosh-cinematic-376875.mp3', new: 'whoosh-2.mp3', category: 'Transition' },
    { old: 'dragon-studio-riser-swoosh-transition-390289.mp3', new: 'swoosh-impact.mp3', category: 'Transition' },
    { old: 'dragon-studio-quick-swipe-405450.mp3', new: 'swipe-left.mp3', category: 'Transition' },
    { old: 'universfield-swoosh-015-383769.mp3', new: 'swipe-right.mp3', category: 'Transition' },
    
    // Effects
    { old: 'dragon-studio-glitch-effect-1-397982.mp3', new: 'glitch-1.mp3', category: 'Effect' },
    { old: 'soundreality-glitch-effect-3-530928.mp3', new: 'glitch-2.mp3', category: 'Effect' },
    { old: 'soundreality-glitch-sfx-479202.mp3', new: 'glitch-3.mp3', category: 'Effect' },
    { old: 'universfield-epic-cinematic-explosion-454857.mp3', new: 'explosion-1.mp3', category: 'Effect' },
    { old: 'soundreality-explosion-fx-343683.mp3', new: 'explosion-2.mp3', category: 'Effect' },
    { old: 'daviddumaisaudio-large-underwater-explosion-190270.mp3', new: 'explosion-3.mp3', category: 'Effect' },
    { old: 'data_pion-st3-footstep-sfx-323056.mp3', new: 'footstep-1.mp3', category: 'Effect' },
    { old: 'freesound_community-noisy-neighbors-foley-77988.mp3', new: 'door-close.mp3', category: 'Effect' },
    { old: 'dragon-studio-thudding-heartbeat-372487.mp3', new: 'heartbeat-fast.mp3', category: 'Effect' },
    { old: 'soundreality-heartbeat-549797.mp3', new: 'heartbeat-slow.mp3', category: 'Effect' },
    
    // Reactions
    { old: 'universfield-surprised-male-wow-reaction-352683.mp3', new: 'wow-effect.mp3', category: 'Reaction' },
    { old: 'universfield-shock-gasp-female-383751.mp3', new: 'gasp.mp3', category: 'Reaction' },
    { old: 'universfield-gasp-242214.mp3', new: 'gasp-2.mp3', category: 'Reaction' },
    { old: 'freesoundxx-woman-gasp-for-air-269717.mp3', new: 'gasp-3.mp3', category: 'Reaction' },
    { old: 'freesound_community-gasp-6253.mp3', new: 'gasp-4.mp3', category: 'Reaction' },
    { old: 'freesound_community-gasp-7063.mp3', new: 'gasp-5.mp3', category: 'Reaction' },
    { old: 'freesound_community-gasp-82819.mp3', new: 'gasp-6.mp3', category: 'Reaction' },
    { old: 'freesound_community-male-gasp-2-103066.mp3', new: 'gasp-7.mp3', category: 'Reaction' },
    { old: 'universfield-crowd-disappointment-reaction-352718.mp3', new: 'laugh-1.mp3', category: 'Reaction' },
    { old: 'soundreality-crowd-noise-375725.mp3', new: 'cheering.mp3', category: 'Reaction' },
    { old: 'freesound_community-crowd-talking-quietly-stadium-102065.mp3', new: 'clapping.mp3', category: 'Reaction' },
    { old: 'freesound_community-crowd-murmuring-60721.mp3', new: 'crowd-ambient.mp3', category: 'Ambient' },
    
    // Special
    { old: 'dragon-studio-correct-472358.mp3', new: 'ding-1.mp3', category: 'UI' }
];

let renamed = 0;
let skipped = 0;
let errors = 0;

const summary = {
    UI: [],
    Transition: [],
    Effect: [],
    Reaction: [],
    Ambient: []
};

renameMap.forEach(({ old, new: newName, category }) => {
    const oldPath = path.join(sfxFolder, old);
    const newPath = path.join(sfxFolder, newName);
    
    if (!fs.existsSync(oldPath)) {
        console.log(`⊘ Skip: ${old} (not found)`);
        skipped++;
        return;
    }
    
    if (fs.existsSync(newPath)) {
        console.log(`⊘ Skip: ${newName} (already exists)`);
        skipped++;
        return;
    }
    
    try {
        fs.renameSync(oldPath, newPath);
        console.log(`✓ ${old} → ${newName}`);
        renamed++;
        summary[category].push(newName);
    } catch (err) {
        console.log(`✗ Error: ${old} - ${err.message}`);
        errors++;
    }
});

// Print summary
console.log('\n===========================================');
console.log('SFX ORGANIZATION SUMMARY');
console.log('===========================================\n');

console.log(`✓ Renamed: ${renamed}`);
console.log(`⊘ Skipped: ${skipped}`);
console.log(`✗ Errors: ${errors}`);

console.log('\n📊 By Category:');
Object.entries(summary).forEach(([category, files]) => {
    if (files.length > 0) {
        console.log(`\n${category} (${files.length} files):`);
        files.forEach(f => console.log(`  - ${f}`));
    }
});

console.log(`\n📁 Total organized: ${renamed} files`);
console.log(`📂 Location: ${sfxFolder}`);
console.log('===========================================\n');
