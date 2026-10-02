// ---- Storage keys ----
const THEME_KEY = "cirrus.theme";
const MOVIES_KEY = "cirrus.movies";
const SETTINGS_KEY = "cirrus.settings";

const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

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
    return Object.assign({ tmdbKey: "", omdbKey: "" }, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
  } catch (e) {
    return { tmdbKey: "", omdbKey: "" };
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

// ---- Tabs ----
document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("tab--active", t === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("tab-panel--active"));
  document.getElementById(`panel-${tab.dataset.tab}`).classList.add("tab-panel--active");
  if (tab.dataset.tab === "discover") loadDiscover();
});

// ---- Rendering ----
function movieCardHtml(movie) {
  const poster = movie.poster
    ? `<img class="movie-card__poster" src="${escapeHtml(movie.poster)}" alt="" />`
    : `<div class="movie-card__poster">${escapeHtml(movie.title)}</div>`;
  const chips = (movie.sourcedRatings || [])
    .map((r) => `<span class="rating-chip">${escapeHtml(r.source)} ${escapeHtml(r.value)}</span>`)
    .join("");
  return `
    <article class="movie-card" data-id="${movie.id}">
      ${poster}
      <div class="movie-card__body">
        <p class="movie-card__title">${escapeHtml(movie.title)}</p>
        <p class="movie-card__year">${escapeHtml(movie.year || "")}</p>
        <div class="movie-card__ratings">${chips}</div>
        ${movie.personalRating ? `<div class="movie-card__stars">${starString(movie.personalRating)}</div>` : ""}
      </div>
    </article>`;
}

function renderLists() {
  const watchlist = movies.filter((m) => m.status === "watchlist");
  const watched = movies.filter((m) => m.status === "watched");

  const wlGrid = document.getElementById("watchlist-grid");
  wlGrid.innerHTML = watchlist.map(movieCardHtml).join("");
  document.getElementById("watchlist-empty").style.display = watchlist.length ? "none" : "block";

  const wGrid = document.getElementById("watched-grid");
  wGrid.innerHTML = watched.map(movieCardHtml).join("");
  document.getElementById("watched-empty").style.display = watched.length ? "none" : "block";
}

document.getElementById("watchlist-grid").addEventListener("click", (e) => openDetailFromCard(e));
document.getElementById("watched-grid").addEventListener("click", (e) => openDetailFromCard(e));
document.getElementById("discover-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".movie-card");
  if (!card) return;
  addDiscoverResultToWatchlist(card.dataset.id);
});

function openDetailFromCard(e) {
  const card = e.target.closest(".movie-card");
  if (!card) return;
  openDetailModal(card.dataset.id);
}

// ---- TMDB search ----
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

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
    sourcedRatings: [],
    reviews: [],
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
  } catch (e) {
    // offline or blocked request — movie stays as a manual-style entry
  }
}

async function hydrateFromOmdb(movie) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbKey)}&i=${encodeURIComponent(movie.imdbId)}`);
    const data = await res.json();
    if (data.Response === "True" && Array.isArray(data.Ratings)) {
      const extra = data.Ratings.map((r) => ({ source: r.Source, value: r.Value }));
      movie.sourcedRatings = [...movie.sourcedRatings.filter((r) => r.source === "TMDB"), ...extra];
      saveMovies();
    }
  } catch (e) {
    // OMDb unreachable or bad key — keep whatever ratings we already have
  }
}

// ---- Discover (new releases) ----
let discoverResults = [];
async function loadDiscover() {
  const hint = document.getElementById("discover-hint");
  const grid = document.getElementById("discover-grid");
  if (!settings.tmdbKey) {
    hint.textContent = "Add a free TMDB API key in Settings to see new releases here.";
    hint.style.display = "block";
    grid.innerHTML = "";
    return;
  }
  hint.textContent = "Loading new releases…";
  hint.style.display = "block";
  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/now_playing?api_key=${encodeURIComponent(settings.tmdbKey)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.status_message || "Request failed");
    discoverResults = data.results || [];
    hint.style.display = "none";
    grid.innerHTML = discoverResults
      .map(
        (r) => `
        <article class="movie-card" data-id="${r.id}">
          <img class="movie-card__poster" src="${r.poster_path ? TMDB_IMG + r.poster_path : ""}" alt="" />
          <div class="movie-card__body">
            <p class="movie-card__title">${escapeHtml(r.title)}</p>
            <p class="movie-card__year">${escapeHtml((r.release_date || "").slice(0, 4))}</p>
            <div class="movie-card__ratings"><span class="rating-chip">TMDB ${r.vote_average?.toFixed(1) ?? "–"}</span></div>
          </div>
        </article>`
      )
      .join("");
  } catch (err) {
    hint.textContent = `Couldn't load new releases: ${err.message}`;
  }
}
function addDiscoverResultToWatchlist(tmdbId) {
  addFromTmdbId(Number(tmdbId));
  document.querySelector('.tab[data-tab="watchlist"]').click();
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
    sourcedRatings: [],
    reviews: [],
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

  document.getElementById("detail-reviews").innerHTML = (movie.reviews || [])
    .map((r) => `<div class="review"><div class="review__author">${escapeHtml(r.author)}</div><div class="review__content">${escapeHtml(r.content)}</div></div>`)
    .join("");

  renderStarInput();
  detailModal.classList.add("open");
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
  settingsModal.classList.add("open");
});
document.getElementById("settings-close-btn").addEventListener("click", () => {
  settings.tmdbKey = document.getElementById("tmdb-key-input").value.trim();
  settings.omdbKey = document.getElementById("omdb-key-input").value.trim();
  saveSettings();
  settingsModal.classList.remove("open");
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

// ---- Boot ----
renderLists();
