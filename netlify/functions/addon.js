const { addon } = require('./_shared/addon-logic');
const { getRouter } = require('stremio-addon-sdk');
const landingTemplate = require('stremio-addon-sdk/src/landingTemplate');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: '',
        };
    }

    const path = event.path.replace('/.netlify/functions/addon', '') || '/';
    
    // Landing page
    if (path === '/' || path === '') {
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'text/html',
            },
            body: landingTemplate(addon.getInterface()),
        };
    }

    // Handle Stremio addon routes
    const router = getRouter(addon.getInterface());
    const matches = router.match(path);

    if (matches) {
        try {
            const result = await matches.handler(matches.params);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(result),
            };
        } catch (error) {
            console.error('Error handling request:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: error.message }),
            };
        }
    }

    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Not found' }),
    };
};