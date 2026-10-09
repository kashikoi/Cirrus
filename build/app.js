// ---- Storage keys ----
const THEME_KEY = "cirrus.theme";
const MOVIES_KEY = "cirrus.movies";
const SETTINGS_KEY = "cirrus.settings";

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TMDB_LOGO = "https://image.tmdb.org/t/p/w45";

// ---- State ----
let movies = loadMovies();
let settings = loadSettings();
let activeDetailId = null;

function loadMovies() {
  try {
    return JSON.parse(localStorage.getItem(MOVIES_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function saveMovies() {
  localStorage.setItem(MOVIES_KEY, JSON.stringify(movies));
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
  return `
    <article class="movie-card${movie.status === "watched" ? " movie-card--watched" : ""}" data-id="${movie.id}">
      <div class="movie-card__poster-wrap">
        ${poster}
        ${rtBadge}
        ${watchedBadge}
      </div>
      <div class="movie-card__body">
        <p class="movie-card__title">${escapeHtml(movie.title)}</p>
        <p class="movie-card__year">${escapeHtml(movie.year || "")}${movie.personalRating ? ` &middot; ${"★".repeat(Math.round(movie.personalRating))}` : ""}</p>
      </div>
    </article>`;
}

function renderLists() {
  const feed = document.getElementById("movie-feed");
  document.getElementById("movies-empty").style.display = movies.length ? "none" : "block";

  const groups = new Map();
  for (const movie of movies) {
    const genre = movie.genres && movie.genres.length ? movie.genres[0] : "Uncategorized";
    if (!groups.has(genre)) groups.set(genre, []);
    groups.get(genre).push(movie);
  }

  const genres = [...groups.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  feed.innerHTML = genres
    .map(
      (genre) => `
      <section class="category">
        <h2 class="category__title">${escapeHtml(genre)}</h2>
        <div class="movie-grid">${groups.get(genre).map(movieCardHtml).join("")}</div>
      </section>`
    )
    .join("");
}

document.getElementById("movie-feed").addEventListener("click", (e) => openDetailFromCard(e));

function openDetailFromCard(e) {
  const card = e.target.closest(".movie-card");
  if (!card) return;
  openDetailModal(card.dataset.id);
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
    const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(settings.tmdbKey)}&query=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.status_message || "Search failed");
    renderSearchResults(data.results || []);
  } catch (err) {
    searchResults.innerHTML = `<p class="empty-state">Search failed: ${escapeHtml(err.message)}</p>`;
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = `<p class="empty-state">No matches found.</p>`;
    return;
  }
  searchResults.innerHTML = results
    .slice(0, 12)
    .map(
      (r) => `
      <div class="search-result" data-tmdb-id="${r.id}">
        <img src="${r.poster_path ? TMDB_IMG + r.poster_path : ""}" alt="" />
        <div>
          <div class="search-result__title">${escapeHtml(r.title)}</div>
          <div class="search-result__year">${escapeHtml((r.release_date || "").slice(0, 4))}</div>
        </div>
      </div>`
    )
    .join("");
}

searchResults.addEventListener("click", (e) => {
  const item = e.target.closest(".search-result");
  if (!item) return;
  const tmdbId = Number(item.dataset.tmdbId);
  addFromTmdbId(tmdbId);
});

async function addFromTmdbId(tmdbId) {
  if (movies.some((m) => m.tmdbId === tmdbId)) {
    searchResults.classList.remove("open");
    searchInput.value = "";
    return;
  }
  const movie = {
    id: uuid(),
    tmdbId,
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
  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${movie.tmdbId}?api_key=${encodeURIComponent(settings.tmdbKey)}`);
    const data = await res.json();
    if (!res.ok) return;
    movie.title = data.title || movie.title;
    movie.year = (data.release_date || "").slice(0, 4);
    movie.poster = data.poster_path ? TMDB_IMG + data.poster_path : null;
    movie.overview = data.overview || "";
    movie.imdbId = data.imdb_id || null;
    movie.genres = (data.genres || []).map((g) => g.name);
    movie.sourcedRatings = data.vote_average ? [{ source: "TMDB", value: data.vote_average.toFixed(1) }] : [];
    saveMovies();

    const reviewRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.tmdbId}/reviews?api_key=${encodeURIComponent(settings.tmdbKey)}`);
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

function mapWatchProvider(p) {
  return { name: p.provider_name, logo: p.logo_path ? TMDB_LOGO + p.logo_path : null };
}

async function hydrateWatchProviders(movie) {
  if (!settings.tmdbKey || !movie.tmdbId) return;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${movie.tmdbId}/watch/providers?api_key=${encodeURIComponent(settings.tmdbKey)}`);
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
  manualModal.classList.add("open");
});
document.getElementById("manual-cancel-btn").addEventListener("click", () => manualModal.classList.remove("open"));
document.getElementById("manual-save-btn").addEventListener("click", () => {
  const title = document.getElementById("manual-title-input").value.trim();
  const year = document.getElementById("manual-year-input").value.trim();
  if (!title) return;
  movies.push({
    id: uuid(),
    tmdbId: null,
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
  document.getElementById("detail-meta").textContent = movie.year || "";
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

document.getElementById("export-btn").addEventListener("click", () => {
  const payload = { movies, settings: { tmdbKey: "", omdbKey: "" }, theme: localStorage.getItem(THEME_KEY) || "day", exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cirrus-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-btn").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (Array.isArray(imported.movies)) {
        movies = imported.movies;
        saveMovies();
      }
      if (imported.theme) {
        localStorage.setItem(THEME_KEY, imported.theme);
        applyTheme(imported.theme);
      }
      renderLists();
      backfillWatchProviders();
      backfillSourcedRatings();
      alert("Import complete.");
    } catch (err) {
      alert("Couldn't import that file: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

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
      const res = await fetch(`https://api.themoviedb.org/3/movie/${movie.tmdbId}?api_key=${encodeURIComponent(settings.tmdbKey)}`);
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
