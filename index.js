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

// Configuration for channel filtering
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : ['GR'],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
    enableCustomChannels: process.env.ENABLE_CUSTOM_CHANNELS !== 'false',
    customCategories: [] // Will be populated dynamically
};

// Express app setup
const app = express();
app.use(express.json());

// Cache setup
const cache = new NodeCache({ stdTTL: 0 });

// Load custom channels from JSON file
const loadCustomChannels = async () => {
    if (!config.enableCustomChannels) {
        return { channels: [], streams: [], categories: [] };
    }

    try {
        const fileContent = await fs.readFile(CUSTOM_CHANNELS_FILE, 'utf8');
        const customData = JSON.parse(fileContent);
        
        // Extract unique custom categories
        const customCategories = new Set();
        
        // Validate and format custom channels
        const channels = (customData.channels || []).map(channel => {
            const channelCategories = channel.custom_categories || channel.categories || ['auto'];
            
            // Add custom categories to the set
            channelCategories.forEach(cat => {
                if (cat !== 'auto') {
                    customCategories.add(cat);
                }
            });
            
            return {
                id: channel.id || `custom.${Date.now()}.${Math.random()}`,
                name: channel.name || 'Unnamed Channel',
                alt_names: channel.alt_names || [],
                network: channel.network || null,
                owners: channel.owners || [],
                country: channel.country || 'AU',
                categories: channelCategories,
                custom_categories: channel.custom_categories || [],
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

        console.log(`Loaded ${channels.length} custom channels, ${streams.length} custom streams, and ${customCategories.size} custom categories`);
        return { 
            channels, 
            streams, 
            categories: Array.from(customCategories) 
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading custom channels:', error);
        }
        return { channels: [], streams: [], categories: [] };
    }
};

// Check if custom channels exist and update config
const initializeConfig = async () => {
    try {
        const customData = await loadCustomChannels();
        
        // Add AU to countries if custom channels exist
        if (customData.channels.length > 0 && !config.includeCountries.includes('AU')) {
            config.includeCountries.push('AU');
            console.log('Added AU to included countries for custom channels');
        }
        
        // Store custom categories in config
        config.customCategories = customData.categories;
        console.log(`Custom categories: ${config.customCategories.join(', ')}`);
        
        return customData;
    } catch (error) {
        console.log('Error initializing config:', error);
        return { channels: [], streams: [], categories: [] };
    }
};

// Get all available genre options (standard + custom)
const getAllGenreOptions = () => {
    const standardGenres = [
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
    
    // Combine and deduplicate
    return [...new Set([...standardGenres, ...config.customCategories])].sort();
};

// Addon Manifest - Dynamic based on config
const getManifest = () => {
    const genreOptions = getAllGenreOptions();
    
    return {
        id: 'org.iptv',
        name: 'IPTV Addon',
        version: '0.0.4',
        description: `Watch live TV from ${config.includeCountries.join(', ')}`,
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
                    options: genreOptions
                }
            ],
        })),
        idPrefixes: ['iptv-'],
        behaviorHints: { configurable: false, configurationRequired: false },
        logo: "https://dl.strem.io/addon-logo.png",
        icon: "https://dl.strem.io/addon-logo.png",
        background: "https://dl.strem.io/addon-background.jpg",
    };
};

let manifest = getManifest();
let addon = new addonBuilder(manifest);

// Helper Functions

// Convert channel to Stremio accepted Meta object
const toMeta = (channel) => {
    // Use custom_categories if available, otherwise fall back to categories
    const genres = channel.custom_categories && channel.custom_categories.length > 0 
        ? [...channel.custom_categories, channel.country]
        : [...(channel.categories || []), channel.country];
    
    return {
        id: `iptv-${channel.id}`,
        name: channel.name,
        type: 'tv',
        genres: genres.filter(Boolean),
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
        // Skip filtering for custom channels if they're from AU
        if (channel.isCustom && channel.country === 'AU') {
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

// Addon Handlers

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

// Server setup - Dynamic manifest
app.get('/manifest.json', async (req, res) => {
    // Reinitialize config to check for custom channels
    await initializeConfig();
    manifest = getManifest();
    addon = new addonBuilder(manifest);
    
    res.setHeader('Content-Type', 'application/json');
    res.json(manifest);
});

serveHTTP(addon.getInterface(), { server: app, path: '/manifest.json', port: PORT });

// Cache management
const fetchAndCacheInfo = async () => {
    try {
        // Clear the cache to force reload of custom channels
        cache.del('channelsInfo');
        
        // Reinitialize config to get latest custom categories
        await initializeConfig();
        
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

// Initial fetch
(async () => {
    await initializeConfig();
    await fetchAndCacheInfo();
})();

// Schedule fetch based on FETCH_INTERVAL
setInterval(fetchAndCacheInfo, FETCH_INTERVAL);

console.log(`IPTV Addon server running on port ${PORT}`);
console.log(`Custom channels: ${config.enableCustomChannels ? 'Enabled' : 'Disabled'}`);