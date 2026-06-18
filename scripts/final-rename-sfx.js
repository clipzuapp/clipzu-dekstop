const fs = require('fs');
const path = require('path');

const sfxFolder = path.join(__dirname, '../assets/sfx');

// Rename remaining files with original names
const renames = [
    ['artificiallyinspired-90s-sitcom-laugh-track-353985.mp3', 'laugh-2.mp3'],
    ['dragon-studio-close-door-382723.mp3', 'door-close-2.mp3'],
    ['dragon-studio-relaxing-rain-444802.mp3', 'rain-ambient.mp3'],
    ['dragon-studio-wow-423653.mp3', 'wow-2.mp3'],
    ['feedthestraycats-real-rain-sound-379215.mp3', 'rain-ambient-2.mp3'],
    ['freesound_community-crowd-cheering-6229.mp3', 'cheering-2.mp3'],
    ['freesound_community-door-close-79921.mp3', 'door-close-3.mp3'],
    ['freesound_community-kids-laugh-45357.mp3', 'laugh-3.mp3'],
    ['freesound_community-moedas-70096.mp3', 'coin-drop-2.mp3'],
    ['freesound_community-small-crowd-clapping-2-106993.mp3', 'clapping-2.mp3'],
    ['koiroylers-sparkle-355937.mp3', 'sparkle-1.mp3'],
    ['liecio-magic-sparkle-190030.mp3', 'sparkle-2.mp3'],
    ['mykelu-crowd-cheering-383111.mp3', 'cheering-3.mp3'],
    ['shidenbeatsmusic-sound-effect-twinklesparkle-115095.mp3', 'sparkle-3.mp3'],
    ['u_xg7ssi08yr-crowd-cheering-379666.mp3', 'cheering-4.mp3'],
    ['vvqne-applause-383901.mp3', 'clapping-3.mp3']
];

let count = 0;

renames.forEach(([oldName, newName]) => {
    const oldPath = path.join(sfxFolder, oldName);
    const newPath = path.join(sfxFolder, newName);
    
    if (fs.existsSync(oldPath)) {
        if (!fs.existsSync(newPath)) {
            fs.renameSync(oldPath, newPath);
            console.log(`✓ ${oldName}`);
            console.log(`  → ${newName}`);
            count++;
        } else {
            console.log(`⊘ ${newName} (already exists)`);
        }
    }
});

console.log(`\n✓ Renamed ${count} files`);

// Count total SFX files
const allFiles = fs.readdirSync(sfxFolder).filter(f => f.endsWith('.mp3'));
console.log(`📊 Total SFX files: ${allFiles.length}`);
