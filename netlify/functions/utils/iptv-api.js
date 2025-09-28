const cache = require('./cache');

const API_BASE_URL = 'https://iptv-org.github.io/api';

async function fetchJSON(endpoint, cacheKey, cacheDuration = 6 * 60 * 60 * 1000) {
    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/${endpoint}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Cache the result
        cache.set(cacheKey, data, cacheDuration);
        
        return data;
    } catch (error) {
        console.error(`Error fetching ${endpoint}:`, error);
        throw error;
    }
}

async function getChannels() {
    return fetchJSON('channels.json', 'channels');
}

async function getStreams() {
    return fetchJSON('streams.json', 'streams');
}

async function getCategories() {
    const data = await fetchJSON('categories.json', 'categories');
    return data || [];
}

async function getCountries() {
    const data = await fetchJSON('countries.json', 'countries');
    return data || [];
}

async function getLanguages() {
    const data = await fetchJSON('languages.json', 'languages');
    return data || [];
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