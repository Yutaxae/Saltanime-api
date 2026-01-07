const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');

// Enable stealth plugin
chromium.use(stealth());

let browserInstance = null;

/**
 * Initializes or retrieves the existing browser instance.
 * Reuses the browser to save startup time.
 */
async function getBrowser() {
    if (browserInstance && browserInstance.isConnected()) {
        return browserInstance;
    }


    browserInstance = await chromium.launch({
        headless: true, // Use headless mode for better HLS/media support
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--autoplay-policy=no-user-gesture-required' // Allow autoplay for HLS
        ]
    });
    return browserInstance;
}

/**
 * Validates the extracted HLS URL.
 * @param {string} url 
 */
async function validateStreamUrl(url) {
    if (!url || !url.startsWith('http')) return false;
    return true;
}

/**
 * Scrapes video source with Retry Logic and Browser Reuse.
 * @param {string} episodeUrl 
 * @param {string} [proxyUrl] 
 * @param {number} [retries=2] 
 */
async function scrapeVideoSource(episodeUrl, proxyUrl = null, retries = 2) {
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        let context;
        let page;

        try {
            const browser = await getBrowser();

            // Generate a random user agent
            const userAgent = new UserAgent({ deviceCategory: 'desktop' });

            const contextOptions = {
                userAgent: userAgent.toString(),
                locale: 'en-US',
                timezoneId: 'America/New_York',
            };

            if (proxyUrl) {
                contextOptions.proxy = { server: proxyUrl };
            }

            // Create a specialized, isolated context for this request
            context = await browser.newContext(contextOptions);
            page = await context.newPage();

            // Optimize: Block unnecessary resources
            await page.route('**/*', route => {
                const resourceType = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    return route.abort();
                }
                route.continue();
            });

            // Random stealth delay
            const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));


            await randomDelay(500, 1500); // Shorter delay since we are faster now
            await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });



            // Wait for the iframe to appear
            const iframeElement = await page.waitForSelector('iframe[src*="zephyrflick"], iframe[src*="player"], iframe[src*="video"]', { timeout: 10000 });
            const iframeSrc = await iframeElement.getAttribute('src');

            if (!iframeSrc) throw new Error('Iframe found but has no src attribute.');



            await page.goto(iframeSrc, {
                referer: episodeUrl,
                waitUntil: 'domcontentloaded',
                timeout: 45000
            });

            await page.waitForFunction(() => typeof window.jwplayer === 'function', null, { timeout: 15000 });
            await page.waitForFunction(() => {
                try { return window.jwplayer().getPlaylist() && window.jwplayer().getPlaylist().length > 0; }
                catch (e) { return false; }
            }, null, { timeout: 10000 });

            // IMPORTANT: Audio tracks only populate AFTER video starts playing (HLS manifest parsed)

            await page.evaluate(() => window.jwplayer().play());

            // Wait for HLS manifest to download and parse (audio tracks come from manifest)

            await new Promise(r => setTimeout(r, 4000));


            try {
                await page.waitForFunction(() => {
                    const p = window.jwplayer();
                    // Audio tracks from HLS manifest - needs time to load
                    const hasTracks = p.getAudioTracks && p.getAudioTracks().length > 0;
                    const hasCaptions = p.getCaptionsList && p.getCaptionsList().length > 1;
                    return hasTracks || hasCaptions;
                }, null, { timeout: 10000 });
            } catch (e) {

            }

            // Pause playback after extracting
            await page.evaluate(() => window.jwplayer().pause());



            const videoData = await page.evaluate(() => {
                try {
                    const player = window.jwplayer();
                    const playlist = player.getPlaylist();
                    if (!playlist || playlist.length === 0) return { error: 'Empty playlist' };

                    const sources = playlist[0].sources;
                    const hlsSource = sources.find(s => s.type === 'hls' || s.file.includes('.m3u8'));

                    let audioTracks = [];
                    if (typeof player.getAudioTracks === 'function') {
                        const tracks = player.getAudioTracks();
                        if (Array.isArray(tracks)) {
                            audioTracks = tracks.map(track => ({
                                label: track.label,
                                language: track.language,
                                id: track.id,
                                autoselect: track.autoselect,
                                default: track.default
                            }));
                        }
                    }

                    let captions = [];
                    // Method 1: getCaptionsList()
                    if (typeof player.getCaptionsList === 'function') {
                        const tracks = player.getCaptionsList();
                        if (Array.isArray(tracks)) {
                            captions = tracks.map(track => ({
                                label: track.label,
                                kind: track.kind || 'captions',
                                language: track.language || 'unknown',
                                file: track.file
                            }));
                        }
                    }

                    // Method 2: Fallback to getConfig().captions if empty
                    if (captions.length <= 1) { // <= 1 assumes "Off" might be there
                        const config = player.getConfig();
                        if (config && config.captions && Array.isArray(config.captions)) {
                            const configCaptions = config.captions.map(track => ({
                                label: track.label,
                                kind: track.kind || 'captions',
                                language: track.language || 'unknown',
                                file: track.file
                            }));
                            // Merge ensuring uniqueness by file
                            const existingFiles = new Set(captions.map(c => c.file));
                            configCaptions.forEach(cc => {
                                if (cc.file && !existingFiles.has(cc.file)) {
                                    captions.push(cc);
                                }
                            });
                        }
                    }

                    // Method 3: Check Playlist Item Tracks (Standard for JWPlayer)
                    if (playlist[0].tracks && Array.isArray(playlist[0].tracks)) {
                        const playlistTracks = playlist[0].tracks;
                        const playlistCaptions = playlistTracks.filter(t => t.kind === 'captions' || (t.file && (t.file.endsWith('.vtt') || t.file.endsWith('.srt'))));

                        // Merge
                        const existingFilesSet = new Set(captions.map(c => c.file));
                        playlistCaptions.forEach(pc => {
                            if (pc.file && !existingFilesSet.has(pc.file)) {
                                captions.push({
                                    label: pc.label || 'Unknown',
                                    kind: 'captions',
                                    language: pc.language || 'unknown',
                                    file: pc.file
                                });
                            }
                        });
                    }

                    return {
                        file: hlsSource ? hlsSource.file : sources[0].file,
                        tracks: audioTracks,
                        captions: captions,
                        debug_playlist_tracks: playlist[0].tracks // Debug: Return raw playlist tracks
                    };
                } catch (e) {
                    return { error: e.toString() };
                }
            });

            if (!videoData || videoData.error || !videoData.file) {
                throw new Error('Extraction failed: ' + JSON.stringify(videoData));
            }

            // Health Check
            if (!(await validateStreamUrl(videoData.file))) {
                throw new Error('Invalid HLS URL extracted');
            }

            const playerUrl = page.url();

            // SUCCESS!
            return {
                source: videoData.file,
                tracks: videoData.tracks,
                captions: videoData.captions,
                headers: {
                    'Referer': playerUrl,
                    'User-Agent': await page.evaluate(() => navigator.userAgent),
                    'Origin': new URL(playerUrl).origin,
                    'Cookie': await page.evaluate(() => document.cookie) // Some streams need cookies
                }
            };

        } catch (error) {

            if (attempt > retries) {
                throw error; // All retries failed
            }
            // Wait before retry
            await new Promise(r => setTimeout(r, 2000));
        } finally {
            if (context) await context.close(); // Only close the context, keep browser open!
        }
    }
}

module.exports = { scrapeVideoSource };
