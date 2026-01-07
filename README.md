# AnimeSalt Scraper API

A robust, stealthy, and Docker-ready API scraper for `animesalt.top`.
This project uses **Playwright** (browser automation) to extract HLS streaming links (`.m3u8`) and subtitle/audio tracks from anime episodes, bypassing standard iframe protections.

## Features
- 🚀 **Full Browser Scraping**: Handles complex JavaScript and nested iframes using Playwright.
- 🥷 **Stealth Mode**: Includes valid User-Agent rotation and hidden webdriver signals to avoid bans.
- ⚡ **Performance Optimized**: Blocks ads, images, and fonts to speed up scraping.
- 💾 **Built-in Caching**: Caches results for 1 hour to reduce load and improve speed for popular episodes.
- 🐳 **Docker Ready**: Pre-configured `Dockerfile` for easy deployment on Render/Railway.
- 🎧 **Multi-Audio Support**: Extracts all available audio tracks (Hindi, English, etc.).

---

## 🛠️ Installation & Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/animesalt-scraper.git
   cd animesalt-scraper
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   npx playwright install chromium
   ```

3. **Start the API Server:**
   ```bash
   npm start
   ```
   Server runs on `http://localhost:3000`.

---

## 📡 API Documentation

### **GET /scrape**
Extracts video source and tracks from an episode URL.

**Endpoint:**
`GET http://localhost:3000/scrape`

**Query Parameters:**
| Param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `url` | string | **Yes** | The full URL of the episode (e.g., `https://animesalt.top/episode/one-piece-1x1/`) |
| `proxy` | string | No | Optional proxy URL (e.g., `http://user:pass@host:port`) |

**Example Request:**
```bash
curl "http://localhost:3000/scrape?url=https://animesalt.top/episode/lord-of-mysteries-1x13/"
```

**Example Response:**
```json
{
  "success": true,
  "cached": false,
  "source": "https://play.zephyrflick.top/cdn/hls/.../master.m3u8",
  "tracks": [
    {
      "label": "Hindi",
      "language": "hin",
      "id": "1",
      "default": false
    },
    {
      "label": "English",
      "language": "eng",
      "id": "2",
      "default": true
    }
  ],
  "captions": [
    {
      "label": "English",
      "language": "eng",
      "kind": "captions",
      "file": "https://..."
    }
  ],
  "headers": {
    "Referer": "https://play.zephyrflick.top/...",
    "User-Agent": "Mozilla/5.0 ...",
    "Origin": "https://play.zephyrflick.top"
  }
}
```

> [!IMPORTANT]
> **Streaming Requirement**: When playing the `.m3u8` link, you **MUST** forward the `Referer` and `User-Agent` headers provided in the response. If you don't, the video server will reject the request (403 Forbidden).

---

## 💻 Frontend Integration Guide (JavaScript)

Here is how you can use this API in your own website's video player code.

```javascript
async function playEpisode(episodeUrl) {
    // 1. Call your scraper API
    const apiEndpoint = 'https://your-api.onrender.com/scrape';
    const response = await fetch(`${apiEndpoint}?url=${encodeURIComponent(episodeUrl)}`);
    const data = await response.json();

    if (!data.success) {
        console.error("Scraping failed:", data.error);
        return;
    }

    // 2. Setup standard HLS player (e.g., hls.js)
    // Note: To send headers (Referer) in a browser, you usually need a proxy service 
    // or a player that supports modifying headers (like some native apps or server-side proxies).
    
    console.log("Stream URL:", data.source);
    console.log("Audio Tracks:", data.tracks);
    
    // Example: If using a proxy server for playback to handle headers
    // const playerUrl = `/stream-proxy?url=${encodeURIComponent(data.source)}&referer=${encodeURIComponent(data.headers.Referer)}`;
    // videoElement.src = playerUrl;
}
```

---

## 🚀 Deployment Guide (HOSTING)

Since this scraper uses a **Real Browser**, you cannot host it on Vercel's free tier (size limit). You must use a container platform.

### Option 1: Render.com (Recommended)
1. Push your code to **GitHub**.
2. Go to [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** -> **Web Service**.
4. Connect your GitHub repository.
5. Choose **Runtime**: `Docker`.
6. Click **Create Web Service**.

### Option 2: Railway.app
1. Push code to GitHub.
2. Login to Railway and "New Project" -> "Deploy from GitHub".
3. Railway automatically detects the `Dockerfile` and deploys it.

The deployment will take a few minutes to build the browser. Once done, you will get a URL like `https://animesalt-scraper.onrender.com`. Use this URL as your API endpoint.
