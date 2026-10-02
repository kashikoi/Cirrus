# Cirrus

**A high-altitude view of every film you watch.**

Cirrus is a local-first personal movie tracker for building a watchlist, logging what you've watched, and rating films yourself. It is a plain HTML, CSS, and JavaScript app with no build step and no backend.

## Run it

Open [index.html](index.html) directly in a modern browser:

```sh
open index.html
```

The app can also be hosted as static files, but opening it through `file://` is the intended personal-use workflow.

## What it does

- Tracks a **Watchlist** and a **Watched** history, with the date you watched each movie.
- Lets you rate movies yourself (1–5 stars) and jot down personal notes.
- Shows sourced ratings — TMDB, and optionally IMDb, Rotten Tomatoes, and Metacritic via OMDb — alongside your own, so you can see how your taste compares.
- Pulls in a few written reviews per movie.
- Surfaces what's currently in theaters in the **Discover** tab.
- Works fully offline for manual tracking; search, auto-filled posters, reviews, and Discover need a free TMDB API key (and optionally a free OMDb key), entered once in Settings.
- Includes light/twilight/night themes, a built-in tutorial, and JSON export/import for backups.

## Data and privacy

Cirrus stores its data only in the browser's `localStorage`; it does not send your data to a server. Export a JSON backup regularly from **Settings** before clearing browser storage or switching environments.

Movie search, posters, reviews, and new-release listings are requested directly from the public TMDB API (and optionally OMDb for additional ratings) using an API key you provide — these keys are stored only in your browser.

## Project structure

- [index.html](index.html): the main app UI.
- [app.js](app.js): movie tracking, ratings, TMDB/OMDb integration, and persistence.
- [styles.css](styles.css): application styling and themes.
- [tutorial.html](tutorial.html) and [tutorial.css](tutorial.css): standalone in-app tutorial.
- [manifest.webmanifest](manifest.webmanifest) and [icon.svg](icon.svg): installable-app metadata and icon.
