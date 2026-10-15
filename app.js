// ---- Storage keys ----
const THEME_KEY = "cirrus.theme";
const MOVIES_KEY = "cirrus.movies";
const SETTINGS_KEY = "cirrus.settings";
const VIEW_KEY = "cirrus.view";

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TMDB_LOGO = "https://image.tmdb.org/t/p/w45";

// ---- Cloud sync (shared across all Kashikoi "cloud" apps via one unified encrypted blob) ----
const CLOUD_SYNC_ENDPOINT = "https://nimbus-sync.nimbus-sync.workers.dev";
const CLOUD_SYNC_FORMAT = "kashikoi-encrypted-backup-v1";
const LEGACY_CLOUD_SYNC_FORMAT = "nimbus-encrypted-backup-v1";
const UNIFIED_BACKUP_SCHEMA = "kashikoi-app-backup-v1";
const REMEMBER_CLOUD_PHRASE_KEY = "cirrus.cloudPhrase";
const CLOUD_KDF_ITERATIONS = 600000;
// The shared sync Worker only accepts envelopes tagged "Nimbus"/"Cumulus"; since every app
// reads/writes the same blob, Cirrus tags it "Nimbus" so the PUT validates and the other apps
// can still decrypt it. The honest author is recorded separately in `writtenBy`.
const CLOUD_ENVELOPE_APP = "Nimbus";
const ACCEPTED_ENVELOPE_APPS = new Set(["Nimbus", "Cumulus", "Cirrus", "Stratus"]);
const RECOVERY_PHRASE_WORD_COUNT = 16;
const RECOVERY_WORDS = [
  "anchor", "apricot", "arbor", "atlas", "autumn", "baker", "bamboo", "beacon", "birch", "breeze", "brook", "cabin", "cactus", "canvas", "cedar", "cinder",
  "clover", "cobalt", "comet", "copper", "coral", "cotton", "cricket", "daisy", "delta", "denim", "dolphin", "dragon", "ember", "falcon", "fennel", "field",
  "forest", "fossil", "garden", "ginger", "glacier", "harbor", "hazel", "honest", "indigo", "island", "jacket", "jasper", "juniper", "kernel", "lagoon", "lantern",
  "laurel", "lemon", "linen", "lotus", "maple", "marble", "meadow", "meteor", "misty", "nectar", "nickel", "oasis", "olive", "onward", "orchid", "otter",
  "palace", "paper", "pepper", "plume", "pocket", "prairie", "quartz", "quiet", "rabbit", "raven", "river", "rocket", "saffron", "sailor", "shadow", "silver",
  "sincere", "sketch", "spring", "stone", "sunset", "tandem", "timber", "topaz", "tulip", "velvet", "violet", "walnut", "willow", "window", "winter", "zephyr",
  "acorn", "almond", "amber", "artist", "basket", "blossom", "border", "bottle", "branch", "bridge", "butter", "castle", "cherry", "circle", "coffee", "compass",
  "dancer", "desert", "doctor", "engine", "fabric", "feather", "flower", "galaxy", "gentle", "golden", "guitar", "hammer", "helmet", "hollow", "jungle", "ladder",
  "magnet", "market", "mirror", "mother", "museum", "napkin", "needle", "orange", "pencil", "picnic", "planet", "puzzle", "ribbon", "saddle", "school", "secret",
  "signal", "smooth", "spirit", "summer", "thunder", "ticket", "tomato", "tunnel", "wander", "whisper", "yellow", "zipper", "agenda", "bright", "camera", "donut",
  "eagle", "fable", "glimmer", "horizon", "icicle", "jovial", "keeper", "lively", "mellow", "native", "opal", "pastel", "quiver", "relish", "shelter", "tropic",
  "uplift", "voyage", "wonder", "yonder", "zenith", "banjo", "boulder", "carpet", "daring", "estate", "frozen", "gravel", "humble", "inlet", "joyful", "kettle",
  "little", "memory", "narrow", "object", "pebble", "quaint", "reward", "season", "tablet", "unison", "valley", "wealth", "yearly", "zesty", "banyan", "canopy",
  "detail", "effort", "future", "gather", "honor", "inside", "jigsaw", "kitten", "legacy", "motion", "number", "option", "poetry", "radial", "sample", "temple",
  "unique", "vision", "weekly", "yogurt", "zodiac", "bistro", "cloud", "drift", "echo", "fluent", "groove", "haven", "impact", "jewel", "kindle", "lunar",
  "minute", "novel", "origin", "parcel", "quorum", "rescue", "sierra", "travel", "useful", "volume", "waffle", "yearn", "zinnia", "apollo", "brisk", "crystal",
];
let cloudDataDirty = false;

// ---- State ----
let movies = loadMovies();
let settings = loadSettings();
let activeDetailId = null;
let currentView = localStorage.getItem(VIEW_KEY) || "genres"; // genres | priority | watched
let currentSearchMode = "title"; // title | actor | director

