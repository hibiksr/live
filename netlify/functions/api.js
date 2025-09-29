const express = require('express');
const serverless = require('serverless-http');
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
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // Cache items for 5 minutes

// Manifest
const manifest = {
    id: 'org.iptv.netlify',
    name: 'IPTV Addon (Netlify)',
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
const addonInterface = addon.getInterface();

// Manually create routes
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(addonInterface.manifest);
    res.end();
});

// All other routes are handled by the addon interface handlers
app.get('/:resource/:type/:id/:extra?.json', (req, res) => {
    const { resource, type, id } = req.params;
    const extra = req.params.extra ? JSON.parse(req.params.extra) : {};

    if (!addonInterface[resource]) {
        return res.status(404).send('Not Found');
    }

    addonInterface[resource]({ type, id, extra })
        .then(result => {
            res.setHeader('Content-Type', 'application/json');
            res.send(result);
            res.end();
        })
        .catch(err => {
            console.error(err);
            res.status(500).send('Internal Server Error');
        });
});

module.exports.handler = serverless(app);