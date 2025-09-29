const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const NodeCache = require('node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Constants
const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const PROXY_URL = process.env.PROXY_URL || '';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 10000;

// Configuration for channel filtering
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : ['GR'],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
};

// Cache setup - Note: This cache will be per function invocation in serverless
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

// Addon Manifest
const manifest = {
    id: 'org.iptv',
    name: 'IPTV Addon',
    version: '0.0.2',
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
                options: [
                    "animation", "business", "classic", "comedy", "cooking",
                    "culture", "documentary", "education", "entertainment",
                    "family", "kids", "legislative", "lifestyle", "movies",
                    "music", "general", "religious", "news", "outdoor",
                    "relax", "series", "science", "shop", "sports",
                    "travel", "weather", "xxx", "auto"
                ]
            }
        ],
    })),
    idPrefixes: ['iptv-'],
    behaviorHints: { configurable: false, configurationRequired: false },
    logo: "https://dl.strem.io/addon-logo.png",
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
};

// Helper Functions
const toMeta = (channel) => ({
    id: `iptv-${channel.id}`,
    name: channel.name,
    type: 'tv',
    genres: [...(channel.categories || []), channel.country].filter(Boolean),
    poster: channel.logo,
    posterShape: 'square',
    background: channel.logo || null,
    logo: channel.logo || null,
});

const getChannels = async () => {
    try {
        const channelsResponse = await axios.get(IPTV_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
        return channelsResponse.data;
    } catch (error) {
        console.error('Error fetching channels:', error);
        return null;
    }
};

const getStreamInfo = async () => {
    try {
        const streamsResponse = await axios.get(IPTV_STREAMS_URL, { timeout: FETCH_TIMEOUT });
        return streamsResponse.data;
    } catch (error) {
        console.error('Error fetching streams:', error);
        return [];
    }
};

const verifyStreamURL = async (url, userAgent, httpReferrer) => {
    const effectiveUserAgent = userAgent || 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 DMOST/2.0.0 (; LGE; webOSTV; WEBOS6.3.2 03.34.95; W6_lm21a;)';
    const effectiveReferer = httpReferrer || '';

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
        return response.status === 200;
    } catch (error) {
        console.log(`Stream URL verification failed for ${url}:`, error.message);
        return false;
    }
};

const getAllInfo = async () => {
    const [streams, channels] = await Promise.all([getStreamInfo(), getChannels()]);

    if (!channels) {
        return [];
    }

    const streamMap = new Map(streams.map(stream => [stream.channel, stream]));

    const filteredChannels = channels.filter((channel) => {
        if (config.includeCountries.length > 0 && !config.includeCountries.includes(channel.country)) return false;
        if (config.excludeCountries.length > 0 && config.excludeCountries.includes(channel.country)) return false;
        if (config.includeLanguages.length > 0 && !channel.languages.some(lang => config.includeLanguages.includes(lang))) return false;
        if (config.excludeLanguages.length > 0 && channel.languages.some(lang => config.excludeLanguages.includes(lang))) return false;
        if (config.excludeCategories.some(cat => channel.categories.includes(cat))) return false;
        return streamMap.has(channel.id);
    });

    // Note: Stream verification removed for serverless due to timeout constraints
    // You may want to implement this as a separate background job
    const channelsWithDetails = filteredChannels.map((channel) => {
        const streamInfo = streamMap.get(channel.id);
        if (streamInfo) {
            const meta = toMeta(channel);
            meta.streamInfo = {
                url: streamInfo.url,
                title: 'Live Stream',
                httpReferrer: streamInfo.http_referrer
            };
            return meta;
        }
        return null;
    }).filter(Boolean);

    return channelsWithDetails;
};

// Create addon
const addon = new addonBuilder(manifest);

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
            return { streams: [channel.streamInfo] };
        }
    }
    return { streams: [] };
});

module.exports = { addon, manifest };