function loadMovies() {
  try {
    const list = JSON.parse(localStorage.getItem(MOVIES_KEY)) || [];
    return list.map(withMediaDefaults);
  } catch (e) {
    return [];
  }
}
// Older records predate TV support; treat anything without a mediaType as a movie.
function withMediaDefaults(m) {
  return { mediaType: "movie", seriesType: null, ...m };
}
function saveMovies() {
  localStorage.setItem(MOVIES_KEY, JSON.stringify(movies));
  markCloudDataDirty();
}
function loadSettings() {
  try {
    return Object.assign({ tmdbKey: "", omdbKey: "", region: "US" }, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
  } catch (e) {
    return { tmdbKey: "", omdbKey: "", region: "US" };
  }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function starString(rating, max = 5) {
  rating = Math.round(rating || 0);
  return "★".repeat(rating) + "☆".repeat(max - rating);
}
// TMDB path segment for a record: "tv" for series, "movie" otherwise.
function tmdbType(movie) {
  return (movie.mediaType || "movie") === "tv" ? "tv" : "movie";
}
// Short label shown on series cards/items; "" for ordinary movies.
function mediaTypeLabel(movie) {
  if ((movie.mediaType || "movie") !== "tv") return "";
  return /mini/i.test(movie.seriesType || "") ? "Mini-series" : "Series";
}

// ---- Atmosphere theme picker ----
const themePicker = document.getElementById("theme-picker");
function resolveEffectiveTheme(preference) {
  if (preference !== "random") return preference === "dark" ? "night" : preference;
  const initialTheme = window.__cirrusInitialRandomTheme;
  if (["day", "twilight", "night"].includes(initialTheme)) {
    delete window.__cirrusInitialRandomTheme;
    return initialTheme;
  }
  const themes = ["day", "twilight", "night"];
  return themes[Math.floor(Math.random() * themes.length)];
}
function applyTheme(preference) {
  const effective = resolveEffectiveTheme(preference);
  document.documentElement.classList.remove("dark", "night", "twilight");
  if (effective === "night") document.documentElement.classList.add("dark", "night");
  else if (effective === "twilight") document.documentElement.classList.add("twilight");
  themePicker?.querySelectorAll(".theme-chip").forEach((chip) => {
    chip.classList.toggle("theme-chip--active", chip.dataset.themeVal === preference);
  });
}
const storedTheme = localStorage.getItem(THEME_KEY) || "day";
applyTheme(storedTheme === "light" ? "day" : storedTheme);
themePicker?.addEventListener("click", (event) => {
  const chip = event.target.closest(".theme-chip");
  if (!chip) return;
  const preference = chip.dataset.themeVal;
  localStorage.setItem(THEME_KEY, preference);
  applyTheme(preference);
});

// ---- Rendering ----
function movieCardHtml(movie) {
  const poster = movie.poster
    ? `<img class="movie-card__poster" src="${escapeHtml(movie.poster)}" alt="" />`
    : `<div class="movie-card__poster">${escapeHtml(movie.title)}</div>`;
  const rt = (movie.sourcedRatings || []).find((r) => r.source === "Rotten Tomatoes");
  const rtScore = rt ? parseInt(rt.value, 10) : null;
  const rtBadge = Number.isFinite(rtScore)
    ? `<span class="movie-card__rt-badge ${rtScore >= 60 ? "movie-card__rt-badge--fresh" : "movie-card__rt-badge--rotten"}">🍅 ${rtScore}%</span>`
    : "";
  const watchedBadge = movie.status === "watched" ? `<span class="movie-card__watched-badge" title="Watched">✓</span>` : "";
  const typeLabel = mediaTypeLabel(movie);
  const typeBadge = typeLabel ? `<span class="movie-card__type-badge">${escapeHtml(typeLabel)}</span>` : "";
  return `
    <article class="movie-card${movie.status === "watched" ? " movie-card--watched" : ""}" data-id="${movie.id}">
      <div class="movie-card__poster-wrap">
        ${poster}
        ${rtBadge}
        ${watchedBadge}
        ${typeBadge}
      </div>
      <div class="movie-card__body">
        <p class="movie-card__title">${escapeHtml(movie.title)}</p>
        <p class="movie-card__year">${escapeHtml(movie.year || "")}${movie.personalRating ? ` &middot; ${"★".repeat(Math.round(movie.personalRating))}` : ""}</p>
      </div>
    </article>`;
}

function lineItemThumb(movie) {
  return movie.poster
    ? `<img class="line-item__thumb" src="${escapeHtml(movie.poster)}" alt="" />`
    : `<div class="line-item__thumb line-item__thumb--empty"></div>`;
}

function rtBadgeInline(movie) {
  const rt = (movie.sourcedRatings || []).find((r) => r.source === "Rotten Tomatoes");
  const rtScore = rt ? parseInt(rt.value, 10) : null;
  return Number.isFinite(rtScore)
    ? `<span class="line-item__rt ${rtScore >= 60 ? "is-fresh" : "is-rotten"}">🍅 ${rtScore}%</span>`
    : "";
}

function priorityItemHtml(movie, rank) {
  const genre = movie.genres && movie.genres.length ? movie.genres[0] : "Uncategorized";
  const sub = [movie.year, mediaTypeLabel(movie), genre].filter(Boolean).join(" · ");
  return `
    <div class="line-item line-item--draggable" draggable="true" data-id="${movie.id}">
      <span class="line-item__handle" aria-hidden="true" title="Drag to reorder">⠿</span>
      <span class="line-item__rank">${rank}</span>
      ${lineItemThumb(movie)}
      <div class="line-item__main">
        <span class="line-item__title">${escapeHtml(movie.title)}</span>
        <span class="line-item__sub">${escapeHtml(sub)}</span>
      </div>
      ${rtBadgeInline(movie)}
    </div>`;
}

function watchedItemHtml(movie) {
  const stars = movie.personalRating
    ? `<span class="line-item__stars" title="Your rating">${"★".repeat(Math.round(movie.personalRating))}</span>`
    : "";
  const date = movie.watchedDate ? `<span class="line-item__date">${escapeHtml(movie.watchedDate)}</span>` : "";
  const sub = [movie.year, mediaTypeLabel(movie)].filter(Boolean).join(" · ");
  return `
    <div class="line-item" data-id="${movie.id}">
      ${lineItemThumb(movie)}
      <div class="line-item__main">
        <span class="line-item__title">${escapeHtml(movie.title)}</span>
        <span class="line-item__sub">${escapeHtml(sub)}</span>
      </div>
      <div class="line-item__meta">
        ${rtBadgeInline(movie)}
        ${stars}
        ${date}
      </div>
    </div>`;
}

// Assigns sequential priority values to watchlist movies that don't have one yet
// (e.g. pre-existing data), preserving their current add order.
function ensurePriorities() {
  const wl = movies.filter((m) => m.status === "watchlist");
  if (!wl.some((m) => typeof m.priority !== "number")) return;
  wl.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || (a.addedAt || 0) - (b.addedAt || 0));
  wl.forEach((m, i) => (m.priority = i));
  saveMovies();
}

function renderGenreView(list) {
  const groups = new Map();
  for (const movie of list) {
    const genre = movie.genres && movie.genres.length ? movie.genres[0] : "Uncategorized";
    if (!groups.has(genre)) groups.set(genre, []);
    groups.get(genre).push(movie);
  }
  const genres = [...groups.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });
  return genres
    .map(
      (genre) => `
      <section class="category">
        <h2 class="category__title">${escapeHtml(genre)}</h2>
        <div class="movie-grid">${groups.get(genre).map(movieCardHtml).join("")}</div>
      </section>`
    )
    .join("");
}

function renderPriorityView(list) {
  const ordered = [...list].sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || (a.addedAt || 0) - (b.addedAt || 0));
  return `
    <p class="list-hint">Drag items to rank them — top is highest priority.</p>
    <div class="line-list line-list--priority">
      ${ordered.map((m, i) => priorityItemHtml(m, i + 1)).join("")}
    </div>`;
}

function renderWatchedView(list) {
  const ordered = [...list].sort((a, b) => (b.watchedDate || "").localeCompare(a.watchedDate || "") || (b.addedAt || 0) - (a.addedAt || 0));
  return `<div class="line-list">${ordered.map(watchedItemHtml).join("")}</div>`;
}

function renderLists() {
  ensurePriorities();
  const feed = document.getElementById("movie-feed");
  const empty = document.getElementById("movies-empty");
  document.querySelectorAll(".view-switch__btn").forEach((b) => {
    b.classList.toggle("view-switch__btn--active", b.dataset.view === currentView);
  });

  const watchlist = movies.filter((m) => m.status === "watchlist");
  const watched = movies.filter((m) => m.status === "watched");

  if (currentView === "watched") {
    if (!watched.length) {
      empty.textContent = "No watched movies yet. Open a movie and mark it as watched.";
      empty.style.display = "block";
      feed.innerHTML = "";
      return;
    }
    empty.style.display = "none";
    feed.innerHTML = renderWatchedView(watched);
    return;
  }

  // genres + priority are both views of the watchlist ("movies to watch")
  if (!watchlist.length) {
    empty.textContent = "Nothing on your watchlist yet. Search above or add a movie manually.";
    empty.style.display = "block";
    feed.innerHTML = "";
    return;
  }
  empty.style.display = "none";
  feed.innerHTML = currentView === "priority" ? renderPriorityView(watchlist) : renderGenreView(watchlist);
}

// ---- View switcher ----
document.querySelector(".view-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".view-switch__btn");
  if (!btn) return;
  currentView = btn.dataset.view;
  localStorage.setItem(VIEW_KEY, currentView);
  renderLists();
});

const feedEl = document.getElementById("movie-feed");
feedEl.addEventListener("click", (e) => openDetailFromCard(e));

function openDetailFromCard(e) {
  if (feedEl.classList.contains("is-dragging")) return;
  const el = e.target.closest("[data-id]");
  if (!el || !feedEl.contains(el)) return;
  openDetailModal(el.dataset.id);
}

// ---- Priority drag-and-drop reordering ----
let draggedEl = null;

function getDragAfterElement(container, y) {
  const items = [...container.querySelectorAll(".line-item--draggable:not(.dragging)")];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: -Infinity, element: null }
  ).element;
}

feedEl.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".line-item--draggable");
  if (!li) return;
  draggedEl = li;
  feedEl.classList.add("is-dragging");
  li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
});

feedEl.addEventListener("dragover", (e) => {
  if (!draggedEl) return;
  e.preventDefault();
  const container = draggedEl.parentElement;
  const after = getDragAfterElement(container, e.clientY);
  if (after == null) container.appendChild(draggedEl);
  else container.insertBefore(draggedEl, after);
  container.querySelectorAll(".line-item__rank").forEach((el, i) => (el.textContent = i + 1));
});

feedEl.addEventListener("dragend", () => {
  if (!draggedEl) return;
  draggedEl.classList.remove("dragging");
  draggedEl = null;
  commitPriorityOrder();
  // Clear the drag flag after the click event that follows drop has passed.
  setTimeout(() => feedEl.classList.remove("is-dragging"), 0);
});

function commitPriorityOrder() {
  const ids = [...feedEl.querySelectorAll(".line-item--draggable")].map((el) => el.dataset.id);
  ids.forEach((id, idx) => {
    const m = movies.find((mm) => mm.id === id);
    if (m) m.priority = idx;
  });
  saveMovies();
}

// ---- TMDB search ----
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

// Stays readonly until focused so browsers/password managers won't autofill it.
searchInput.addEventListener("focus", () => searchInput.removeAttribute("readonly"));

// Chrome re-autofills saved credentials after a delay despite the guards above;
// its autofill triggers this animation (see styles.css), so clear the field when it does.
searchInput.addEventListener("animationstart", (e) => {
  if (e.animationName === "onSearchAutofill" && document.activeElement !== searchInput) {
    searchInput.value = "";
  }
});

document.getElementById("search-btn").addEventListener("click", runSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

// Search-by selector (title / actor / director) adjusts the query endpoint + placeholder.
const searchMode = document.getElementById("search-mode");
function updateSearchPlaceholder() {
  searchInput.placeholder =
    currentSearchMode === "actor"
      ? "Search by actor name…"
      : currentSearchMode === "director"
        ? "Search by director name…"
        : "Search for a movie or series by title…";
}
searchMode.addEventListener("change", () => {
  currentSearchMode = searchMode.value;
  updateSearchPlaceholder();
});

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  if (!settings.tmdbKey) {
    searchResults.innerHTML = `<p class="empty-state">Add a TMDB API key in Settings to search (it's free at themoviedb.org), or use "Add Manually".</p>`;
    searchResults.classList.add("open");
    return;
  }
  searchResults.innerHTML = `<p class="empty-state">Searching…</p>`;
  searchResults.classList.add("open");
  try {
    if (currentSearchMode === "title") {
      const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(settings.tmdbKey)}&query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.status_message || "Search failed");
      renderSearchResults(data.results || []);
    } else {
      await searchByPerson(query, currentSearchMode);
    }
  } catch (err) {
    searchResults.innerHTML = `<p class="empty-state">Search failed: ${escapeHtml(err.message)}</p>`;
  }
}

