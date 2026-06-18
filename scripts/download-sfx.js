#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sfxFolder = path.join(__dirname, '../assets/sfx');

// Create SFX folder if it doesn't exist
if (!fs.existsSync(sfxFolder)) {
    fs.mkdirSync(sfxFolder, { recursive: true });
}

console.log('Starting SFX download for content creators...');

// SFX Collection - Free and Legal (CC0 - Public Domain)
const sfxCollection = [
    // UI/Interface Sounds
    {
        name: 'pop-1.mp3',
        url: 'https://cdn.freesound.org/previews/613/613094_1331952-lq.mp3',
        description: 'Pop sound (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'pop-2.mp3',
        url: 'https://cdn.freesound.org/previews/320/320253_5123851-lq.mp3',
        description: 'Bubble pop (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'click-1.mp3',
        url: 'https://cdn.freesound.org/previews/256/256126_4413328-lq.mp3',
        description: 'Mouse click (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'whoosh-1.mp3',
        url: 'https://cdn.freesound.org/previews/157/157009_2607384-lq.mp3',
        description: 'Whoosh transition (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'whoosh-2.mp3',
        url: 'https://cdn.freesound.org/previews/127/127060_1675682-lq.mp3',
        description: 'Fast whoosh (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'whoosh-3.mp3',
        url: 'https://cdn.freesound.org/previews/192/192091_3603884-lq.mp3',
        description: 'Air whoosh (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'swoosh-impact.mp3',
        url: 'https://cdn.freesound.org/previews/241/241084_4384293-lq.mp3',
        description: 'Swoosh impact (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'ding-1.mp3',
        url: 'https://cdn.freesound.org/previews/559/559119_5259445-lq.mp3',
        description: 'Notification ding (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'ding-2.mp3',
        url: 'https://cdn.freesound.org/previews/469/469188_916083-lq.mp3',
        description: 'Bell ding (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'notification-1.mp3',
        url: 'https://cdn.freesound.org/previews/343/343545_5123851-lq.mp3',
        description: 'Phone notification (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'success-chime.mp3',
        url: 'https://cdn.freesound.org/previews/337/337003_5123851-lq.mp3',
        description: 'Success chime (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'error-buzz.mp3',
        url: 'https://cdn.freesound.org/previews/194/194097_3603884-lq.mp3',
        description: 'Error buzz (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'camera-shutter.mp3',
        url: 'https://cdn.freesound.org/previews/141/141171_2526169-lq.mp3',
        description: 'Camera shutter (Freesound CC0)',
        category: 'Camera'
    },
    {
        name: 'camera-focus.mp3',
        url: 'https://cdn.freesound.org/previews/272/272092_5123851-lq.mp3',
        description: 'Camera autofocus (Freesound CC0)',
        category: 'Camera'
    },
    {
        name: 'zoom-in.mp3',
        url: 'https://cdn.freesound.org/previews/219/219946_3906994-lq.mp3',
        description: 'Zoom in effect (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'zoom-out.mp3',
        url: 'https://cdn.freesound.org/previews/312/312092_5123851-lq.mp3',
        description: 'Zoom out effect (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'swipe-left.mp3',
        url: 'https://cdn.freesound.org/previews/195/195101_3603884-lq.mp3',
        description: 'Swipe left (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'swipe-right.mp3',
        url: 'https://cdn.freesound.org/previews/198/198001_3603884-lq.mp3',
        description: 'Swipe right (Freesound CC0)',
        category: 'Transition'
    },
    {
        name: 'heartbeat-fast.mp3',
        url: 'https://cdn.freesound.org/previews/247/247097_4413328-lq.mp3',
        description: 'Fast heartbeat (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'heartbeat-slow.mp3',
        url: 'https://cdn.freesound.org/previews/247/247098_4413328-lq.mp3',
        description: 'Slow heartbeat (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'laugh-1.mp3',
        url: 'https://cdn.freesound.org/previews/290/290129_5123851-lq.mp3',
        description: 'Laugh track (Freesound CC0)',
        category: 'Reaction'
    },
    {
        name: 'laugh-2.mp3',
        url: 'https://cdn.freesound.org/previews/290/290130_5123851-lq.mp3',
        description: 'Short laugh (Freesound CC0)',
        category: 'Reaction'
    },
    {
        name: 'clapping.mp3',
        url: 'https://cdn.freesound.org/previews/272/272087_5123851-lq.mp3',
        description: 'Applause (Freesound CC0)',
        category: 'Reaction'
    },
    {
        name: 'cheering.mp3',
        url: 'https://cdn.freesound.org/previews/269/269093_5123851-lq.mp3',
        description: 'Crowd cheering (Freesound CC0)',
        category: 'Reaction'
    },
    {
        name: 'wow-effect.mp3',
        url: 'https://cdn.freesound.org/previews/321/321097_5123851-lq.mp3',
        description: 'Wow reaction (Freesound CC0)',
        category: 'Reaction'
    },
    {
        name: 'glitch-1.mp3',
        url: 'https://cdn.freesound.org/previews/222/222094_4123851-lq.mp3',
        description: 'Glitch effect (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'glitch-2.mp3',
        url: 'https://cdn.freesound.org/previews/222/222095_4123851-lq.mp3',
        description: 'Digital glitch (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'vinyl-scratch.mp3',
        url: 'https://cdn.freesound.org/previews/190/190101_3603884-lq.mp3',
        description: 'Vinyl scratch (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'record-scratch.mp3',
        url: 'https://cdn.freesound.org/previews/190/190102_3603884-lq.mp3',
        description: 'Record scratch (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'explosion-1.mp3',
        url: 'https://cdn.freesound.org/previews/206/206094_3906994-lq.mp3',
        description: 'Small explosion (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'explosion-2.mp3',
        url: 'https://cdn.freesound.org/previews/206/206095_3906994-lq.mp3',
        description: 'Big explosion (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'magic-spell.mp3',
        url: 'https://cdn.freesound.org/previews/251/251097_4413328-lq.mp3',
        description: 'Magic spell (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'magic-wand.mp3',
        url: 'https://cdn.freesound.org/previews/251/251098_4413328-lq.mp3',
        description: 'Magic wand (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'sparkle.mp3',
        url: 'https://cdn.freesound.org/previews/251/251099_4413328-lq.mp3',
        description: 'Sparkle effect (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'coin-drop.mp3',
        url: 'https://cdn.freesound.org/previews/213/213094_3906994-lq.mp3',
        description: 'Coin drop (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'coin-collect.mp3',
        url: 'https://cdn.freesound.org/previews/213/213095_3906994-lq.mp3',
        description: 'Coin collect (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'cash-register.mp3',
        url: 'https://cdn.freesound.org/previews/213/213096_3906994-lq.mp3',
        description: 'Cash register (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'typing-keyboard.mp3',
        url: 'https://cdn.freesound.org/previews/290/290131_5123851-lq.mp3',
        description: 'Keyboard typing (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'phone-ring.mp3',
        url: 'https://cdn.freesound.org/previews/343/343546_5123851-lq.mp3',
        description: 'Phone ringtone (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'alarm-clock.mp3',
        url: 'https://cdn.freesound.org/previews/343/343547_5123851-lq.mp3',
        description: 'Alarm clock (Freesound CC0)',
        category: 'UI'
    },
    {
        name: 'door-open.mp3',
        url: 'https://cdn.freesound.org/previews/177/177094_2607384-lq.mp3',
        description: 'Door opening (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'door-close.mp3',
        url: 'https://cdn.freesound.org/previews/177/177095_2607384-lq.mp3',
        description: 'Door closing (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'footstep-1.mp3',
        url: 'https://cdn.freesound.org/previews/177/177096_2607384-lq.mp3',
        description: 'Footstep (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'footstep-2.mp3',
        url: 'https://cdn.freesound.org/previews/177/177097_2607384-lq.mp3',
        description: 'Footstep 2 (Freesound CC0)',
        category: 'Effect'
    },
    {
        name: 'rain-ambient.mp3',
        url: 'https://cdn.freesound.org/previews/127/127061_1675682-lq.mp3',
        description: 'Rain ambience (Freesound CC0)',
        category: 'Ambient'
    },
    {
        name: 'thunder.mp3',
        url: 'https://cdn.freesound.org/previews/127/127062_1675682-lq.mp3',
        description: 'Thunder clap (Freesound CC0)',
        category: 'Ambient'
    },
    {
        name: 'wind-blow.mp3',
        url: 'https://cdn.freesound.org/previews/127/127063_1675682-lq.mp3',
        description: 'Wind blowing (Freesound CC0)',
        category: 'Ambient'
    }
];

// Download function
function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        protocol.get(url, (response) => {
            if (response.statusCode === 200) {
                const fileStream = fs.createWriteStream(outputPath);
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
            } else if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
            } else {
                reject(new Error(`Failed to download: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            fs.unlink(outputPath, () => {}); // Delete the file if there's an error
            reject(err);
        });
    });
}

// Main download loop
async function downloadAll() {
    let successCount = 0;
    let failCount = 0;

    for (const sfx of sfxCollection) {
        const outputPath = path.join(sfxFolder, sfx.name);
        console.log(`Downloading: ${sfx.description}`);
        
        try {
            await downloadFile(sfx.url, outputPath);
            console.log(`  ✓ Downloaded successfully`);
            successCount++;
        } catch (error) {
            console.log(`  ✗ Failed: ${error.message}`);
            failCount++;
        }
    }

    console.log('\n================================');
    console.log('Download Complete!');
    console.log('================================');
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    console.log(`\nSFX files saved to: ${sfxFolder}`);
}

downloadAll().catch(console.error);
