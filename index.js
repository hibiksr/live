// index.js
const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const NodeCache = require('node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const fs = require('fs').promises;
const path = require('path');

// Constants
const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const CUSTOM_CHANNELS_FILE = process.env.CUSTOM_CHANNELS_FILE || './custom-channels.json';
const PORT = process.env.PORT || 3000;
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL) || 86400000;
const PROXY_URL = process.env.PROXY_URL || '';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 10000;

// Standard genre list
const STANDARD_GENRES = [
    "animation",
    "auto",
    "business",
    "classic",
    "comedy",
    "cooking",
    "culture",
    "documentary",
    "education",
    "entertainment",
    "family",
    "kids",
    "legislative",
    "lifestyle",
    "movies",
    "music",
    "general",
    "religious",
    "news",
    "outdoor",
    "relax",
    "series",
    "science",
    "shop",
    "sports",
    "travel",
    "weather",
    "xxx"
];

// Configuration for channel filtering
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : [],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
    enableCustomChannels: process.env.ENABLE_CUSTOM_CHANNELS !== 'false',
    allGenres: [...STANDARD_GENRES] // Will be populated with custom genres
};

// Express app setup
const app = express();
app.use(express.json());

// Cache setup
const cache = new NodeCache({ stdTTL: 0 });

// Load custom channels from JSON file
const loadCustomChannels = async () => {
    if (!config.enableCustomChannels) {
        return { channels: [], streams: [], customGenres: [] };
    }

    try {
        const fileContent = await fs.readFile(CUSTOM_CHANNELS_FILE, 'utf8');
        const customData = JSON.parse(fileContent);
        
        // Extract unique custom categories from all channels
        const customGenresSet = new Set();
        
        // Validate and format custom channels
        const channels = (customData.channels || []).map(channel => {
            const channelCategories = channel.categories || ['general'];
            
            // Identify custom genres (not in standard list)
            channelCategories.forEach(cat => {
                if (!STANDARD_GENRES.includes(cat.toLowerCase())) {
                    customGenresSet.add(cat);
                }
            });
            
            return {
                id: channel.id || `custom.${Date.now()}.${Math.random()}`,
                name: channel.name || 'Unnamed Channel',
                alt_names: channel.alt_names || [],
                network: channel.network || null,
                owners: channel.owners || [],
                country: channel.country || 'PT', // Default to PT for custom channels
                categories: channelCategories,
                is_nsfw: channel.is_nsfw || false,
                launched: channel.launched || null,
                closed: channel.closed || null,
                replaced_by: channel.replaced_by || null,
                website: channel.website || null,
                logo: channel.logo || null,
                isCustom: true
            };
        });

        // Validate and format custom streams
        const streams = (customData.streams || []).map(stream => ({
            channel: stream.channel,
            feed: stream.feed || null,
            title: stream.title || 'Live Stream',
            url: stream.url,
            referrer: stream.referrer || null,
            user_agent: stream.user_agent || null,
            quality: stream.quality || null,
            isCustom: true
        }));

        const customGenres = Array.from(customGenresSet);
        console.log(`Loaded ${channels.length} custom channels, ${streams.length} custom streams`);
        if (customGenres.length > 0) {
            console.log(`Custom genres found: ${customGenres.join(', ')}`);
        }
        
        return { 
            channels, 
            streams, 
            customGenres 
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading custom channels:', error);
        }
        return { channels: [], streams: [], customGenres: [] };
    }
};

// Check if custom channels exist and update config
const initializeConfig = async () => {
    try {
        const customData = await loadCustomChannels();
        
        // Add PT to countries if custom channels exist
        if (customData.channels.length > 0 && !config.includeCountries.includes('PT')) {
            config.includeCountries.push('PT');
            console.log('Added PT to included countries for custom channels');
        }
        
        // Merge custom genres with standard genres (avoiding duplicates)
        const allGenresSet = new Set([...STANDARD_GENRES, ...customData.customGenres]);
        config.allGenres = Array.from(allGenresSet).sort();
        
        console.log(`Total genres available: ${config.allGenres.length}`);
        if (customData.customGenres.length > 0) {
            console.log(`Custom genres: ${customData.customGenres.join(', ')}`);
        }
        
        return customData;
    } catch (error) {
        console.log('Error initializing config:', error);
        return { channels: [], streams: [], customGenres: [] };
    }
};