// Actor/director search: find the best-matching person, then list the films they
// acted in (cast) or directed (crew, job === "Director").
async function searchByPerson(query, mode) {
  const personRes = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${encodeURIComponent(settings.tmdbKey)}&query=${encodeURIComponent(query)}`);
  const personData = await personRes.json();
  if (!personRes.ok) throw new Error(personData.status_message || "Search failed");
  const people = personData.results || [];
  if (!people.length) {
    searchResults.innerHTML = `<p class="empty-state">No ${mode} found by that name.</p>`;
    return;
  }
  const wantedDept = mode === "actor" ? "Acting" : "Directing";
  const person = people.find((p) => p.known_for_department === wantedDept) || people[0];

  const credRes = await fetch(`https://api.themoviedb.org/3/person/${person.id}/combined_credits?api_key=${encodeURIComponent(settings.tmdbKey)}`);
  const credData = await credRes.json();
  if (!credRes.ok) throw new Error(credData.status_message || "Couldn't load credits");

  let films = mode === "actor" ? credData.cast || [] : (credData.crew || []).filter((c) => c.job === "Director");
  const seen = new Set();
  films = films.filter((f) => {
    const key = `${f.media_type || "movie"}:${f.id}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const creditDate = (f) => f.release_date || f.first_air_date || "";
  films.sort((a, b) => creditDate(b).localeCompare(creditDate(a)) || (b.popularity || 0) - (a.popularity || 0));

  renderPersonResults(person, mode, films);
}

// Normalizes a TMDB movie/tv/multi result into a common shape for rendering.
function normalizeResult(r) {
  const mediaType = r.media_type === "tv" ? "tv" : "movie";
  return {
    id: r.id,
    mediaType,
    title: mediaType === "tv" ? r.name : r.title,
    year: ((mediaType === "tv" ? r.first_air_date : r.release_date) || "").slice(0, 4),
    poster_path: r.poster_path,
  };
}

function searchRowHtml(result) {
  const n = normalizeResult(result);
  const typeTag = n.mediaType === "tv" ? ` <span class="search-result__type">TV</span>` : "";
  return `
    <div class="search-result" data-tmdb-id="${n.id}" data-media-type="${n.mediaType}">
      <img src="${n.poster_path ? TMDB_IMG + n.poster_path : ""}" alt="" />
      <div>
        <div class="search-result__title">${escapeHtml(n.title)}${typeTag}</div>
        <div class="search-result__year">${escapeHtml(n.year)}</div>
      </div>
    </div>`;
}

function renderPersonResults(person, mode, films) {
  if (!films.length) {
    searchResults.innerHTML = `<p class="empty-state">No titles found for ${escapeHtml(person.name)} as ${mode === "actor" ? "an actor" : "a director"}.</p>`;
    return;
  }
  const role = mode === "actor" ? "Acting" : "Directing";
  const header = `
    <div class="search-person">
      <span class="search-person__name">${escapeHtml(person.name)}</span>
      <span class="search-person__role">${role} · ${films.length} title${films.length > 1 ? "s" : ""}</span>
    </div>`;
  searchResults.innerHTML = header + films.slice(0, 40).map(searchRowHtml).join("");
}

function renderSearchResults(results) {
  const filtered = results.filter((r) => r.media_type === "movie" || r.media_type === "tv" || !r.media_type);
  if (!filtered.length) {
    searchResults.innerHTML = `<p class="empty-state">No matches found.</p>`;
    return;
  }
  searchResults.innerHTML = filtered.slice(0, 12).map(searchRowHtml).join("");
}

searchResults.addEventListener("click", (e) => {
  const item = e.target.closest(".search-result");
  if (!item) return;
  const tmdbId = Number(item.dataset.tmdbId);
  addFromTmdbId(tmdbId, item.dataset.mediaType || "movie");
});

async function addFromTmdbId(tmdbId, mediaType = "movie") {
  if (movies.some((m) => m.tmdbId === tmdbId && (m.mediaType || "movie") === mediaType)) {
    searchResults.classList.remove("open");
    searchInput.value = "";
    return;
  }
  const movie = {
    id: uuid(),
    tmdbId,
    mediaType,
    seriesType: null,
    title: "",
    year: "",
    poster: null,
    overview: "",
    status: "watchlist",
    personalRating: 0,
    watchedDate: null,
    notes: "",
    imdbId: null,
    genres: [],
    sourcedRatings: [],
    reviews: [],
    watchProviders: null,
    addedAt: Date.now(),
  };
  movies.push(movie);
  saveMovies();
  searchResults.classList.remove("open");
  searchInput.value = "";
  renderLists();
  await hydrateFromTmdb(movie);
  renderLists();
}

async function hydrateFromTmdb(movie) {
  if (!settings.tmdbKey || !movie.tmdbId) return;
  const type = tmdbType(movie);
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${movie.tmdbId}?api_key=${encodeURIComponent(settings.tmdbKey)}`);
    const data = await res.json();
    if (!res.ok) return;
    if (type === "tv") {
      movie.title = data.name || movie.title;
      movie.year = (data.first_air_date || "").slice(0, 4);
      movie.seriesType = data.type || null;
    } else {
      movie.title = data.title || movie.title;
      movie.year = (data.release_date || "").slice(0, 4);
    }
    movie.poster = data.poster_path ? TMDB_IMG + data.poster_path : null;
    movie.overview = data.overview || "";
    movie.genres = (data.genres || []).map((g) => g.name);
    movie.sourcedRatings = data.vote_average ? [{ source: "TMDB", value: data.vote_average.toFixed(1) }] : [];
    // Movies carry imdb_id on the detail object; TV exposes it via a separate endpoint.
    if (type === "tv") {
      movie.imdbId = await fetchTvImdbId(movie.tmdbId);
    } else {
      movie.imdbId = data.imdb_id || null;
    }
    saveMovies();

    const reviewRes = await fetch(`https://api.themoviedb.org/3/${type}/${movie.tmdbId}/reviews?api_key=${encodeURIComponent(settings.tmdbKey)}`);
    const reviewData = await reviewRes.json();
    if (reviewRes.ok) {
      movie.reviews = (reviewData.results || []).slice(0, 5).map((r) => ({ author: r.author, content: r.content }));
      saveMovies();
    }

    if (settings.omdbKey && movie.imdbId) {
      await hydrateFromOmdb(movie);
    }

    await hydrateWatchProviders(movie);
  } catch (e) {
    // offline or blocked request — movie stays as a manual-style entry
  }
}

async function fetchTvImdbId(tmdbId) {
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${encodeURIComponent(settings.tmdbKey)}`);
    const data = await res.json();
    return res.ok ? data.imdb_id || null : null;
  } catch (e) {
    return null;
  }
}

function mapWatchProvider(p) {
  return { name: p.provider_name, logo: p.logo_path ? TMDB_LOGO + p.logo_path : null };
}

async function hydrateWatchProviders(movie) {
  if (!settings.tmdbKey || !movie.tmdbId) return;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${tmdbType(movie)}/${movie.tmdbId}/watch/providers?api_key=${encodeURIComponent(settings.tmdbKey)}`);
    const data = await res.json();
    if (!res.ok) return;
    const region = settings.region || "US";
    const entry = (data.results || {})[region];
    movie.watchProviders = {
      region,
      link: entry?.link || null,
      flatrate: (entry?.flatrate || []).map(mapWatchProvider),
      rent: (entry?.rent || []).map(mapWatchProvider),
      buy: (entry?.buy || []).map(mapWatchProvider),
    };
    saveMovies();
  } catch (e) {
    // offline or blocked request — leave watch providers as-is
  }
}

// Backfills/refreshes availability for movies that haven't been checked yet (or whose
// cached data is for a different region than the current setting).
async function backfillWatchProviders() {
  if (!settings.tmdbKey) return;
  const region = settings.region || "US";
  const stale = movies.filter((m) => m.tmdbId && (!m.watchProviders || m.watchProviders.region !== region));
  if (!stale.length) return;
  for (const movie of stale) {
    await hydrateWatchProviders(movie);
  }
  renderLists();
}

async function hydrateFromOmdb(movie) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbKey)}&i=${encodeURIComponent(movie.imdbId)}`);
    const data = await res.json();
    if (data.Response === "True" && Array.isArray(data.Ratings)) {
      const wanted = ["Internet Movie Database", "Rotten Tomatoes"];
      const extra = data.Ratings.filter((r) => wanted.includes(r.Source)).map((r) => ({ source: r.Source, value: r.Value }));
      movie.sourcedRatings = [...movie.sourcedRatings.filter((r) => r.source === "TMDB"), ...extra];
      saveMovies();
    }
  } catch (e) {
    // OMDb unreachable or bad key — keep whatever ratings we already have
  }
}

// Backfills IMDb/Rotten Tomatoes/Metacritic onto movies added before an OMDb key was set.
async function backfillSourcedRatings() {
  if (!settings.omdbKey) return;
  const stale = movies.filter((m) => m.imdbId && !(m.sourcedRatings || []).some((r) => r.source !== "TMDB"));
  if (!stale.length) return;
  for (const movie of stale) {
    await hydrateFromOmdb(movie);
  }
  renderLists();
}

// ---- Add manually ----
const manualModal = document.getElementById("manual-modal");
document.getElementById("add-manual-btn").addEventListener("click", () => {
  document.getElementById("manual-title-input").value = "";
  document.getElementById("manual-year-input").value = "";
  document.getElementById("manual-type-input").value = "movie";
  manualModal.classList.add("open");
});
document.getElementById("manual-cancel-btn").addEventListener("click", () => manualModal.classList.remove("open"));
document.getElementById("manual-save-btn").addEventListener("click", () => {
  const title = document.getElementById("manual-title-input").value.trim();
  const year = document.getElementById("manual-year-input").value.trim();
  const mediaType = document.getElementById("manual-type-input").value === "tv" ? "tv" : "movie";
  const seriesType = document.getElementById("manual-type-input").value === "mini" ? "Miniseries" : null;
  if (!title) return;
  movies.push({
    id: uuid(),
    tmdbId: null,
    mediaType: seriesType ? "tv" : mediaType,
    seriesType,
    title,
    year,
    poster: null,
    overview: "",
    status: "watchlist",
    personalRating: 0,
    watchedDate: null,
    notes: "",
    imdbId: null,
    genres: [],
    sourcedRatings: [],
    reviews: [],
    watchProviders: null,
    addedAt: Date.now(),
  });
  saveMovies();
  renderLists();
  manualModal.classList.remove("open");
});

// ---- Detail modal ----
const detailModal = document.getElementById("detail-modal");
const personalRatingInput = document.getElementById("personal-rating-input");
let draftRating = 0;

function openDetailModal(id) {
  const movie = movies.find((m) => m.id === id);
  if (!movie) return;
  activeDetailId = id;
  draftRating = movie.personalRating || 0;

  document.getElementById("detail-title").textContent = movie.title;
  document.getElementById("detail-meta").textContent = [movie.year, mediaTypeLabel(movie)].filter(Boolean).join(" · ");
  document.getElementById("detail-overview").textContent = movie.overview || "";
  document.getElementById("detail-poster").src = movie.poster || "";
  document.getElementById("detail-poster").style.display = movie.poster ? "block" : "none";
  document.getElementById("detail-status").value = movie.status;
  document.getElementById("detail-watched-date").value = movie.watchedDate || "";
  document.getElementById("detail-notes").value = movie.notes || "";
  document.getElementById("watched-date-field").style.display = movie.status === "watched" ? "block" : "none";

  document.getElementById("detail-sourced-ratings").innerHTML = (movie.sourcedRatings || [])
    .map((r) => `<span class="rating-chip">${escapeHtml(r.source)}: ${escapeHtml(r.value)}</span>`)
    .join("");

  document.getElementById("detail-watch-providers").innerHTML = watchProvidersDetailHtml(movie);

  document.getElementById("detail-reviews").innerHTML = (movie.reviews || [])
    .map((r) => `<div class="review"><div class="review__author">${escapeHtml(r.author)}</div><div class="review__content">${escapeHtml(r.content)}</div></div>`)
    .join("");

  renderStarInput();
  detailModal.classList.add("open");
}

function watchProvidersDetailHtml(movie) {
  const wp = movie.watchProviders;
  if (!wp) {
    return `<p class="watch-providers__empty">Availability not checked yet${settings.tmdbKey ? " — reopen after a refresh." : " (add a TMDB API key in Settings)."}</p>`;
  }
  const groups = [
    ["Stream", wp.flatrate],
    ["Rent", wp.rent],
    ["Buy", wp.buy],
  ].filter(([, list]) => list && list.length);
  const regionLabel = wp.region ? ` in ${escapeHtml(wp.region)}` : "";
  if (!groups.length) {
    return `<p class="watch-providers__empty">Not currently streaming, renting, or available to buy${regionLabel}.</p>`;
  }
  const groupsHtml = groups
    .map(
      ([label, list]) => `
      <div class="watch-providers__group">
        <span class="watch-providers__label">${label}</span>
        <div class="watch-providers__list">
          ${list.map((p) => `<span class="watch-provider">${p.logo ? `<img src="${escapeHtml(p.logo)}" alt="" />` : ""}${escapeHtml(p.name)}</span>`).join("")}
        </div>
      </div>`
    )
    .join("");
  const link = wp.link ? `<a class="watch-providers__link" href="${escapeHtml(wp.link)}" target="_blank" rel="noopener">See all options on JustWatch</a>` : "";
  return groupsHtml + link;
}

function renderStarInput() {
  personalRatingInput.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const span = document.createElement("span");
    span.className = "star" + (i <= draftRating ? " star--filled" : "");
    span.textContent = i <= draftRating ? "★" : "☆";
    span.addEventListener("click", () => {
      draftRating = draftRating === i ? 0 : i;
      renderStarInput();
    });
    personalRatingInput.appendChild(span);
  }
}

document.getElementById("detail-status").addEventListener("change", (e) => {
  document.getElementById("watched-date-field").style.display = e.target.value === "watched" ? "block" : "none";
});

document.getElementById("detail-cancel-btn").addEventListener("click", () => detailModal.classList.remove("open"));

document.getElementById("detail-save-btn").addEventListener("click", () => {
  const movie = movies.find((m) => m.id === activeDetailId);
  if (!movie) return;
  movie.status = document.getElementById("detail-status").value;
  movie.watchedDate = movie.status === "watched" ? document.getElementById("detail-watched-date").value || new Date().toISOString().slice(0, 10) : null;
  movie.notes = document.getElementById("detail-notes").value;
  movie.personalRating = draftRating;
  saveMovies();
  renderLists();
  detailModal.classList.remove("open");
});

document.getElementById("detail-remove-btn").addEventListener("click", () => {
  if (!confirm("Remove this movie from your list?")) return;
  movies = movies.filter((m) => m.id !== activeDetailId);
  saveMovies();
  renderLists();
  detailModal.classList.remove("open");
});

// ---- Settings modal ----
const settingsModal = document.getElementById("settings-modal");
document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("tmdb-key-input").value = settings.tmdbKey || "";
  document.getElementById("omdb-key-input").value = settings.omdbKey || "";
  document.getElementById("region-input").value = settings.region || "US";
  document.getElementById("tmdb-key-test-status").textContent = "";
  document.getElementById("omdb-key-test-status").textContent = "";
  settingsModal.classList.add("open");
});
document.getElementById("settings-close-btn").addEventListener("click", () => {
  settings.tmdbKey = document.getElementById("tmdb-key-input").value.trim();
  settings.omdbKey = document.getElementById("omdb-key-input").value.trim();
  settings.region = document.getElementById("region-input").value;
  saveSettings();
  settingsModal.classList.remove("open");
  backfillWatchProviders();
  backfillSourcedRatings();
});

function setKeyTestStatus(elId, state, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.className = "key-test-status" + (state ? ` key-test-status--${state}` : "");
}

document.getElementById("tmdb-key-test-btn").addEventListener("click", async () => {
  const key = document.getElementById("tmdb-key-input").value.trim();
  if (!key) {
    setKeyTestStatus("tmdb-key-test-status", "error", "Enter a key first.");
    return;
  }
  setKeyTestStatus("tmdb-key-test-status", "pending", "Testing…");
  try {
    const res = await fetch(`https://api.themoviedb.org/3/authentication?api_key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (res.ok && data.success) {
      setKeyTestStatus("tmdb-key-test-status", "ok", "✓ Working");
    } else {
      setKeyTestStatus("tmdb-key-test-status", "error", `✗ ${data.status_message || "Invalid key"}`);
    }
  } catch (e) {
    setKeyTestStatus("tmdb-key-test-status", "error", "✗ Couldn't reach TMDB (check your connection).");
  }
});

