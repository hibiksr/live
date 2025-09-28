// Simple in-memory cache for serverless functions
const cache = new Map();

function get(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    
    return item.data;
}

function set(key, data, ttlMs = 3600000) {
    cache.set(key, {
        data: data,
        expiry: Date.now() + ttlMs
    });
}

function clear() {
    cache.clear();
}

module.exports = { get, set, clear };