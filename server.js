const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const { scrapeVideoSource } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'AnimeSalt Scraper API is running.' });
});

app.get('/scrape', async (req, res) => {
    const { url, proxy } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" query parameter' });
    }

    // Check cache
    const cacheKey = `${url}-${proxy || 'no-proxy'}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        return res.json({ success: true, cached: true, ...cachedResult });
    }



    try {
        const result = await scrapeVideoSource(url, proxy);
        cache.set(cacheKey, result); // Store in cache
        res.json({ success: true, cached: false, ...result });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ============================================
// STREAM PROXY - Forward video requests with correct headers
// ============================================
// Usage: GET /stream?url=<m3u8_url>&referer=<referer_url>
// This allows browsers to play HLS streams that require specific headers
// Rewrites all URLs in m3u8 files to go through this proxy

app.get('/stream', async (req, res) => {
    const { url, referer } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" query parameter' });
    }

    try {
        const parsedUrl = new URL(url);
        const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
        const effectiveReferer = referer || baseUrl;

        // Get our own host for proxying (works in both local and deployed)
        const proxyBase = `${req.protocol}://${req.get('host')}`;

        const response = await fetch(url, {
            headers: {
                'Referer': effectiveReferer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': new URL(effectiveReferer).origin
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: `Upstream returned ${response.status}`,
                url: url
            });
        }

        const contentType = response.headers.get('content-type') || '';
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // Check if this is an m3u8 file (HLS manifest)
        const isM3u8 = url.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL');

        if (isM3u8) {
            // For m3u8 files, rewrite ALL URLs to go through our proxy
            const text = await response.text();

            // Helper function to convert any URL to a proxied URL
            const toProxyUrl = (originalUrl) => {
                let absoluteUrl = originalUrl;

                // Convert to absolute URL first
                if (originalUrl.startsWith('/')) {
                    absoluteUrl = `${baseUrl}${originalUrl}`;
                } else if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
                    const manifestDir = url.substring(0, url.lastIndexOf('/') + 1);
                    absoluteUrl = `${manifestDir}${originalUrl}`;
                }

                // Now wrap in proxy
                return `${proxyBase}/stream?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(effectiveReferer)}`;
            };

            // Rewrite content
            let rewrittenContent = text
                // Replace line-based URLs (video/audio segments, variant playlists)
                .split('\n')
                .map(line => {
                    // Skip comments and empty lines
                    if (line.startsWith('#') || line.trim() === '') return line;
                    // This is a URL line - proxy it
                    return toProxyUrl(line.trim());
                })
                .join('\n')
                // Also fix URI= attributes in #EXT-X-MEDIA and similar tags
                .replace(/URI="([^"]+)"/g, (match, uri) => {
                    return `URI="${toProxyUrl(uri)}"`;
                });

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.send(rewrittenContent);
        } else {
            // For non-m3u8 files (video/audio segments), just pipe through
            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }

            // Get content length for proper streaming
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                res.setHeader('Content-Length', contentLength);
            }

            const reader = response.body.getReader();
            const pump = async () => {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            };
            pump().catch(() => res.end());
        }

    } catch (error) {
        console.error('Stream proxy error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => { });

