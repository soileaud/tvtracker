<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { api, type SearchResult, type StatsSummary, type SubscriptionEntry } from "../api/client";
import type { ShowStatus } from "@tvtrack/model";

const STALE_DAYS = 14;

const STATUSES: ("All" | ShowStatus)[] = ["All", "Watching", "Backlog", "Paused", "Ended"];
const filter = ref<"All" | ShowStatus>("All");
const subs = ref<SubscriptionEntry[]>([]);
const stats = ref<StatsSummary | null>(null);
const results = ref<SearchResult[]>([]);
const query = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
let debounce: ReturnType<typeof setTimeout> | undefined;

async function loadSubs() {
  error.value = null;
  try {
    [subs.value, stats.value] = [
      await api.subscriptions(filter.value === "All" ? undefined : filter.value),
      await api.stats(),
    ];
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function statsLine(): string {
  if (!stats.value) return "";
  const s = stats.value;
  if (s.episodesBehind === 0) return "All caught up";
  const h = Math.floor(s.minutesBehind / 60);
  const when = h > 0 ? `${h}h` : `${s.minutesBehind}m`;
  return `${s.episodesBehind} episode${s.episodesBehind === 1 ? "" : "s"} · ${when} behind across ${s.showsBehind} show${s.showsBehind === 1 ? "" : "s"}`;
}

function isStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - new Date(lastSyncedAt).getTime() > STALE_DAYS * 86_400_000;
}

watch(filter, loadSubs);

function onSearchInput() {
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    if (!query.value.trim()) {
      results.value = [];
      return;
    }
    try {
      results.value = await api.search(query.value.trim());
    } catch (e) {
      error.value = (e as Error).message;
    }
  }, 300);
}

function clearSearch() {
  clearTimeout(debounce);
  query.value = "";
  results.value = [];
  searchInput.value?.focus();
}

