# Stremio IPTV Addon

A Stremio addon that provides free IPTV channels organized by country and category.

## Features

- 🌍 Channels organized by country
- 📺 Categories like News, Sports, Movies, Music, Kids
- 🔍 Filter by genre within each country
- ⚡ Fast streaming with multiple quality options
- 🚫 NSFW content filtered by default
- 💾 6-hour caching for optimal performance

## Installation

### For Users

1. Open Stremio
2. Go to the Addons section
3. Click on "Community Addons"
4. Paste this URL: `https://your-app-name.netlify.app/manifest.json`
5. Click "Install"

### For Developers

1. Clone this repository
2. Install dependencies: `npm install`
3. Install Netlify CLI: `npm install -g netlify-cli`
4. Run locally: `netlify dev`
5. Deploy: `netlify deploy --prod`

## Deployment to Netlify

1. Fork this repository
2. Sign up for a free Netlify account
3. Connect your GitHub repository
4. Deploy with one click
5. Your addon URL will be: `https://your-site-name.netlify.app/manifest.json`

## How It Works

The addon organizes IPTV channels into:

- **Main Catalogs**: 
  - All Channels (Global)
  - Countries (US, UK, Canada, etc.)
  - Regions (Europe, Americas, Asia)
  - Categories (News, Sports, Music, etc.)

- **Filters**:
  - Genre filter for country catalogs
  - Country filter for category catalogs

## API Endpoints

- `/manifest.json` - Addon manifest
- `/catalog/tv/{catalogId}.json` - Browse channels
- `/stream/tv/{channelId}.json` - Get stream URLs

## License

MIT