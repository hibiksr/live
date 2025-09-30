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
const REMOTE_CHANNELS_URL = 'https://raw.githubusercontent.com/eliasghemas/masafap/main/meonos.tvvoo.json'; // Link do TVVOO
const PORT = process.env.PORT || 3000;
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL) || 86400000;
const PROXY_URL = process.env.PROXY_URL || '';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 10000;

// Standard genre list
const STANDARD_GENRES = [
    "animation", "auto", "business", "classic", "comedy", "cooking", "culture",
    "documentary", "education", "entertainment", "family", "kids", "legislative",
    "lifestyle", "movies", "music", "general", "religious", "news", "outdoor",
    "relax", "series", "science", "shop", "sport", "travel", "weather", "xxx" // Corrigido "sports" para "sport"
];

// Configuration for channel filtering
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : [],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
    enableCustomChannels: process.env.ENABLE_CUSTOM_CHANNELS !== 'false',
    allGenres: [...STANDARD_GENRES]
};

const app = express();
app.use(express.json());
const cache = new NodeCache({ stdTTL: 0 });

// ########## INÍCIO DA SECÇÃO MODIFICADA ##########

// Fetches and transforms the remote channel list (from TVVOO)
const fetchAndTransformRemoteChannels = async () => {
    try {
        console.log(`Fetching remote channel list from: ${REMOTE_CHANNELS_URL}`);
        const response = await axios.get(REMOTE_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
        const remoteData = response.data;

        if (!Array.isArray(remoteData)) {
            console.error('Remote data is not an array.');
            return { channels: [], streams: [] };
        }

        const channels = [];
        const streams = [];

        remoteData.forEach(item => {
            const channelId = `remote.pt.${item.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
            
            channels.push({
                id: channelId,
                name: item.name,
                alt_names: [],
                country: 'PT',
                categories: item.category ? [item.category.toLowerCase()] : ['general'],
                is_nsfw: false,
                launched: null,
                website: "",
                logo: item.logo,
                isCustom: true
            });

            streams.push({
                channel: channelId,
                title: `${item.name} - Live`,
                url: item.url,
                isCustom: true
            });
        });

        console.log(`Successfully transformed ${channels.length} remote channels.`);
        return { channels, streams };
    } catch (error) {
        console.error('Error fetching or transforming remote channels:', error.message);
        return { channels: [], streams: [] };
    }
};


// Load custom channels from JSON file and remote URL
const loadCustomChannels = async () => {
    if (!config.enableCustomChannels) {
        return { channels: [], streams: [], customGenres: [] };
    }

    let localChannels = [];
    let localStreams = [];
    
    // 1. Load local channels from custom-channels.json
    try {
        const fileContent = await fs.readFile(CUSTOM_CHANNELS_FILE, 'utf8');
        const customData = JSON.parse(fileContent);
        localChannels = customData.channels || [];
        localStreams = customData.streams || [];
        console.log(`Loaded ${localChannels.length} local custom channels.`);
    } catch (error) {
        if (error.code !== 'ENOENT') { // ENOENT means file not found, which is fine
            console.error('Error loading local custom channels file:', error);
        } else {
            console.log('No local custom-channels.json file found. Skipping.');
        }
    }

    // 2. Fetch and transform remote channels
    const remoteData = await fetchAndTransformRemoteChannels();

    // 3. Combine local and remote channels
    const allCustomChannels = [...localChannels, ...remoteData.channels];
    const allCustomStreams = [...localStreams, ...remoteData.streams];
    
    // Extract unique custom categories from all combined channels
    const customGenresSet = new Set();
    allCustomChannels.forEach(channel => {
        (channel.categories || []).forEach(cat => {
            if (!STANDARD_GENRES.includes(cat.toLowerCase())) {
                customGenresSet.add(cat);
            }
        });
    });

    const customGenres = Array.from(customGenresSet);
    console.log(`Total custom channels loaded: ${allCustomChannels.length}`);
    if (customGenres.length > 0) {
        console.log(`Custom genres found: ${customGenres.join(', ')}`);
    }
    
    return { 
        channels: allCustomChannels, 
        streams: allCustomStreams, 
        customGenres 
    };
};

// ########## FIM DA SECÇÃO MODIFICADA ##########


// The rest of the file remains the same, with minor adjustments for clarity
// ... (The following code is mostly unchanged from your original file, I've just included it for completeness)

const initializeConfig = async () => {
    try {
        const customData = await loadCustomChannels();
        
        if (customData.channels.length > 0 && !config.includeCountries.includes('PT')) {
            config.includeCountries.push('PT');
            console.log('Added PT to included countries for custom channels');
        }
        
        const allGenresSet = new Set([...STANDARD_GENRES, ...customData.customGenres]);
        config.allGenres = Array.from(allGenresSet).sort();
        
        console.log(`Total genres available: ${config.allGenres.length}`);
        
        return customData;
    } catch (error) {
        console.log('Error initializing config:', error);
        return { channels: [], streams: [], customGenres: [] };
    }
};

const getManifest = () => {
    return {
        id: 'org.iptv.pt.personal',
        name: 'Meus Canais PT',
        version: '1.0.1',
        description: 'Canais de TV de Portugal - Personalizado',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        catalogs: config.includeCountries.map(country => ({
            type: 'tv',
            id: `iptv-channels-${country}`,
            name: `IPTV - ${country}`,
            extra: [{ name: 'genre', isRequired: false, options: config.allGenres }],
        })),
        idPrefixes: ['iptv-'],
        behaviorHints: { configurable: false, configurationRequired: false },
        logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/portugal/rtp-1-pt.png",
        background: "https://dl.strem.io/addon-background.jpg",
    };
};

let manifest;
let addon;

const toMeta = (channel) => {
    const genres = [...(channel.categories || []), channel.country].filter(Boolean).map(g => g.toLowerCase());
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

const getChannels = async () => {
    console.log("Downloading public channels");
    try {
        const channelsResponse = await axios.get(IPTV_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
        console.log("Finished downloading public channels");
        return channelsResponse.data;
    } catch (error) {
        console.error('Error fetching public channels:', error.message);
        return cache.get('channels') || null;
    }
};

const getStreamInfo = async () => {
    if (!cache.has('streams')) {
        console.log("Downloading public streams data");
        try {
            const streamsResponse = await axios.get(IPTV_STREAMS_URL, { timeout: FETCH_TIMEOUT });
            cache.set('streams', streamsResponse.data);
        } catch (error) {
            console.error('Error fetching public streams:', error.message);
            return [];
        }
    }
    return cache.get('streams');
};

const getAllInfo = async () => {
    if (cache.has('channelsInfo')) {
        return cache.get('channelsInfo');
    }

    const apiStreams = await getStreamInfo();
    const apiChannels = await getChannels();
    const customData = await loadCustomChannels();

    const allChannels = [...(apiChannels || []), ...customData.channels];
    const allStreams = [...apiStreams, ...customData.streams];

    if (!allChannels.length) {
        console.log('No channels available');
        return [];
    }

    const streamMap = new Map();
    allStreams.forEach(stream => {
        if (!streamMap.has(stream.channel)) {
            streamMap.set(stream.channel, []);
        }
        streamMap.get(stream.channel).push(stream);
    });

    const filteredChannels = allChannels.filter((channel) => {
        if (!streamMap.has(channel.id)) return false;

        const countryMatch = config.includeCountries.length === 0 || config.includeCountries.includes(channel.country);
        const countryExclude = config.excludeCountries.length > 0 && config.excludeCountries.includes(channel.country);
        
        return countryMatch && !countryExclude;
    });

    const channelsWithDetails = filteredChannels.map(channel => {
        const streamInfos = streamMap.get(channel.id) || [];
        const meta = toMeta(channel);
        meta.streams = streamInfos.map(streamInfo => ({
            url: streamInfo.url,
            title: streamInfo.title || `${channel.name} - Live`,
            httpReferrer: streamInfo.referrer || null,
            userAgent: streamInfo.user_agent || null
        }));
        return meta;
    });

    const finalChannels = channelsWithDetails.filter(c => c.streams.length > 0);
    console.log(`Total channels processed: ${finalChannels.length} (API: ${finalChannels.filter(c => !c.isCustom).length}, Custom: ${finalChannels.filter(c => c.isCustom).length})`);
    cache.set('channelsInfo', finalChannels);
    return finalChannels;
};


const initializeAddon = () => {
    manifest = getManifest();
    addon = new addonBuilder(manifest);

    addon.defineCatalogHandler(async ({ type, id, extra }) => {
        if (type !== 'tv') return { metas: [] };

        const country = id.split('-')[2];
        const allChannels = await getAllInfo();
        let metas = allChannels.filter(channel => channel.genres.includes(country.toLowerCase()));

        if (extra && extra.genre) {
            metas = metas.filter(meta => meta.genres.includes(extra.genre.toLowerCase()));
        }

        console.log(`Serving catalog for ${country} with ${metas.length} channels${extra?.genre ? ` (genre: ${extra.genre})` : ''}`);
        return { metas };
    });

    addon.defineMetaHandler(async ({ type, id }) => {
        if (type !== 'tv' || !id.startsWith('iptv-')) return { meta: null };
        const channels = await getAllInfo();
        const meta = channels.find((m) => m.id === id);
        return { meta: meta || null };
    });

    addon.defineStreamHandler(async ({ type, id }) => {
        if (type !== 'tv' || !id.startsWith('iptv-')) return { streams: [] };
        const channels = await getAllInfo();
        const channel = channels.find((m) => m.id === id);
        if (channel && channel.streams) {
            console.log(`Serving ${channel.streams.length} stream(s) for id: ${channel.id}${channel.isCustom ? ' [CUSTOM]' : ''}`);
            return { streams: channel.streams };
        }
        return { streams: [] };
    });
};

const fetchAndCacheInfo = async () => {
    try {
        cache.del('channelsInfo');
        await initializeConfig();
        initializeAddon();
        const metas = await getAllInfo();
        console.log(`${metas.length} channel(s) information cached successfully`);
    } catch (error) {
        console.error('Error caching channel information:', error);
    }
};

(async () => {
    await initializeConfig();
    initializeAddon();
    await fetchAndCacheInfo();
    
    serveHTTP(addon.getInterface(), { server: app, port: PORT });
    
    console.log(`IPTV Addon server running on port ${PORT}`);
    console.log(`Custom channels: ${config.enableCustomChannels ? 'Enabled' : 'Disabled'}`);
    console.log(`Available genres: ${config.allGenres.length}`);
    
    setInterval(fetchAndCacheInfo, FETCH_INTERVAL);
})();
