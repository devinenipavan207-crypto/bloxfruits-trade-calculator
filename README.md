# Blox Fruits Values 🍇

A fast, modern, static website that lists every Blox Fruit with its current
trade value, demand level and trend — sourced from public Blox Fruits trading
sites and auto-updated on a schedule.

## Features

- 🖼️ Official fruit thumbnails (Roblox asset CDN)
- 🔍 Live search + category filter (Common → Mythical)
- ↕️ Sortable by value, name or trend
- 🌓 Dark / Light theme toggle
- ⏱️ "Last updated" badge that auto-refreshes
- 📱 Mobile-first responsive layout
- 🤖 Auto-update script that pulls current values from public sources
- 🔁 GitHub Actions workflow that runs the update every 6 hours

## Project structure

```
.
├── index.html               Main page
├── styles.css               All styles (dark + light themes)
├── script.js                Search / filter / sort / lazy-load
├── fruits-data.js           Fruit list (edit this or auto-update)
├── update-values.js         Node script that refreshes fruits-data.js
├── package.json
└── .github/workflows/
    └── update-values.yml    Runs update-values.js every 6 hours
```

## Run locally

```bash
npm install            # optional, only needed for the auto-updater
npm start              # serves the static site on http://localhost:3000
```

Or just open `index.html` in your browser.

## Update values manually

Edit `fruits-data.js`, change the `value` field for any fruit, then bump:

```js
const FRUITS_META = {
  LAST_UPDATED: "2026-06-02T12:00:00Z",  // ← update this
  ...
};
```

## Update values automatically

```bash
npm install
npm run update
```

This fetches the latest numbers from:

- https://blox-fruits.fandom.com
- https://bloxfruitsvalues.com
- https://fruitvalues.com
- https://elite-bloxfruits.com

…averages them, updates `fruits-data.js` and bumps the timestamp.

## Schedule automatic updates (GitHub Actions)

The included workflow `.github/workflows/update-values.yml` runs the update
script every 6 hours and commits the result.  Just push this repo to GitHub
and enable Actions.

## Add / change a fruit

1. Open `fruits-data.js`
2. Add an entry to the `FRUITS` array:

```js
{ name: "NewFruit", category: "rare", value: 3000, demand: "medium", trend: "up", perm: 3000, img: 1234567890 }
```

3. The `img` field is the Roblox asset ID. Find it from the official game
   catalog URL and paste the number.

## Disclaimer

This is a fan project. Not affiliated with Roblox Corporation, Gamer Robot Inc.,
or the developers of Blox Fruits. All trademarks belong to their respective
owners. Values are for reference only — always confirm in-game before trading.