document.getElementById("omdb-key-test-btn").addEventListener("click", async () => {
  const key = document.getElementById("omdb-key-input").value.trim();
  if (!key) {
    setKeyTestStatus("omdb-key-test-status", "error", "Enter a key first.");
    return;
  }
  setKeyTestStatus("omdb-key-test-status", "pending", "Testing…");
  try {
    // tt0111161 (Shawshank Redemption) is just a known-good probe id, not tied to the user's data.
    const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=tt0111161`);
    const data = await res.json();
    if (data.Response === "True") {
      setKeyTestStatus("omdb-key-test-status", "ok", "✓ Working");
    } else {
      setKeyTestStatus("omdb-key-test-status", "error", `✗ ${data.Error || "Invalid key"}`);
    }
  } catch (e) {
    setKeyTestStatus("omdb-key-test-status", "error", "✗ Couldn't reach OMDb (check your connection).");
  }
});

// ---- Cloud sync + unified backup ----
const cloudPhraseInput = document.getElementById("cloud-phrase");
const rememberCloudPhraseInput = document.getElementById("remember-cloud-phrase");
const toggleCloudPhraseBtn = document.getElementById("toggle-cloud-phrase-btn");
const generateCloudPhraseBtn = document.getElementById("generate-cloud-phrase-btn");
const cloudPhraseOutput = document.getElementById("cloud-phrase-output");
const cloudLoadDataBtn = document.getElementById("cloud-load-data-btn");
const cloudSaveDataBtn = document.getElementById("cloud-save-data-btn");
const downloadEncryptedDataBtn = document.getElementById("download-encrypted-data-btn");
const importEncryptedDataBtn = document.getElementById("import-encrypted-data-btn");
const importEncryptedFileInput = document.getElementById("import-encrypted-file-input");
const cloudDataStatus = document.getElementById("cloud-data-status");

// Builds the Cirrus slice of the shared unified backup.
function createCirrusBackupData() {
  return {
    version: 1,
    appName: "Cirrus",
    exportedAt: new Date().toISOString(),
    theme: localStorage.getItem(THEME_KEY) || "day",
    movies,
  };
}

// Preserves every other app's slice so saving from Cirrus never clobbers Nimbus/Cumulus/Stratus data.
function getExistingBackupApps(existingBackup) {
  if (!existingBackup || typeof existingBackup !== "object") return {};
  if (existingBackup.schema === UNIFIED_BACKUP_SCHEMA && existingBackup.apps && typeof existingBackup.apps === "object") return { ...existingBackup.apps };
  if (existingBackup.appName === "Nimbus" || Array.isArray(existingBackup.tabs)) return { nimbus: existingBackup };
  if (existingBackup.appName === "Cumulus" || Array.isArray(existingBackup.accounts)) return { cumulus: existingBackup };
  if (existingBackup.appName === "Cirrus" || Array.isArray(existingBackup.movies)) return { cirrus: existingBackup };
  if (existingBackup.appName === "Stratus" || Array.isArray(existingBackup.stamps)) return { stratus: existingBackup };
  return {};
}

function createBackupData(existingBackup) {
  const apps = getExistingBackupApps(existingBackup);
  apps.cirrus = createCirrusBackupData();
  return {
    schema: UNIFIED_BACKUP_SCHEMA,
    version: 1,
    appName: "Kashikoi Apps",
    exportedAt: new Date().toISOString(),
    apps,
  };
}

function downloadBackup(backup, filename) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normalizeBackupData(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid format");
  const cirrusData = data.schema === UNIFIED_BACKUP_SCHEMA && data.apps && data.apps.cirrus ? data.apps.cirrus : data;
  const importedMovies = Array.isArray(cirrusData.movies) ? cirrusData.movies.filter((m) => m && typeof m === "object") : null;
  if (!importedMovies) throw new Error("No Cirrus data");
  return { movies: importedMovies.map(withMediaDefaults), theme: cirrusData.theme };
}

function restoreBackupData(data, sourceLabel) {
  const imported = normalizeBackupData(data);
  const count = imported.movies.length;
  if (!confirm(`Restore ${count} title${count === 1 ? "" : "s"} from ${sourceLabel}? This overwrites your current Cirrus list and cannot be undone.`)) return false;
  movies = imported.movies;
  saveMovies();
  if (imported.theme) {
    localStorage.setItem(THEME_KEY, imported.theme);
    applyTheme(imported.theme);
  }
  renderLists();
  backfillWatchProviders();
  backfillSourcedRatings();
  backfillTmdbDetails();
  return true;
}

document.getElementById("export-btn").addEventListener("click", () => {
  try {
    downloadBackup(createBackupData(), `cirrus-backup-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    alert("Export failed: " + err.message);
  }
});

