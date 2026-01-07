const { scrapeVideoSource } = require('./scraper');

// URL must be passed as command line argument
const targetUrl = process.argv[2];

if (!targetUrl) {
    console.error('Error: Please provide an episode URL as argument.');
    console.error('Usage: node run_scraper.js "https://animesalt.top/episode/..."');
    process.exit(1);
}

(async () => {
    console.log(`Starting scraper test for: ${targetUrl}`);
    try {
        const result = await scrapeVideoSource(targetUrl);
        console.log('\n--- SCRAPING RESULT ---');
        console.log('Video URL:', result.source);
        if (result.tracks && result.tracks.length > 0) {
            console.log('Audio Tracks:', JSON.stringify(result.tracks, null, 2));
        } else {
            console.log('Audio Tracks: None found or empty.');
        }

        if (result.captions && result.captions.length > 0) {
            console.log('Subtitles:', JSON.stringify(result.captions, null, 2));
        } else {
            console.log('Subtitles: None found.');
        }
        console.log('Headers:', JSON.stringify(result.headers, null, 2));
        console.log('-----------------------\n');

        console.log('You can now use this Video URL in your HLS player (e.g., hls.js) with the provided headers.');
    } catch (error) {
        console.error('Test Failed:', error);
    }
})();