async function subscribe(id: number) {
  try {
    await api.subscribe(id);
    notice.value = "Added to library.";
    results.value = [];
    query.value = "";
    await loadSubs();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function markNextWatched(entry: SubscriptionEntry) {
  if (!isActionable(entry)) return;
  try {
    await api.setWatched(entry.nextUnwatched!.tvmazeId, true);
    await loadSubs();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

/**
 * Three tiers: actionable now ("watch"), caught up but returning within
 * 30 days ("soon"), everything else ("done"). Unknown air dates count as
 * actionable — they can't be proven unaired and it clears TBA specials.
 */
type Tier = "watch" | "soon" | "done";
const SOON_MS = 30 * 86_400_000;
const TIER_RANK: Record<Tier, number> = { watch: 0, soon: 1, done: 2 };

function tierOf(entry: SubscriptionEntry): Tier {
  const n = entry.nextUnwatched;
  if (!n) return "done";
  if (!n.airstamp) return "watch";
  const ms = new Date(n.airstamp).getTime() - Date.now();
  if (ms <= 0) return "watch";
  return ms <= SOON_MS ? "soon" : "done";
}

function isActionable(entry: SubscriptionEntry): boolean {
  return tierOf(entry) === "watch";
}

/** Tier order first (name order preserved within each tier). */
const STATUS_RANK: Record<ShowStatus, number> = {
  Watching: 0,
  Backlog: 1,
  Paused: 2,
  Ended: 3,
};
const sortedSubs = computed(() =>
  [...subs.value].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      TIER_RANK[tierOf(a)] - TIER_RANK[tierOf(b)],
  ),
);

function inWhen(airstamp: string): string {
  const ms = new Date(airstamp).getTime() - Date.now();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "any moment";
  if (h < 24) return `in ${h}h`;
  return `in ${Math.ceil(ms / 86_400_000)}d`;
}

function epTag(seasonNo: number, num: number | null, title: string): string {
  const ep = num != null ? `E${num}` : "Special";
  return `S${seasonNo} ${ep} “${title}”`;
}

function nextLabel(entry: SubscriptionEntry): string {
  const t = tierOf(entry);
  if (t === "done") return "Caught up";
  const n = entry.nextUnwatched!;
  const tag = epTag(n.seasonNo, n.number, n.title);
  return t === "soon" ? `Coming Soon — ${tag} · ${inWhen(n.airstamp!)}` : tag;
}

async function refreshAll() {
  try {
    notice.value = "Refreshing…";
    const res = await api.refreshAll();
    notice.value = `Refreshed ${res.refreshed} show(s).`;
    await loadSubs();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(loadSubs);
</script>

<template>
  <main>
    <div class="page-head">
      <h1>Library</h1>
      <button
        class="icon-btn"
        @click="refreshAll"
        title="Refresh all shows from TVMaze"
        aria-label="Refresh all shows from TVMaze"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
    </div>
    <p v-if="stats" class="stats">{{ statsLine() }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="notice">{{ notice }}</p>

    <section class="search-section">
      <div class="search-wrap" role="search">
        <svg
          class="search-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          autocomplete="off"
          aria-label="Search shows to add"
          placeholder="Search shows to add…"
          @input="onSearchInput"
        />
        <button
          v-if="query"
          class="search-clear"
          @click="clearSearch"
          title="Clear search"
          aria-label="Clear search"
        >
          ×
        </button>
      </div>
      <ul v-if="results.length" class="results">
        <li v-for="r in results" :key="r.tvmazeId">
          <img
            v-if="r.posterUrl"
            :src="r.posterUrl"
            :alt="`${r.name} poster`"
            loading="lazy"
          />
          <div v-else class="poster-fallback" aria-hidden="true" />
          <span>{{ r.name }} <small>{{ r.premiered?.slice(0, 4) }} · {{ r.network }}</small></span>
          <button
            class="watch-btn"
            @click="subscribe(r.tvmazeId)"
            title="Add to library"
            aria-label="Add {{ r.name }} to library"
          >
            +
          </button>
        </li>
      </ul>
    </section>

    <div class="segbar" role="group" aria-label="Filter by status">
      <button
        v-for="s in STATUSES"
        :key="s"
        :class="{ active: filter === s }"
        @click="filter = s"
      >
        {{ s }}
      </button>
    </div>

    <ul class="subs">
      <li v-for="e in sortedSubs" :key="e.show.tvmazeId" :class="{ caughtup: !isActionable(e) }">
        <img
          v-if="e.show.posterUrl"
          :src="e.show.posterUrl"
          :alt="`${e.show.name} poster`"
          loading="lazy"
        />
        <div v-else class="poster-fallback" aria-hidden="true" />
        <div class="sub-main">
          <RouterLink :to="`/shows/${e.show.tvmazeId}`">{{ e.show.name }}</RouterLink>
          <span class="next-up">{{ nextLabel(e) }}</span>
          <span class="meta">{{ e.progress.watched }}/{{ e.progress.total }}</span>
          <span v-if="isStale(e.show.lastSyncedAt)" class="stale" title="Not refreshed in 14+ days">stale</span>
        </div>
        <button
          v-if="isActionable(e)"
          class="watch-btn"
          @click="markNextWatched(e)"
          title="Mark next episode watched"
          aria-label="Mark next episode watched"
        >
          ✓
        </button>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.search-section {
  position: relative;
  margin: 0.75rem 0 0.25rem;
}
.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-wrap input {
  width: 100%;
  min-height: 48px;
  font-size: 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 0.6rem 2.75rem 0.6rem 2.6rem;
}
.search-wrap input::placeholder {
  color: var(--muted);
}
.search-wrap input:hover {
  border-color: var(--muted);
}
.search-wrap input:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 1px;
  border-color: var(--link);
}
.search-wrap input[type="search"]::-webkit-search-cancel-button,
.search-wrap input[type="search"]::-webkit-search-decoration {
  display: none;
  appearance: none;
}
.search-icon {
  position: absolute;
  left: 0.9rem;
  color: var(--muted);
  pointer-events: none;
  flex-shrink: 0;
}
.search-clear {
  position: absolute;
  right: 0.5rem;
  width: 32px;
  height: 32px;
  min-height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 1.35rem;
  line-height: 1;
  padding: 0;
  display: grid;
  place-content: center;
  flex-shrink: 0;
}
.search-clear:hover {
  color: var(--text);
  background: var(--accent-bg, rgba(128, 128, 128, 0.15));
}
.results {
  list-style: none;
  padding: 0.35rem;
  margin: 0.5rem 0 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.subs {
  list-style: none;
  padding: 0;
}
.results li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.6rem 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  border-radius: 10px;
}
.results li:last-child {
  border-bottom: none;
}
.results li:hover {
  background: var(--accent-bg, rgba(128, 128, 128, 0.12));
}
.subs li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #333;
}
.subs li.caughtup {
  opacity: 0.65;
}
.results img,
.subs img,
.poster-fallback {
  width: 40px;
  height: 57px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.poster-fallback {
  background: #333;
}
.sub-main {
  display: flex;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.next-up {
  font-size: 0.9rem;
  opacity: 0.85;
  overflow-wrap: anywhere;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin: 1rem 0;
}
.segbar {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding: 0.25rem 0;
  margin: 0.75rem 0 0.5rem;
}
.segbar button {
  flex: 1 0 auto;
  min-height: 44px;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-weight: 600;
  white-space: nowrap;
}
.segbar button.active {
  color: var(--text);
  background: var(--accent-bg, rgba(128, 128, 128, 0.15));
  border-color: var(--accent-border, var(--link));
}
.page-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.page-head h1 {
  margin-right: auto;
}
.icon-btn {
  width: 48px;
  height: 48px;
  min-height: 48px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  padding: 0;
  display: grid;
  place-content: center;
}
.icon-btn svg {
  display: block;
}
button, select {
  min-height: 44px;
}
.meta {
  opacity: 0.75;
  margin-left: auto;
}
.stale {
  font-size: 0.75rem;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 0.35rem;
  opacity: 0.8;
}
.watch-btn {
  width: 48px;
  height: 48px;
  min-height: 48px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  font-size: 1.25rem;
  line-height: 1;
  padding: 0;
}
.watch-btn:active {
  background: var(--accent-bg, rgba(128, 128, 128, 0.2));
}
.stats {
  opacity: 0.85;
  margin: 0 0 0.5rem;
}
.error { color: #e57373; }
.notice { color: #9ccc9c; }
</style>