// Addon Manifest - Dynamic based on config
const getManifest = () => {
    return {
        id: 'org.iptv.pt',
        name: 'Canais PT',
        version: '1.0.0',
        description: `Canais de TV de Portugal`,
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        catalogs: config.includeCountries.map(country => ({
            type: 'tv',
            id: `iptv-channels-${country}`,
            name: `IPTV - ${country}`,
            extra: [
                {
                    name: 'genre',
                    isRequired: false,
                    options: config.allGenres
                }
            ],
        })),
        idPrefixes: ['iptv-'],
        behaviorHints: { configurable: false, configurationRequired: false },
        logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/portugal/rtp-1-pt.png",
        icon: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/portugal/rtp-1-pt.png",
        background: "https://dl.strem.io/addon-background.jpg",
    };
};

let manifest;
let addon;

// Helper Functions

// Convert channel to Stremio accepted Meta object
const toMeta = (channel) => {
    const genres = [...(channel.categories || []), channel.country].filter(Boolean);
    
    return {
        id: `iptv-${channel.id}`,
        name: channel.name,
        type: 'tv',
        genres: genres,
        poster: channel.logo,
        posterShape: 'square',
        background: channel.logo || null,
        logo: channel.logo || null,
        isCustom: channel.isCustom || false
    };
};

