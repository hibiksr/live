// IMPORTANT: For Netlify, we need to handle all routes in a single function
const { getChannels, getStreams, getCountries, getCategories } = require('./utils/iptv-api');

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

// Build dynamic catalogs based on countries and categories
async function buildCatalogs() {
    try {
        const countries = await getCountries();
        const categories = await getCategories();
        
        const catalogs = [];
        
        // Global catalog with all channels
        catalogs.push({
            id: 'iptv-global',
            type: 'tv',
            name: '🌍 All Channels',
            extra: [
                {
                    name: 'genre',
                    options: ['news', 'sports', 'movies', 'music', 'kids', 'entertainment'],
                    isRequired: false
                }
            ]
        });
        
        // Top countries catalogs
        const topCountries = [
            { code: 'US', name: 'United States', flag: '🇺🇸' },
            { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
            { code: 'CA', name: 'Canada', flag: '🇨🇦' },
            { code: 'AU', name: 'Australia', flag: '🇦🇺' },
            { code: 'DE', name: 'Germany', flag: '🇩🇪' },
            { code: 'FR', name: 'France', flag: '🇫🇷' },
            { code: 'IT', name: 'Italy', flag: '🇮🇹' },
            { code: 'ES', name: 'Spain', flag: '🇪🇸' },
            { code: 'IN', name: 'India', flag: '🇮🇳' },
            { code: 'BR', name: 'Brazil', flag: '🇧🇷' }
        ];
        
        for (const country of topCountries) {
            catalogs.push({
                id: `iptv-country-${country.code.toLowerCase()}`,
                type: 'tv',
                name: `${country.flag} ${country.name}`,
                extra: [
                    {
                        name: 'genre',
                        options: ['news', 'sports', 'movies', 'music', 'kids', 'entertainment'],
                        isRequired: false
                    }
                ]
            });
        }
        
        // Category-focused catalogs
        const popularCategories = [
            { id: 'news', name: 'News', icon: '📰' },
            { id: 'sports', name: 'Sports', icon: '⚽' },
            { id: 'movies', name: 'Movies', icon: '🎬' },
            { id: 'music', name: 'Music', icon: '🎵' },
            { id: 'kids', name: 'Kids', icon: '👶' },
            { id: 'entertainment', name: 'Entertainment', icon: '🎭' }
        ];
        
        for (const category of popularCategories) {
            catalogs.push({
                id: `iptv-category-${category.id}`,
                type: 'tv',
                name: `${category.icon} ${category.name}`,
                extra: []
            });
        }
        
        return catalogs;
    } catch (error) {
        console.error('Error building catalogs:', error);
        // Return basic catalog if API fails
        return [{
            id: 'iptv-global',
            type: 'tv',
            name: '🌍 All Channels',
            extra: []
        }];
    }
}

// Convert IPTV channel to Stremio meta object
function channelToMeta(channel, streams = []) {
    const channelStreams = streams.filter(s => s.channel === channel.id);
    const hasStreams = channelStreams.length > 0;
    
    const genres = channel.categories ? 
        channel.categories.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ') : 
        'General';
    
    const description = [
        channel.network ? `Network: ${channel.network}` : null,
        channel.country ? `Country: ${channel.country}` : null,
        channel.languages && channel.languages.length ? `Languages: ${channel.languages.join(', ')}` : null,
        hasStreams ? `${channelStreams.length} stream(s) available` : 'No streams available'
    ].filter(Boolean).join('\n');
    
    return {
        id: `iptv:${channel.id}`,
        type: 'tv',
        name: channel.name || 'Unknown Channel',
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
    
    let filtered = channels || [];
    
    // Filter by catalog type
    if (id.startsWith('iptv-country-')) {
        const countryCode = id.replace('iptv-country-', '').toUpperCase();
        filtered = filtered.filter(ch => ch.country === countryCode);
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
    const parts = id.split(':');
    if (parts[0] !== 'iptv' || !parts[1]) {
        return { streams: [] };
    }
    
    const channelId = parts[1];
    
    const allStreams = await getStreams();
    const channelStreams = allStreams.filter(s => s.channel === channelId);
    
    if (channelStreams.length === 0) {
        return { streams: [] };
    }
    
    const stremioStreams = channelStreams.map((stream, index) => {
        const streamObj = {
            name: 'IPTV Stream',
            title: stream.title || `Stream ${index + 1}`,
            url: stream.url
        };
        
        if (stream.quality) {
            streamObj.title += ` (${stream.quality})`;
        }
        
        return streamObj;
    });
    
    return {
        streams: stremioStreams,
        cacheMaxAge: CACHE_MAX_AGE
    };
}

// Main handler for Netlify Functions
exports.handler = async (event, context) => {
    // Set CORS headers for all responses
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // Handle OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }
    
    try {
        // Get the path after /addon
        let path = event.path.replace('/.netlify/functions/addon', '');
        
        // Remove leading slash if present
        if (path.startsWith('/')) {
            path = path.substring(1);
        }
        
        console.log('Processing path:', path);
        
        // Handle manifest request
        if (!path || path === 'manifest.json' || path === 'manifest') {
            const catalogs = await buildCatalogs();
            const manifestWithCatalogs = { ...manifest, catalogs };
            
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
                },
                body: JSON.stringify(manifestWithCatalogs)
            };
        }
        
        // Parse Stremio addon path
        const parts = path.split('/').filter(Boolean);
        
        // Remove .json extension if present
        if (parts.length > 0 && parts[parts.length - 1].endsWith('.json')) {
            parts[parts.length - 1] = parts[parts.length - 1].slice(0, -5);
        }
        
        const resource = parts[0];
        const type = parts[1];
        const id = parts[2];
        
        // Parse extra parameters
        const extraParams = {};
        if (parts.length > 3) {
            for (let i = 3; i < parts.length; i += 2) {
                if (parts[i] && parts[i + 1]) {
                    extraParams[parts[i]] = decodeURIComponent(parts[i + 1]);
                }
            }
        }
        
        console.log('Parsed request:', { resource, type, id, extraParams });
        
        // Handle catalog requests
        if (resource === 'catalog' && type && id) {
            const result = await handleCatalog(type, id, extraParams);
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
                },
                body: JSON.stringify(result)
            };
        }
        
        // Handle stream requests
        if (resource === 'stream' && type && id) {
            const result = await handleStream(type, id);
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
                },
                body: JSON.stringify(result)
            };
        }
        
        // Invalid request
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid request', path, resource, type, id })
        };
        
    } catch (error) {
        console.error('Addon error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error', message: error.message })
        };
    }
};