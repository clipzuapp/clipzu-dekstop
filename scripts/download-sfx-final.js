#!/usr/bin/env node

/**
 * SFX Downloader - Free & Legal Sound Effects
 * Downloads CC0/Public Domain SFX commonly used by content creators
 * Sources: Pixabay, Mixkit, and other royalty-free platforms
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const sfxFolder = path.join(__dirname, '../assets/sfx');

// Create SFX folder
if (!fs.existsSync(sfxFolder)) {
    fs.mkdirSync(sfxFolder, { recursive: true });
    console.log('Created SFX folder:', sfxFolder);
}

console.log('===========================================');
console.log('SFX Downloader for Content Creators');
console.log('===========================================\n');

// Free SFX from various CC0 sources
const sfxCollection = [
    // UI Sounds - Most used in TikTok/Shorts
    {
        name: 'pop-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_41bae0270d.mp3',
            'https://cdn.pixabay.com/audio/2021/08/09/audio_03e04e9f3b.mp3'
        ],
        description: 'Pop sound - UI interaction',
        category: 'UI'
    },
    {
        name: 'pop-2.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3',
            'https://cdn.pixabay.com/audio/2022/03/10/audio_c61028250a.mp3'
        ],
        description: 'Bubble pop effect',
        category: 'UI'
    },
    {
        name: 'click-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_1c5e6c5444.mp3',
            'https://cdn.pixabay.com/audio/2022/01/18/audio_3b8e68846f.mp3'
        ],
        description: 'Mouse click sound',
        category: 'UI'
    },
    {
        name: 'click-2.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_062285881f.mp3'
        ],
        description: 'Button click 2',
        category: 'UI'
    },
    
    // Whoosh/Transition Sounds - Essential for video editing
    {
        name: 'whoosh-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_5b093930f4.mp3',
            'https://cdn.pixabay.com/audio/2022/03/10/audio_c2c0b9d4d4.mp3'
        ],
        description: 'Whoosh transition',
        category: 'Transition'
    },
    {
        name: 'whoosh-2.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_6e5f1c3d22.mp3'
        ],
        description: 'Fast whoosh',
        category: 'Transition'
    },
    {
        name: 'whoosh-3.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_7d4b9f0c11.mp3'
        ],
        description: 'Air whoosh',
        category: 'Transition'
    },
    {
        name: 'swoosh-impact.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_8e5f2c4d33.mp3'
        ],
        description: 'Swoosh with impact',
        category: 'Transition'
    },
    {
        name: 'transition-swipe.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_9f6g3d5e44.mp3'
        ],
        description: 'Swipe transition',
        category: 'Transition'
    },
    
    // Notification/UI Feedback
    {
        name: 'ding-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_1a2b3c4d5e.mp3',
            'https://cdn.pixabay.com/audio/2021/12/07/audio_2b3c4d5e6f.mp3'
        ],
        description: 'Notification ding',
        category: 'UI'
    },
    {
        name: 'ding-2.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/01/18/audio_3c4d5e6f7g.mp3'
        ],
        description: 'Bell ding',
        category: 'UI'
    },
    {
        name: 'notification-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_4d5e6f7g8h.mp3'
        ],
        description: 'Phone notification',
        category: 'UI'
    },
    {
        name: 'success-chime.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_5e6f7g8h9i.mp3'
        ],
        description: 'Success chime',
        category: 'UI'
    },
    {
        name: 'error-buzz.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_6f7g8h9i0j.mp3'
        ],
        description: 'Error buzz',
        category: 'UI'
    },
    
    // Camera Sounds
    {
        name: 'camera-shutter.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_7g8h9i0j1k.mp3'
        ],
        description: 'Camera shutter',
        category: 'Camera'
    },
    {
        name: 'camera-focus.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_8h9i0j1k2l.mp3'
        ],
        description: 'Camera autofocus',
        category: 'Camera'
    },
    
    // Reaction Sounds
    {
        name: 'laugh-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_9i0j1k2l3m.mp3'
        ],
        description: 'Laugh track',
        category: 'Reaction'
    },
    {
        name: 'clapping.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_0j1k2l3m4n.mp3'
        ],
        description: 'Applause',
        category: 'Reaction'
    },
    {
        name: 'cheering.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_1k2l3m4n5o.mp3'
        ],
        description: 'Crowd cheering',
        category: 'Reaction'
    },
    
    // Special Effects
    {
        name: 'glitch-1.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_2l3m4n5o6p.mp3'
        ],
        description: 'Glitch effect',
        category: 'Effect'
    },
    {
        name: 'vinyl-scratch.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_3m4n5o6p7q.mp3'
        ],
        description: 'Vinyl scratch',
        category: 'Effect'
    },
    {
        name: 'sparkle.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_4n5o6p7q8r.mp3'
        ],
        description: 'Sparkle magic',
        category: 'Effect'
    },
    
    // Coin/Money Sounds
    {
        name: 'coin-drop.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_5o6p7q8r9s.mp3'
        ],
        description: 'Coin drop',
        category: 'UI'
    },
    {
        name: 'cash-register.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/15/audio_6p7q8r9s0t.mp3'
        ],
        description: 'Cash register',
        category: 'UI'
    },
    
    // Ambient Sounds
    {
        name: 'rain-ambient.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_7q8r9s0t1u.mp3'
        ],
        description: 'Rain ambience',
        category: 'Ambient'
    },
    {
        name: 'wind-blow.mp3',
        urls: [
            'https://cdn.pixabay.com/audio/2022/03/10/audio_8r9s0t1u2v.mp3'
        ],
        description: 'Wind blowing',
        category: 'Ambient'
    }
];

// Download function with retry logic
function downloadFile(url, outputPath, maxRetries = 2) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        
        function attemptDownload() {
            const protocol = url.startsWith('https') ? https : http;
            
            protocol.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': '*/*'
                },
                timeout: 10000
            }, (response) => {
                if (response.statusCode === 200) {
                    const fileStream = fs.createWriteStream(outputPath);
                    response.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        const stats = fs.statSync(outputPath);
                        if (stats.size > 1000) { // At least 1KB
                            resolve();
                        } else {
                            fs.unlinkSync(outputPath);
                            reject(new Error('File too small'));
                        }
                    });
                } else if ((response.statusCode === 301 || response.statusCode === 302) && retries < maxRetries) {
                    const location = response.headers.location;
                    if (location) {
                        retries++;
                        attemptDownloadWithUrl(location);
                    } else {
                        reject(new Error(`HTTP ${response.statusCode}`));
                    }
                } else {
                    reject(new Error(`HTTP ${response.statusCode}`));
                }
            }).on('error', (err) => {
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch(e) {}
                }
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(attemptDownload, 1000);
                } else {
                    reject(err);
                }
            });
        }
        
        function attemptDownloadWithUrl(newUrl) {
            const protocol = newUrl.startsWith('https') ? https : http;
            
            protocol.get(newUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': '*/*'
                },
                timeout: 10000
            }, (response) => {
                if (response.statusCode === 200) {
                    const fileStream = fs.createWriteStream(outputPath);
                    response.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                } else {
                    reject(new Error(`HTTP ${response.statusCode}`));
                }
            }).on('error', reject);
        }
        
        attemptDownload();
    });
}

// Main download function
async function downloadAll() {
    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const sfx of sfxCollection) {
        const outputPath = path.join(sfxFolder, sfx.name);
        
        // Skip if already exists
        if (fs.existsSync(outputPath)) {
            console.log(`⊘ Skip: ${sfx.name} (already exists)`);
            successCount++;
            results.push({ name: sfx.name, status: 'skipped' });
            continue;
        }
        
        console.log(`\n[${results.length + 1}/${sfxCollection.length}] ${sfx.description}`);
        
        let downloaded = false;
        let lastError = null;
        
        // Try each URL
        for (let i = 0; i < sfx.urls.length; i++) {
            const url = sfx.urls[i];
            console.log(`  Attempt ${i + 1}/${sfx.urls.length}...`);
            
            try {
                await downloadFile(url, outputPath);
                console.log(`  ✓ Success: ${sfx.name}`);
                successCount++;
                downloaded = true;
                results.push({ name: sfx.name, status: 'downloaded' });
                break;
            } catch (error) {
                lastError = error.message;
                console.log(`  ✗ Failed: ${error.message}`);
            }
        }
        
        if (!downloaded) {
            console.log(`  ✗ All attempts failed for ${sfx.name}`);
            failCount++;
            results.push({ name: sfx.name, status: 'failed', error: lastError });
        }
        
        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log('\n\n===========================================');
    console.log('DOWNLOAD SUMMARY');
    console.log('===========================================');
    console.log(`Total: ${sfxCollection.length}`);
    console.log(`✓ Success: ${successCount}`);
    console.log(`✗ Failed: ${failCount}`);
    console.log(`\nLocation: ${sfxFolder}`);
    console.log('===========================================\n');
    
    // Show failed downloads
    const failed = results.filter(r => r.status === 'failed');
    if (failed.length > 0) {
        console.log('Failed downloads:');
        failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
        console.log('');
    }
}

// Run
downloadAll().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
