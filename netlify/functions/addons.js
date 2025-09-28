const { getChannels, getStreams, getCountries, getCategories } = require('./utils/iptv-api');

const ADDON_BASE = process.env.URL || 'http://localhost:8888';
const CACHE_MAX_AGE = 6 * 60 * 60; // 6 hours

// Manifest defines the addon
const manifest = {
    id: 'org.stremio.iptv',
    version: '1.0.0',
    name: 'IPTV Channels',
    description: 'Watch free IPTV channels from around the world',
    resources: ['catalog', 'stream'],
    types: ['tv'],
    idPrefixes: ['iptv:'],
    catalogs: []  // Will be populated dynamically
};

// Helper to create response with CORS headers
function createResponse(data, statusCode = 200) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
        },
        body: JSON.stringify(data)
    };
}

// Parse Stremio addon path
function parseAddonPath(path) {
    const parts = path.split('/').filter(Boolean);
    
    // Remove .json extension if present
    if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart.endsWith('.json')) {
            parts[parts.length - 1] = lastPart.slice(0, -5);
        }
    }
    
    return {
        resource: parts[0],
        type: parts[1],
        id: parts[2],
        extra: parts.slice(3)
    };
}

// Build dynamic catalogs based on countries and categories
async function buildCatalogs() {
    const countries = await getCountries();
    const categories = await getCategories();
    
    const catalogs = [];
    
    // Create a catalog for each country with category filters
    const topCountries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'IN', 'BR'];
    
    // Global catalog with all channels
    catalogs.push({
        id: 'iptv-global',
        type: 'tv',
        name: '🌍 All Channels',
        extra: [
            {
                name: 'genre',
                options: categories.map(cat => cat.name),
                isRequired: false
            }
        ]
    });
    
    // Top countries catalogs
    for (const countryCode of topCountries) {
        const country = countries.find(c => c.code === countryCode);
        if (country) {
            catalogs.push({
                id: `iptv-country-${countryCode.toLowerCase()}`,
                type: 'tv',
                name: `${country.flag || '🏳️'} ${country.name}`,
                extra: [
                    {
                        name: 'genre',
                        options: categories.map(cat => cat.name),
                        isRequired: false
                    }
                ]
            });
        }
    }
    
    // Regional catalogs
    const regions = {
        'europe': { name: '🇪🇺 Europe', countries: ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'PL'] },
        'americas': { name: '🌎 Americas', countries: ['US', 'CA', 'MX', 'BR', 'AR'] },
        'asia': { name: '🌏 Asia', countries: ['IN', 'CN', 'JP', 'KR', 'TH'] }
    };
    
    for (const [regionId, region] of Object.entries(regions)) {
        catalogs.push({
            id: `iptv-region-${regionId}`,
            type: 'tv',
            name: region.name,
            extra: [
                {
                    name: 'genre',
                    options: categories.map(cat => cat.name),
                    isRequired: false
                }
            ]
        });
    }
    
    // Category-focused catalogs
    const popularCategories = ['news', 'sports', 'movies', 'music', 'kids', 'entertainment'];
    for (const catId of popularCategories) {
        const category = categories.find(c => c.id === catId);
        if (category) {
            catalogs.push({
                id: `iptv-category-${catId}`,
                type: 'tv',
                name: `📺 ${category.name}`,
                extra: [
                    {
                        name: 'country',
                        options: topCountries,
                        isRequired: false
                    }
                ]
            });
        }
    }
    
    return catalogs;
}

// Convert IPTV channel to Stremio meta object
function channelToMeta(channel, streams = []) {
    const channelStreams = streams.filter(s => s.channel === channel.id);
    const hasStreams = channelStreams.length > 0;
    
    // Create genre string
    const genres = channel.categories ? 
        channel.categories.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ') : 
        'General';
    
    // Create description
    const description = [
        channel.network ? `Network: ${channel.network}` : null,
        channel.country ? `Country: ${channel.country}` : null,
        channel.languages && channel.languages.length ? `Languages: ${channel.languages.join(', ')}` : null,
        hasStreams ? `${channelStreams.length} stream(s) available` : 'No streams available'
    ].filter(Boolean).join('\n');
    
    return {
        id: `iptv:${channel.id}`,
        type: 'tv',
        name: channel.name,
        poster: channel.logo || undefined,
        posterShape: 'square',
        background: channel.logo || undefined,
        logo: channel.logo || undefined,
        description: description,
        genres: genres ? [genres] : undefined,
        country: channel.country || undefined,
        language: channel.languages ? channel.languages[0] : undefined,
        website: channel.website || undefined,
        behaviorHints: {
            defaultVideoId: hasStreams ? `iptv:${channel.id}:0` : undefined
        }
    };
}