// Fetch and filter channels
const getChannels = async () => {
    console.log("Downloading channels");
    try {
        const channelsResponse = await axios.get(IPTV_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
        console.log("Finished downloading channels");
        return channelsResponse.data;
    } catch (error) {
        console.error('Error fetching channels:', error);
        if (cache.has('channels')) {
            console.log('Serving channels from cache');
            return cache.get('channels');
        }
        return null;
    }
};

// Fetch Stream Info for the Channel
const getStreamInfo = async () => {
    if (!cache.has('streams')) {
        console.log("Downloading streams data");
        try {
            const streamsResponse = await axios.get(IPTV_STREAMS_URL, { timeout: FETCH_TIMEOUT });
            cache.set('streams', streamsResponse.data);
        } catch (error) {
            console.error('Error fetching streams:', error);
            return [];
        }
    }
    return cache.get('streams');
};

// Verify stream URL
const verifyStreamURL = async (url, userAgent, httpReferrer) => {
    const cachedResult = cache.get(url);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    const effectiveUserAgent = userAgent || 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 DMOST/2.0.0 (; LGE; webOSTV; WEBOS6.3.2 03.34.95; W6_lm21a;)';
    const effectiveReferer = httpReferrer || '';

    if (effectiveUserAgent !== 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 DMOST/2.0.0 (; LGE; webOSTV; WEBOS6.3.2 03.34.95; W6_lm21a;)') {
        console.log(`Using User-Agent: ${effectiveUserAgent}`);
    }
    if (httpReferrer) {
        console.log(`Using Referer: ${effectiveReferer}`);
    }

    let axiosConfig = {
        timeout: FETCH_TIMEOUT,
        headers: {
            'User-Agent': effectiveUserAgent,
            'Accept': '*/*',
            'Referer': effectiveReferer
        }
    };

    if (PROXY_URL) {
        if (PROXY_URL.startsWith('socks')) {
            axiosConfig.httpsAgent = new SocksProxyAgent(PROXY_URL);
        } else {
            axiosConfig.httpsAgent = new HttpProxyAgent(PROXY_URL);
        }
    }

    try {
        const response = await axios.head(url, axiosConfig);
        const result = response.status === 200;
        cache.set(url, result);
        return result;
    } catch (error) {
        console.log(`Stream URL verification failed for ${url}:`, error.message);
        cache.set(url, false);
        return false;
    }
};

// Get all channel information
const getAllInfo = async () => {
    if (cache.has('channelsInfo')) {
        return cache.get('channelsInfo');
    }

    // Load API channels and streams
    const apiStreams = await getStreamInfo();
    const apiChannels = await getChannels();

    // Load custom channels and streams
    const customData = await loadCustomChannels();

    // Combine channels and streams
    const allChannels = [...(apiChannels || []), ...customData.channels];
    const allStreams = [...apiStreams, ...customData.streams];

    if (!allChannels.length) {
        console.log('No channels available');
        return cache.get('channelsInfo') || [];
    }

    // Create stream map
    const streamMap = new Map(allStreams.map(stream => [stream.channel, stream]));

    // Filter channels based on config
    const filteredChannels = allChannels.filter((channel) => {
        // Skip country filtering for custom channels if they are from 'PT'
        if (channel.isCustom && channel.country === 'PT') {
            return streamMap.has(channel.id);
        }

        if (config.includeCountries.length > 0 && !config.includeCountries.includes(channel.country)) return false;
        if (config.excludeCountries.length > 0 && config.excludeCountries.includes(channel.country)) return false;
        if (channel.languages) {
            if (config.includeLanguages.length > 0 && !channel.languages.some(lang => config.includeLanguages.includes(lang))) return false;
            if (config.excludeLanguages.length > 0 && channel.languages.some(lang => config.excludeLanguages.includes(lang))) return false;
        }
        if (config.excludeCategories.some(cat => channel.categories && channel.categories.includes(cat))) return false;
        return streamMap.has(channel.id);
    });

    // Process channels with stream details
    const channelsWithDetails = await Promise.all(filteredChannels.map(async (channel) => {
        const streamInfo = streamMap.get(channel.id);
        if (streamInfo) {
            const meta = toMeta(channel);
            meta.streamInfo = {
                url: streamInfo.url,
                title: streamInfo.title || 'Live Stream',
                httpReferrer: streamInfo.referrer || streamInfo.http_referrer
            };
            return meta;
        }
        return null;
    }));

    const filteredChannelsInfo = channelsWithDetails.filter(Boolean);
    
    console.log(`Total channels: ${filteredChannelsInfo.length} (API: ${filteredChannelsInfo.filter(c => !c.isCustom).length}, Custom: ${filteredChannelsInfo.filter(c => c.isCustom).length})`);
    
    cache.set('channelsInfo', filteredChannelsInfo);
    return filteredChannelsInfo;
};

// Initialize addon builder
const initializeAddon = () => {
    manifest = getManifest();
    addon = new addonBuilder(manifest);

    // Catalog Handler
    addon.defineCatalogHandler(async ({ type, id, extra }) => {
        if (type === 'tv' && id.startsWith('iptv-channels-')) {
            const country = id.split('-')[2];
            const allChannels = await getAllInfo();
            let filteredChannels = allChannels.filter(channel => channel.genres.includes(country));

            if (extra && extra.genre) {
                const genres = Array.isArray(extra.genre) ? extra.genre : [extra.genre];
                filteredChannels = filteredChannels.filter(channel =>
                    genres.some(genre => channel.genres.includes(genre))
                );
            }

            console.log(`Serving catalog for ${country} with ${filteredChannels.length} channels${extra?.genre ? ` (genre: ${extra.genre})` : ''}`);
            return { metas: filteredChannels };
        }
        return { metas: [] };
    });

    // Meta Handler
    addon.defineMetaHandler(async ({ type, id }) => {
        if (type === 'tv' && id.startsWith('iptv-')) {
            const channels = await getAllInfo();
            const channel = channels.find((meta) => meta.id === id);
            if (channel) {
                return { meta: channel };
            }
        }
        return { meta: {} };
    });

    // Stream Handler
    addon.defineStreamHandler(async ({ type, id }) => {
        if (type === 'tv' && id.startsWith('iptv-')) {
            const channels = await getAllInfo();
            const channel = channels.find((meta) => meta.id === id);
            if (channel?.streamInfo) {
                console.log(`Serving stream id: ${channel.id}${channel.isCustom ? ' [CUSTOM]' : ''}`);
                return { streams: [channel.streamInfo] };
            } else {
                console.log('No matching stream found for channelID:', id);
            }
        }
        return { streams: [] };
    });
};

// Server setup - Dynamic manifest
app.get('/manifest.json', async (req, res) => {
    // Reinitialize config to check for custom channels
    await initializeConfig();
    initializeAddon();
    
    res.setHeader('Content-Type', 'application/json');
    res.json(manifest);
});

// Cache management
const fetchAndCacheInfo = async () => {
    try {
        // Clear the cache to force reload of custom channels
        cache.del('channelsInfo');
        
        // Reinitialize config to get latest custom categories
        await initializeConfig();
        
        // Reinitialize addon with updated genres
        initializeAddon();
        
        const metas = await getAllInfo();
        console.log(`${metas.length} channel(s) information cached successfully`);
    } catch (error) {
        console.error('Error caching channel information:', error);
    }
};

// Watch for changes in custom channels file
if (config.enableCustomChannels) {
    const fs = require('fs');
    const watchFile = () => {
        try {
            fs.watchFile(CUSTOM_CHANNELS_FILE, { interval: 5000 }, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    console.log('Custom channels file changed, reloading...');
                    cache.del('channelsInfo');
                    fetchAndCacheInfo();
                }
            });
            console.log('Watching custom channels file for changes');
        } catch (error) {
            console.log('Not watching custom channels file:', error.message);
        }
    };
    watchFile();
}

// Initial setup and start
(async () => {
    await initializeConfig();
    initializeAddon();
    await fetchAndCacheInfo();
    
    serveHTTP(addon.getInterface(), { server: app, port: PORT });
    
    console.log(`IPTV Addon server running on port ${PORT}`);
    console.log(`Custom channels: ${config.enableCustomChannels ? 'Enabled' : 'Disabled'}`);
    console.log(`Available genres: ${config.allGenres.length}`);
})();

// Schedule fetch based on FETCH_INTERVAL
setInterval(fetchAndCacheInfo, FETCH_INTERVAL);
