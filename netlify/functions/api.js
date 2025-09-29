const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors'); // <-- ADD THIS LINE
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const NodeCache = require('node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Constants
const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 10000;
const PROXY_URL = process.env.PROXY_URL || '';

// Configuration for channel filtering.
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : ['GR'],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
};

// Cache setup
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

// Manifest
const manifest = {
    id: 'org.iptv.netlify',
    name: 'IPTV Addon (Netlify)',
    version: '0.0.5', // Incremented version
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
                "options": [
                    "animation", "business", "classic", "comedy", "cooking", "culture", "documentary",
                    "education", "entertainment", "family", "kids", "legislative", "lifestyle",
                    "movies", "music", "general", "religious", "news", "outdoor", "relax", "series",
                    "science", "shop", "sports", "travel", "weather", "xxx", "auto"
                ]
            }
        ],
    })),
    idPrefixes: ['iptv-'],
    logo: "https://dl.strem.io/addon-logo.png",
    // --- ADDED MISSING PROPERTIES ---
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

const addon = new addonBuilder(manifest);

// --- ALL YOUR HELPER FUNCTIONS (toMeta, getChannels, getStreamInfo, etc.) GO HERE ---
// --- Paste them unchanged from your original file ---
const toMeta = (channel) => ({
    id: `iptv-${channel.id}`, name: channel.name, type: 'tv',
    genres: [...(channel.categories || []), channel.country].filter(Boolean),
    poster: channel.logo, posterShape: 'square', background: channel.logo || null, logo: channel.logo || null,
});
const getChannels = async () => { /* ...your function code... */ };
const getStreamInfo = async () => { /* ...your function code... */ };
const verifyStreamURL = async (url, userAgent, httpReferrer) => { /* ...your function code... */ };
const getAllInfo = async () => { /* ...your function code... */ };


// Addon Handlers
addon.defineCatalogHandler(async (args) => {
    const { type, id, extra } = args;
    if (type === 'tv' && id.startsWith('iptv-channels-')) {
        const country = id.split('-')[2];
        const allChannels = await getAllInfo();
        let filteredChannels = allChannels.filter(channel => channel.genres.includes(country));
        if (extra && extra.genre) {
            const genres = Array.isArray(extra.genre) ? extra.genre : [extra.genre];
            filteredChannels = filteredChannels.filter(channel => genres.some(genre => channel.genres.includes(genre)));
        }
        console.log(`Serving catalog for ${country} with ${filteredChannels.length} channels`);
        return { metas: filteredChannels };
    }
    return { metas: [] };
});

addon.defineMetaHandler(async (args) => {
    const { type, id } = args;
    if (type === 'tv' && id.startsWith('iptv-')) {
        const channels = await getAllInfo();
        const channel = channels.find((meta) => meta.id === id);
        if (channel) { return { meta: channel }; }
    }
    return { meta: {} };
});

addon.defineStreamHandler(async (args) => {
    const { type, id } = args;
    if (type === 'tv' && id.startsWith('iptv-')) {
        const channels = await getAllInfo();
        const channel = channels.find((meta) => meta.id === id);
        if (channel?.streamInfo) {
            console.log("Serving stream id: ", channel.id);
            return { streams: [channel.streamInfo] };
        } else {
            console.log('No matching stream found for channelID:', id);
        }
    }
    return { streams: [] };
});


// ---- SERVERLESS HANDLER ----
const app = express();

// --- ENABLE CORS ---
app.use(cors());

const addonInterface = addon.getInterface();

// Manually create routes
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(addonInterface.manifest);
    res.end();
});

// All other routes are handled by the addon interface handlers
// All other routes are handled by the addon interface handlers
app.get('/:resource/:type/:id/:extra?.json', async (req, res) => {
    const { resource, type, id } = req.params;

    const handler = addonInterface[resource];
    if (!handler) {
        console.log(`No handler for resource: ${resource}`);
        return res.status(404).send('Not Found');
    }

    // Correctly parse the 'extra' parameter string (e.g., "genre=Sports")
    const extra = req.params.extra ?
        req.params.extra.split('&').reduce((acc, pair) => {
            const [key, value] = pair.split('=').map(decodeURIComponent);
            if (acc[key]) {
                acc[key] = Array.isArray(acc[key]) ? [...acc[key], value] : [acc[key], value];
            } else {
                acc[key] = value;
            }
            return acc;
        }, {}) : {};

    try {
        const result = await handler({ type, id, extra });
        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (err) {
        console.error(`Error in handler for resource: ${resource}`, err);
        res.status(500).send('Internal Server Error');
    }
});

module.exports.handler = serverless(app);