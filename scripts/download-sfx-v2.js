#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const sfxFolder = path.join(__dirname, '../assets/sfx');

// Create SFX folder if it doesn't exist
if (!fs.existsSync(sfxFolder)) {
    fs.mkdirSync(sfxFolder, { recursive: true });
}

console.log('Starting SFX download for content creators...');
console.log('Downloading from free and legal sources (CC0 - Public Domain)\n');

// Using reliable free SFX sources
const sfxCollection = [
    // UI/Interface Sounds
    {
        name: 'pop-1.mp3',
        url: 'https://www.soundjay.com/buttons/sounds/button-09.mp3',
        description: 'Pop/Click sound',
        category: 'UI'
    },
    {
        name: 'pop-2.mp3',
        url: 'https://www.soundjay.com/buttons/sounds/button-16.mp3',
        description: 'Bubble pop',
        category: 'UI'
    },
    {
        name: 'click-1.mp3',
        url: 'https://www.soundjay.com/buttons/sounds/button-3.mp3',
        description: 'Mouse click',
        category: 'UI'
    },
    {
        name: 'whoosh-1.mp3',
        url: 'https://www.soundjay.com/transportation/sounds/whoosh-1.mp3',
        description: 'Whoosh transition',
        category: 'Transition'
    },
    {
        name: 'whoosh-2.mp3',
        url: 'https://www.soundjay.com/transportation/sounds/whoosh-2.mp3',
        description: 'Fast whoosh',
        category: 'Transition'
    },
    {
        name: 'ding-1.mp3',
        url: 'https://www.soundjay.com/buttons/sounds/button-4.mp3',
        description: 'Notification ding',
        category: 'UI'
    },
    {
        name: 'ding-2.mp3',
        url: 'https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3',
        description: 'Bell ding',
        category: 'UI'
    },
    {
        name: 'success-chime.mp3',
        url: 'https://www.soundjay.com/human/sounds/applause-01.mp3',
        description: 'Success/Applause',
        category: 'UI'
    },
    {
        name: 'camera-shutter.mp3',
        url: 'https://www.soundjay.com/mechanical/sounds/camera-shutter-1.mp3',
        description: 'Camera shutter',
        category: 'Camera'
    },
    {
        name: 'laugh-1.mp3',
        url: 'https://www.soundjay.com/human/sounds/laugh-1.mp3',
        description: 'Laugh track',
        category: 'Reaction'
    },
    {
        name: 'clapping.mp3',
        url: 'https://www.soundjay.com/human/sounds/clapping-01.mp3',
        description: 'Applause',
        category: 'Reaction'
    },
    {
        name: 'coin-drop.mp3',
        url: 'https://www.soundjay.com/coins/sounds/coins-dropping-1.mp3',
        description: 'Coin drop',
        category: 'UI'
    },
    {
        name: 'door-close.mp3',
        url: 'https://www.soundjay.com/door/sounds/door-close-01.mp3',
        description: 'Door closing',
        category: 'Effect'
    },
    {
        name: 'rain-ambient.mp3',
        url: 'https://www.soundjay.com/nature/sounds/rainfall-02.mp3',
        description: 'Rain ambience',
        category: 'Ambient'
    }
];

// Download function with better error handling
function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        const request = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            if (response.statusCode === 200) {
                const fileStream = fs.createWriteStream(outputPath);
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
            } else if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                request.get(response.headers.location, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }, (redirectResponse) => {
                    if (redirectResponse.statusCode === 200) {
                        const fileStream = fs.createWriteStream(outputPath);
                        redirectResponse.pipe(fileStream);
                        fileStream.on('finish', () => {
                            fileStream.close();
                            resolve();
                        });
                    } else {
                        reject(new Error(`Failed to download: ${redirectResponse.statusCode}`));
                    }
                }).on('error', reject);
            } else {
                reject(new Error(`Failed to download: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
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
            console.log(`  ✓ Success`);
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