// Handle catalog requests
async function handleCatalog(type, id, extra = {}) {
    const channels = await getChannels();
    const streams = await getStreams();
    
    let filtered = channels;
    
    // Filter by catalog type
    if (id.startsWith('iptv-country-')) {
        const countryCode = id.replace('iptv-country-', '').toUpperCase();
        filtered = filtered.filter(ch => ch.country === countryCode);
    } else if (id.startsWith('iptv-region-')) {
        const regionId = id.replace('iptv-region-', '');
        const regions = {
            'europe': ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT', 'RO', 'GR'],
            'americas': ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE'],
            'asia': ['IN', 'CN', 'JP', 'KR', 'TH', 'ID', 'MY', 'PH']
        };
        const countries = regions[regionId] || [];
        filtered = filtered.filter(ch => countries.includes(ch.country));
    } else if (id.startsWith('iptv-category-')) {
        const categoryId = id.replace('iptv-category-', '');
        filtered = filtered.filter(ch => 
            ch.categories && ch.categories.includes(categoryId)
        );
    }
    
    // Apply extra filters
    if (extra.genre) {
        const genreLower = extra.genre.toLowerCase();
        filtered = filtered.filter(ch => 
            ch.categories && ch.categories.includes(genreLower)
        );
    }
    
    if (extra.country) {
        filtered = filtered.filter(ch => ch.country === extra.country);
    }
    
    // Filter out NSFW content by default
    filtered = filtered.filter(ch => !ch.is_nsfw);
    
    // Sort by name
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    // Limit results
    const limit = parseInt(extra.skip) || 0;
    const pageSize = 100;
    const paged = filtered.slice(limit, limit + pageSize);
    
    const metas = paged.map(channel => channelToMeta(channel, streams));
    
    return {
        metas: metas,
        cacheMaxAge: CACHE_MAX_AGE
    };
}

// Handle stream requests
async function handleStream(type, id) {
    // Parse the ID format: iptv:channelId:streamIndex
    const parts = id.split(':');
    if (parts[0] !== 'iptv' || !parts[1]) {
        return { streams: [] };
    }
    
    const channelId = parts[1];
    const streamIndex = parseInt(parts[2]) || 0;
    
    const allStreams = await getStreams();
    const channelStreams = allStreams.filter(s => s.channel === channelId);
    
    if (channelStreams.length === 0) {
        return { streams: [] };
    }
    
    // Convert to Stremio stream objects
    const stremioStreams = channelStreams.map((stream, index) => {
        const streamObj = {
            name: 'IPTV Stream',
            title: stream.title || `Stream ${index + 1}`,
            url: stream.url
        };
        
        // Add quality if available
        if (stream.quality) {
            streamObj.title += ` (${stream.quality})`;
        }
        
        // Add behavioral hints for better playback
        if (stream.user_agent || stream.referrer) {
            streamObj.behaviorHints = {};
            if (stream.user_agent) {
                streamObj.behaviorHints.userAgent = stream.user_agent;
            }
            if (stream.referrer) {
                streamObj.behaviorHints.referrer = stream.referrer;
            }
        }
        
        return streamObj;
    });
    
    return {
        streams: stremioStreams,
        cacheMaxAge: CACHE_MAX_AGE
    };
}

// Main handler
exports.handler = async (event, context) => {
    try {
        const path = event.path.replace('/.netlify/functions/addon', '');
        
        // Handle manifest request
        if (path === '/manifest.json' || path === '/manifest') {
            const catalogs = await buildCatalogs();
            const manifestWithCatalogs = { ...manifest, catalogs };
            return createResponse(manifestWithCatalogs);
        }
        
        // Parse addon request
        const { resource, type, id, extra } = parseAddonPath(path);
        
        // Parse extra parameters
        const extraParams = {};
        if (extra.length > 0) {
            const extraStr = extra.join('/');
            const pairs = extraStr.split('/');
            for (let i = 0; i < pairs.length; i += 2) {
                if (pairs[i] && pairs[i + 1]) {
                    extraParams[pairs[i]] = decodeURIComponent(pairs[i + 1]);
                }
            }
        }
        
        // Handle catalog requests
        if (resource === 'catalog' && type && id) {
            const result = await handleCatalog(type, id, extraParams);
            return createResponse(result);
        }
        
        // Handle stream requests
        if (resource === 'stream' && type && id) {
            const result = await handleStream(type, id);
            return createResponse(result);
        }
        
        // Invalid request
        return createResponse({ error: 'Invalid request' }, 400);
        
    } catch (error) {
        console.error('Addon error:', error);
        return createResponse({ error: 'Internal server error' }, 500);
    }
};