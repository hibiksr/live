// Simple cache implementation
const cache = new Map();

function getCached(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    
    return item.data;
}

function setCached(key, data, ttlMs = 3600000) {
    cache.set(key, {
        data: data,
        expiry: Date.now() + ttlMs
    });
}

const API_BASE_URL = 'https://iptv-org.github.io/api';

async function fetchJSON(endpoint, cacheKey, cacheDuration = 6 * 60 * 60 * 1000) {
    // Check cache first
    const cached = getCached(cacheKey);
    if (cached) {
        console.log(`Using cached data for ${cacheKey}`);
        return cached;
    }
    
    try {
        console.log(`Fetching ${endpoint}...`);
        const response = await fetch(`${API_BASE_URL}/${endpoint}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Cache the result
        setCached(cacheKey, data, cacheDuration);
        console.log(`Cached ${cacheKey} with ${Array.isArray(data) ? data.length : 0} items`);
        
        return data;
    } catch (error) {
        console.error(`Error fetching ${endpoint}:`, error);
        // Return empty array as fallback
        return [];
    }
}

async function getChannels() {
    return fetchJSON('channels.json', 'channels');
}

async function getStreams() {
    return fetchJSON('streams.json', 'streams');
}

async function getCategories() {
    return fetchJSON('categories.json', 'categories');
}

async function getCountries() {
    return fetchJSON('countries.json', 'countries');
}

async function getLanguages() {
    return fetchJSON('languages.json', 'languages');
}

async function getLogos() {
    return fetchJSON('logos.json', 'logos');
}

async function getBlocklist() {
    return fetchJSON('blocklist.json', 'blocklist');
}

module.exports = {
    getChannels,
    getStreams,
    getCategories,
    getCountries,
    getLanguages,
    getLogos,
    getBlocklist
};