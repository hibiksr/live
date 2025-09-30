const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const NodeCache = require('node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const fs = require('fs').promises;
const fsSync = require('fs'); // Using sync version for file watching
const path = require('path');

// --- Constants (Unchanged) ---
const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const CUSTOM_CHANNELS_FILE = process.env.CUSTOM_CHANNELS_FILE || './custom-channels.json';
const PORT = process.env.PORT || 3000;
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL) || 86400000; // 24 hours
const PROXY_URL = process.env.PROXY_URL || '';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 10000;

// --- Initial Setup (Unchanged) ---
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : ['GR'],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
    enableCustomChannels: process.env.ENABLE_CUSTOM_CHANNELS !== 'false'
};

const app = express();
app.use(express.json());
const cache = new NodeCache({ stdTTL: 0 });


/**
 * Main application startup function.
 * We wrap everything in an async function to ensure that we wait for the
 * initial configuration to be loaded before starting the server.
 */
async function startServer() {

    // --- STEP 1: Finalize Configuration Asynchronously ---
    try {
        await fs.access(CUSTOM_CHANNELS_FILE);
        if (config.enableCustomChannels && !config.includeCountries.includes('AU')) {
            config.includeCountries.push('AU');
            console.log('Custom channels file found. Added AU to included countries.');
        }
    } catch (error) {
        console.log('Custom channels file not found, skipping AU addition.');
    }

    // --- STEP 2: Create the Manifest with the FINALIZED Configuration ---
    // This manifest is now built once and will not change for the lifetime of the server.
    const manifest = {
        id: 'org.iptv',
        name: 'IPTV Addon',
        version: '0.0.4', // Incremented version to help Stremio update
        description: `Watch live TV from ${config.includeCountries.join(', ')}`,
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        catalogs: config.includeCountries.map(country => ({
            type: 'tv',
            id: `iptv-channels-${country}`,
            name: `IPTV - ${country}`,
            extra: [{
                name: 'genre',
                isRequired: false,
                options: [
                    "animation", "auto", "business", "classic", "comedy",
                    "cooking", "culture", "documentary", "education",
                    "entertainment", "family", "kids", "legislative",
                    "lifestyle", "movies", "music", "general", "religious",
                    "news", "outdoor", "relax", "series", "science", "shop",
                    "sports", "travel", "weather",
                    // Your custom category is now guaranteed to be included
                    "love_custom"
                ]
            }]
        })),
        idPrefixes: ['iptv-'],
        behaviorHints: { configurable: false, configurationRequired: false },
        logo: "https://dl.strem.io/addon-logo.png",
        icon: "https://dl.strem.io/addon-logo.png",
        background: "https://dl.strem.io/addon-background.jpg",
    };

    // --- STEP 3: Create the Addon Instance with the Finalized Manifest ---
    const addon = new addonBuilder(manifest);


    // --- All Helper Functions are defined below ---

    const loadCustomChannels = async () => {
        if (!config.enableCustomChannels) {
            return { channels: [], streams: [] };
        }
        try {
            const fileContent = await fs.readFile(CUSTOM_CHANNELS_FILE, 'utf8');
            const customData = JSON.parse(fileContent);
            const channels = (customData.channels || []).map(channel => ({
                ...channel,
                country: channel.country || 'AU',
                categories: channel.categories || ['auto'],
                isCustom: true
            }));
            const streams = (customData.streams || []).map(stream => ({
                ...stream,
                isCustom: true
            }));
            console.log(`Loaded ${channels.length} custom channels and ${streams.length} custom streams.`);
            return { channels, streams };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading custom channels:', error);
            }
            return { channels: [], streams: [] };
        }
    };

    const toMeta = (channel) => ({
        id: `iptv-${channel.id}`,
        name: channel.name,
        type: 'tv',
        genres: [...(channel.categories || []), channel.country].filter(Boolean),
        poster: channel.logo,
        posterShape: 'square',
        background: channel.logo || null,
        logo: channel.logo || null,
        isCustom: channel.isCustom || false
    });
    
    const getApiChannels = async () => {
        console.log("Downloading API channels");
        try {
            const response = await axios.get(IPTV_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
            console.log("Finished downloading API channels.");
            return response.data;
        } catch (error) {
            console.error('Error fetching API channels:', error.message);
            return cache.get('apiChannels') || [];
        }
    };
    
    const getApiStreams = async () => {
        if (!cache.has('apiStreams')) {
            console.log("Downloading API streams");
            try {
                const response = await axios.get(IPTV_STREAMS_URL, { timeout: FETCH_TIMEOUT });
                cache.set('apiStreams', response.data);
                console.log("Finished downloading and cached API streams.");
            } catch (error) {
                console.error('Error fetching API streams:', error.message);
                return [];
            }
        }
        return cache.get('apiStreams');
    };

    const getAllInfo = async () => {
        if (cache.has('channelsInfo')) {
            return cache.get('channelsInfo');
        }

        const [apiStreams, apiChannels, customData] = await Promise.all([
            getApiStreams(),
            getApiChannels(),
            loadCustomChannels()
        ]);
        
        const allChannels = [...(apiChannels || []), ...customData.channels];
        const allStreams = [...(apiStreams || []), ...customData.streams];

        if (!allChannels.length) {
            console.log('No channels available from any source.');
            return [];
        }

        const streamMap = new Map();
        allStreams.forEach(stream => {
            if (stream.channel) {
                streamMap.set(stream.channel, stream);
            }
        });

        const channelsWithDetails = allChannels
            .filter(channel => {
                if (!streamMap.has(channel.id)) return false;

                if (channel.isCustom) return true; // Always include custom channels that have a stream

                if (config.includeCountries.length > 0 && !config.includeCountries.includes(channel.country)) return false;
                if (config.excludeCountries.length > 0 && config.excludeCountries.includes(channel.country)) return false;
                if (channel.languages) {
                    if (config.includeLanguages.length > 0 && !channel.languages.some(lang => config.includeLanguages.includes(lang))) return false;
                    if (config.excludeLanguages.length > 0 && channel.languages.some(lang => config.excludeLanguages.includes(lang))) return false;
                }
                if (config.excludeCategories.some(cat => channel.categories && channel.categories.includes(cat))) return false;
                
                return true;
            })
            .map(channel => {
                const streamInfo = streamMap.get(channel.id);
                const meta = toMeta(channel);
                meta.streamInfo = {
                    url: streamInfo.url,
                    title: streamInfo.title || 'Live Stream',
                    httpReferrer: streamInfo.referrer || streamInfo.http_referrer,
                    userAgent: streamInfo.user_agent
                };
                return meta;
            });
            
        console.log(`Total channels processed: ${channelsWithDetails.length} (API: ${channelsWithDetails.filter(c => !c.isCustom).length}, Custom: ${channelsWithDetails.filter(c => c.isCustom).length})`);
        cache.set('channelsInfo', channelsWithDetails);
        return channelsWithDetails;
    };
    
    // This function will be used by the cache management and file watcher
    const fetchAndCacheInfo = async () => {
        console.log("Refreshing channel cache...");
        cache.del('channelsInfo'); // Force a full reload
        try {
            const metas = await getAllInfo();
            console.log(`${metas.length} channel(s) information cached successfully.`);
        } catch (error) {
            console.error('Error during scheduled cache refresh:', error);
        }
    };


    // --- Addon Handlers (defined once, using the addon instance) ---

    addon.defineCatalogHandler(async ({ type, id, extra }) => {
        if (type === 'tv' && id.startsWith('iptv-channels-')) {
            const country = id.split('-')[2];
            const allChannels = await getAllInfo();
            let metas = allChannels.filter(channel => channel.genres.includes(country));

            if (extra && extra.genre) {
                metas = metas.filter(channel => channel.genres.includes(extra.genre));
            }
            console.log(`Serving catalog for ${country} with ${metas.length} channels${extra?.genre ? ` (genre: ${extra.genre})` : ''}`);
            return { metas };
        }
        return { metas: [] };
    });

    addon.defineMetaHandler(async ({ type, id }) => {
        if (type === 'tv' && id.startsWith('iptv-')) {
            const channels = await getAllInfo();
            const meta = channels.find((m) => m.id === id);
            return { meta: meta || {} };
        }
        return { meta: {} };
    });

    addon.defineStreamHandler(async ({ type, id }) => {
        if (type === 'tv' && id.startsWith('iptv-')) {
            const channels = await getAllInfo();
            const channel = channels.find((m) => m.id === id);
            if (channel?.streamInfo) {
                console.log(`Serving stream for: ${channel.name} (ID: ${channel.id}${channel.isCustom ? ' [CUSTOM]' : ''})`);
                return { streams: [channel.streamInfo] };
            }
        }
        return { streams: [] };
    });

    // --- STEP 4: Start the HTTP Server ---
    // The manifest endpoint now serves the static manifest object created in Step 2.
    // The addon interface handlers were configured in Step 3 and are now ready.
    app.get('/manifest.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.json(manifest);
    });

    serveHTTP(addon.getInterface(), { server: app, port: PORT });
    
    console.log(`IPTV Addon server running on port ${PORT}`);
    console.log(`Manifest URL: http://127.0.0.1:${PORT}/manifest.json`);
    console.log(`Custom channels: ${config.enableCustomChannels ? 'Enabled' : 'Disabled'}`);
    
    // --- STEP 5: Set up Caching, File Watching, and Scheduled Tasks ---
    
    if (config.enableCustomChannels) {
        try {
            fsSync.watchFile(CUSTOM_CHANNELS_FILE, { interval: 5000 }, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    console.log('Custom channels file changed, reloading cache...');
                    fetchAndCacheInfo(); // This will clear and rebuild the cache
                }
            });
            console.log(`Watching custom channels file for changes: ${CUSTOM_CHANNELS_FILE}`);
        } catch (error) {
            console.log(`Not watching custom channels file, it may not exist yet: ${error.message}`);
        }
    }

    // Initial data fetch when the server starts
    fetchAndCacheInfo();

    // Schedule subsequent fetches
    setInterval(fetchAndCacheInfo, FETCH_INTERVAL);

} // --- End of startServer function ---


// --- Run the application ---
startServer().catch(error => {
    console.error('Failed to start addon server:', error);
});
