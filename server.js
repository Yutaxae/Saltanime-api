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
        console.log(`Serving cached result for: ${url}`);
        return res.json({ success: true, cached: true, ...cachedResult });
    }

    console.log(`Received scrape request for: ${url}`);

    try {
        const result = await scrapeVideoSource(url, proxy);
        cache.set(cacheKey, result); // Store in cache
        res.json({ success: true, cached: false, ...result });
    } catch (error) {
        console.error('Scraping failed:', error.message);
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

app.get('/stream', async (req, res) => {
    const { url, referer } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" query parameter' });
    }

    try {
        // Import fetch dynamically (Node 18+ has native fetch)
        const response = await fetch(url, {
            headers: {
                'Referer': referer || new URL(url).origin,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': referer ? new URL(referer).origin : new URL(url).origin
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: `Upstream returned ${response.status}`,
                url: url
            });
        }

        // Set appropriate headers for streaming
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        // Allow CORS for all origins
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Pipe the response body to the client
        const reader = response.body.getReader();
        const pump = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        };
        pump().catch(err => {
            console.error('Stream error:', err.message);
            res.end();
        });

    } catch (error) {
        console.error('Stream proxy error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
