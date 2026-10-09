# Cirrus — agent context / project memory

This file is a checked-in snapshot of the working context built up while developing this
app with an AI coding agent. If you're an agent picking up this repo in a new session (or
the user lost their chat history), **read this whole file first** — it explains what's
been built, why, and non-obvious details worth knowing before changing anything.

## What this is
- A personal movie tracker web app, built incrementally via live browser preview, one
  small feature/request at a time.
- Named "Cirrus". Header `h1.app__title` = "Cirrus", `p.app__subtitle` = "A high-altitude
  view of every film you watch.". `<title>` = Cirrus.
- Purpose: track a watchlist and watch history, rate movies yourself, and compare your
  rating against sourced ratings (TMDB/IMDb/Rotten Tomatoes/Metacritic) and a few written
  reviews — so years later you never have to wonder whether you've seen something, or what
  you thought of it.
- UI: a single page, no tabs. Movies are grouped into genre-category sections (from TMDB's
  `genres`, falling back to "Uncategorized" for manually added or un-hydrated movies).
  `status` (`watchlist`/`watched`) is tracked per-movie but doesn't split them into separate
  views — a watched movie stays in its genre section, just with a `.movie-card--watched`
  border/glow and a checkmark badge overlaid on the poster.
- Intent: a DYNAMIC, never-"final" tool that keeps evolving as the user uses it. Purely
  personal use, not a product.
- **Design Inspiration & Sister Apps:** Cumulus (personal finance) and Nimbus (to-do /
  agenda) share the same sky/cloud design language (drifting clouds, light/twilight/night
  themes, frosted glass cards, no-build vanilla HTML/CSS/JS stack). Cirrus follows the same
  conventions but renders its clouds as thin, wispy, high-altitude streaks (`.cloud__wisp`)
  instead of Cumulus's puffy lobes or Nimbus's storm clouds, to visually match its name.

## Where it lives
- This repo IS the app folder. Files: `index.html`, `styles.css`, `app.js`,
  `tutorial.html`, `tutorial.css`, plus `icon.svg` and `manifest.webmanifest`. Plain
  vanilla HTML/CSS/JS, no build step, no framework, no bundler.
- Runs by opening `index.html` directly (`file://`), or any static host. Data persists in
  the browser's localStorage — there is NO backend, NO server, NO build step.
- `build/` is a lagging deployment snapshot mirror of the shipped files, only updated at
  release time (see "Build/release process" below) — not every commit.

## Data model (localStorage keys)
- `cirrus.movies` — array of movie objects:
  `{id, tmdbId, title, year, poster, overview, status, personalRating, watchedDate, notes,
  imdbId, genres: [string], sourcedRatings: [{source, value}], reviews: [{author, content}],
  watchProviders, addedAt}`
  - `status` is `"watchlist"` or `"watched"` — affects only the watched-card highlight, not
    which genre section a movie appears in (see "UI" above).
  - `genres` is the movie's TMDB genre names; the card is filed under the first one (or
    "Uncategorized" if empty). Backfilled for pre-existing movies by `backfillTmdbDetails()`.
  - `personalRating` is 0–5 (stars).
  - `sourcedRatings` is populated from TMDB (`vote_average`) and, if an OMDb key is set,
    from OMDb's `Ratings` array (IMDb, Rotten Tomatoes, Metacritic).
  - `watchProviders` is `null` until hydrated, else
    `{region, link, flatrate: [{name, logo}], rent: [...], buy: [...]}` sourced from TMDB's
    `/movie/{id}/watch/providers` endpoint (JustWatch data) for the configured region. Stale
    (wrong-region or never-fetched) entries are backfilled in the background on boot, after
    import, and after a Settings region change — see `backfillWatchProviders()`.
- `cirrus.settings` — `{tmdbKey, omdbKey, region}`. `tmdbKey`/`omdbKey` optional; without a
  TMDB key, search, reviews, watch-provider availability, and auto-filled
  posters/overviews are unavailable, but manual add, personal ratings, notes, and watched
  tracking still work fully offline. `region` is a 2-letter country code (default `"US"`)
  used for the "where to watch" availability lookup.
- `cirrus.theme` — `"day"`, `"twilight"`, `"night"`, or `"random"` (same atmosphere scheme
  as Cumulus/Nimbus).

## External APIs (client-side only, CORS-enabled, no backend/proxy)
- **TMDB** (themoviedb.org) — search, movie details, reviews, and
  watch providers (`/movie/{id}/watch/providers`, JustWatch-sourced streaming/rent/buy
  availability by region). Free API key, user-supplied via Settings, never committed to
  the repo.
- **OMDb** (omdbapi.com) — optional, supplies IMDb/Rotten Tomatoes/Metacritic ratings via
  the movie's `imdb_id` (fetched from TMDB movie details). Free API key, user-supplied.
- Never hardcode a real API key in source — these are entered by the user and stored only
  in their browser's localStorage.

## Build/release process
Same flow as Cumulus/Nimbus:
1. Confirm on `develop`.
2. Bump the static asset version (`?v=` query strings in `index.html`/`tutorial.html` +
   the about-modal "Version …" text), format `YYYY.MM.DD.N` — bump `N` or start a new date.
3. Sync the `build/` mirror:
   `cp app.js index.html styles.css tutorial.html tutorial.css manifest.webmanifest build/`
4. Commit as `Release Cirrus <version>`, push `develop`.
5. Merge into `main` with a regular merge
   (`git merge develop -m "Merge develop for Cirrus <version>"`), push `main`.
6. Switch local checkout back to `develop`.

## Conventions carried over from Cumulus/Nimbus
- Modal toggling: `.modal` (hidden) / `.modal.open` (shown), closed on backdrop click.
- Theme script in `<head>` sets `html.dark`/`html.night`/`html.twilight` synchronously
  before first paint to avoid a flash of the wrong theme.
- `#app-version` header badge is mirrored from `.about-modal__version` text via a small JS
  snippet at the bottom of `app.js`, so the version is only ever typed in one place.