document.getElementById("import-btn").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const restored = restoreBackupData(JSON.parse(reader.result), "this backup");
      if (restored) alert("Import complete.");
    } catch (err) {
      alert(err.message === "No Cirrus data" ? "That backup doesn't contain any Cirrus titles." : "Couldn't import that file: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

function setCloudDataStatus(message, state) {
  if (!cloudDataStatus) return;
  cloudDataStatus.textContent = message;
  cloudDataStatus.dataset.state = state || "info";
}

function normalizeCloudPhrase(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCloudPhrase() {
  return cloudPhraseInput ? normalizeCloudPhrase(cloudPhraseInput.value) : "";
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveCloudKey(phrase, salt) {
  const phraseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(phrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: CLOUD_KDF_ITERATIONS },
    phraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function createRecoveryPhrase() {
  const indexes = new Uint8Array(RECOVERY_PHRASE_WORD_COUNT);
  crypto.getRandomValues(indexes);
  return [...indexes].map((index) => RECOVERY_WORDS[index]).join(" ");
}

async function getCloudSyncKey(phrase) {
  return sha256Hex(`kashikoi-cloud-sync-v1:${phrase}`);
}

async function getLegacyCloudSyncKey(phrase) {
  return sha256Hex(`nimbus-sync-location-v1:${phrase}`);
}

async function encryptCloudBackup(phrase, backupData) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCloudKey(phrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(backupData || createBackupData()));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    app: CLOUD_ENVELOPE_APP,
    writtenBy: "Cirrus",
    format: CLOUD_SYNC_FORMAT,
    updatedAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: CLOUD_KDF_ITERATIONS, salt: arrayBufferToBase64(salt) },
    cipher: { name: "AES-GCM", iv: arrayBufferToBase64(iv) },
    payload: arrayBufferToBase64(encrypted),
  };
}

async function decryptCloudBackup(phrase, envelope) {
  if (!envelope || !ACCEPTED_ENVELOPE_APPS.has(envelope.app) || (envelope.format !== CLOUD_SYNC_FORMAT && envelope.format !== LEGACY_CLOUD_SYNC_FORMAT)) {
    throw new Error("Invalid envelope");
  }
  const salt = new Uint8Array(base64ToArrayBuffer(envelope.kdf && envelope.kdf.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(envelope.cipher && envelope.cipher.iv));
  const encrypted = base64ToArrayBuffer(envelope.payload);
  const key = await deriveCloudKey(phrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function fetchEncryptedBackupAtKey(syncKey) {
  // iOS Safari ignores cache: "no-store" here and replays a stale backup, so vary the URL.
  const response = await fetch(`${CLOUD_SYNC_ENDPOINT}/sync/${syncKey}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchExistingCloudBackup(phrase) {
  const syncKey = await getCloudSyncKey(phrase);
  const envelope = await fetchEncryptedBackupAtKey(syncKey);
  if (envelope) return { syncKey, envelope };
  const legacySyncKey = await getLegacyCloudSyncKey(phrase);
  const legacyEnvelope = await fetchEncryptedBackupAtKey(legacySyncKey);
  return legacyEnvelope ? { syncKey, envelope: legacyEnvelope } : { syncKey, envelope: null };
}

async function createMergedCloudBackup(phrase) {
  const existing = await fetchExistingCloudBackup(phrase);
  let existingBackup = null;
  if (existing.envelope) existingBackup = await decryptCloudBackup(phrase, existing.envelope);
  return { syncKey: await getCloudSyncKey(phrase), backup: createBackupData(existingBackup) };
}

function markCloudDataDirty() {
  if (!cloudPhraseInput || !getCloudPhrase()) return;
  cloudDataDirty = true;
  setCloudDataStatus("Local changes are not saved to encrypted cloud sync yet.", "warn");
}

function updateCloudPhraseOutput(phrase) {
  if (!cloudPhraseOutput) return;
  cloudPhraseOutput.hidden = !phrase;
  cloudPhraseOutput.textContent = phrase ? phrase : "";
}

function saveRememberedCloudPhrase() {
  if (!rememberCloudPhraseInput) return;
  if (rememberCloudPhraseInput.checked && getCloudPhrase()) {
    localStorage.setItem(REMEMBER_CLOUD_PHRASE_KEY, getCloudPhrase());
  } else if (!rememberCloudPhraseInput.checked) {
    localStorage.removeItem(REMEMBER_CLOUD_PHRASE_KEY);
  }
}

function loadRememberedCloudPhrase() {
  if (!cloudPhraseInput || !rememberCloudPhraseInput) return;
  const savedPhrase = localStorage.getItem(REMEMBER_CLOUD_PHRASE_KEY) || "";
  if (!savedPhrase) return;
  cloudPhraseInput.value = savedPhrase;
  rememberCloudPhraseInput.checked = true;
  setCloudDataStatus("Recovery phrase remembered on this device.", "info");
}

async function loadCloudData() {
  const phrase = getCloudPhrase();
  if (!phrase) {
    setCloudDataStatus("Enter your recovery phrase first.", "error");
    return;
  }
  if (!crypto.subtle) {
    setCloudDataStatus("This browser does not support Web Crypto encryption.", "error");
    return;
  }
  setCloudDataStatus("Loading encrypted cloud backup…", "info");
  try {
    const existing = await fetchExistingCloudBackup(phrase);
    if (!existing.envelope) {
      setCloudDataStatus("No cloud backup exists for this phrase yet. Save to cloud from the first device first.", "error");
      return;
    }
    const data = await decryptCloudBackup(phrase, existing.envelope);
    const restored = restoreBackupData(data, "encrypted cloud sync");
    if (!restored) setCloudDataStatus("Cloud load cancelled.", "info");
  } catch (error) {
    setCloudDataStatus(error.message === "No Cirrus data" ? "This cloud backup has no Cirrus titles yet." : "Could not decrypt cloud backup. Check the phrase or try again later.", "error");
  }
}

async function saveCloudData() {
  const phrase = getCloudPhrase();
  if (!phrase) {
    setCloudDataStatus("Enter or create a recovery phrase first.", "error");
    return;
  }
  if (!crypto.subtle) {
    setCloudDataStatus("This browser does not support Web Crypto encryption.", "error");
    return;
  }
  setCloudDataStatus("Encrypting and saving cloud backup…", "info");
  try {
    const merged = await createMergedCloudBackup(phrase);
    const response = await fetch(`${CLOUD_SYNC_ENDPOINT}/sync/${merged.syncKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await encryptCloudBackup(phrase, merged.backup)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cloudDataDirty = false;
    setCloudDataStatus("Saved to cloud. Use the same recovery phrase to restore on another device.", "success");
  } catch (error) {
    setCloudDataStatus("Could not save encrypted cloud backup. Your local Cirrus data is still safe here.", "error");
  }
}

async function downloadEncryptedBackup() {
  const phrase = getCloudPhrase();
  if (!phrase) {
    setCloudDataStatus("Enter or create a recovery phrase first.", "error");
    return;
  }
  if (!crypto.subtle) {
    setCloudDataStatus("This browser does not support Web Crypto encryption.", "error");
    return;
  }
  setCloudDataStatus("Encrypting backup file…", "info");
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBackup(await encryptCloudBackup(phrase), `cirrus-encrypted-backup-${dateStr}.json`);
    setCloudDataStatus("Encrypted backup downloaded. Keep it with your recovery phrase.", "success");
  } catch (error) {
    setCloudDataStatus("Could not create encrypted backup file.", "error");
  }
}

function importEncryptedBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const phrase = getCloudPhrase();
  if (!phrase) {
    setCloudDataStatus("Enter the recovery phrase before importing an encrypted backup.", "error");
    event.target.value = "";
    return;
  }
  if (!crypto.subtle) {
    setCloudDataStatus("This browser does not support Web Crypto encryption.", "error");
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = async function (evt) {
    setCloudDataStatus("Decrypting encrypted backup file…", "info");
    try {
      const data = await decryptCloudBackup(phrase, JSON.parse(evt.target.result));
      const restored = restoreBackupData(data, "encrypted backup file");
      if (!restored) setCloudDataStatus("Encrypted backup import cancelled.", "info");
    } catch (error) {
      setCloudDataStatus("Could not decrypt that file. Check the phrase and backup file.", "error");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

if (generateCloudPhraseBtn) {
  generateCloudPhraseBtn.addEventListener("click", () => {
    const phrase = createRecoveryPhrase();
    if (cloudPhraseInput) cloudPhraseInput.value = phrase;
    updateCloudPhraseOutput(phrase);
    saveRememberedCloudPhrase();
    setCloudDataStatus("Recovery phrase created. Save these words now — Cirrus cannot recover them.", "warn");
  });
}
if (toggleCloudPhraseBtn && cloudPhraseInput) {
  toggleCloudPhraseBtn.addEventListener("click", () => {
    const shouldShow = cloudPhraseInput.type === "password";
    cloudPhraseInput.type = shouldShow ? "text" : "password";
    toggleCloudPhraseBtn.textContent = shouldShow ? "Hide" : "Show";
    toggleCloudPhraseBtn.setAttribute("aria-pressed", shouldShow ? "true" : "false");
  });
}
if (cloudPhraseInput) {
  cloudPhraseInput.addEventListener("input", () => {
    updateCloudPhraseOutput("");
    saveRememberedCloudPhrase();
    if (cloudDataDirty) setCloudDataStatus("Local changes are not saved to encrypted cloud sync yet.", "warn");
  });
  cloudPhraseInput.addEventListener("change", () => {
    cloudPhraseInput.value = getCloudPhrase();
    saveRememberedCloudPhrase();
  });
}
if (rememberCloudPhraseInput) {
  loadRememberedCloudPhrase();
  rememberCloudPhraseInput.addEventListener("change", () => {
    saveRememberedCloudPhrase();
    setCloudDataStatus(rememberCloudPhraseInput.checked ? "Recovery phrase will be remembered on this device." : "Recovery phrase removed from this device.", "info");
  });
}
if (cloudLoadDataBtn) cloudLoadDataBtn.addEventListener("click", loadCloudData);
if (cloudSaveDataBtn) cloudSaveDataBtn.addEventListener("click", saveCloudData);
if (downloadEncryptedDataBtn) downloadEncryptedDataBtn.addEventListener("click", downloadEncryptedBackup);
if (importEncryptedDataBtn && importEncryptedFileInput) {
  importEncryptedDataBtn.addEventListener("click", () => importEncryptedFileInput.click());
  importEncryptedFileInput.addEventListener("change", importEncryptedBackup);
}

document.getElementById("clear-data-btn").addEventListener("click", () => {
  if (!confirm("This deletes all Cirrus movies and settings from this browser. Continue?")) return;
  localStorage.removeItem(MOVIES_KEY);
  localStorage.removeItem(SETTINGS_KEY);
  location.reload();
});

// ---- About modal ----
const aboutModal = document.getElementById("about-modal");
document.getElementById("about-link").addEventListener("click", () => {
  settingsModal.classList.remove("open");
  aboutModal.classList.add("open");
});
document.getElementById("about-close-btn").addEventListener("click", () => aboutModal.classList.remove("open"));

// Close modals on backdrop click
[detailModal, manualModal, settingsModal, aboutModal].forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });
});

// Mirror the About version into the header badge so there's only one place to bump each release.
(() => {
  const src = document.querySelector(".about-modal__version");
  const badge = document.getElementById("app-version");
  if (src && badge) badge.textContent = src.textContent.replace(/^Version\s+/i, "v");
})();

// Backfills the TMDB rating and genres onto movies missing either (e.g. added before these were tracked).
async function backfillTmdbDetails() {
  if (!settings.tmdbKey) return;
  const stale = movies.filter(
    (m) => m.tmdbId && (!(m.sourcedRatings || []).some((r) => r.source === "TMDB") || !(m.genres || []).length)
  );
  if (!stale.length) return;
  for (const movie of stale) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${tmdbType(movie)}/${movie.tmdbId}?api_key=${encodeURIComponent(settings.tmdbKey)}`);
      const data = await res.json();
      if (!res.ok) continue;
      if (data.vote_average && !(movie.sourcedRatings || []).some((r) => r.source === "TMDB")) {
        movie.sourcedRatings = [{ source: "TMDB", value: data.vote_average.toFixed(1) }, ...(movie.sourcedRatings || [])];
      }
      if (Array.isArray(data.genres) && data.genres.length && !(movie.genres || []).length) {
        movie.genres = data.genres.map((g) => g.name);
      }
      saveMovies();
    } catch (e) {
      // offline or blocked request — leave details as-is
    }
  }
  renderLists();
}

// ---- Boot ----
renderLists();
backfillWatchProviders();
backfillSourcedRatings();
backfillTmdbDetails();
