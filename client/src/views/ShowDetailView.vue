<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type EpisodeFileState, type ShowDetailResponse, type SonarrStatus } from "../api/client";
import type { ShowStatus } from "@tvtrack/model";

const STALE_DAYS = 14;

const route = useRoute();
const router = useRouter();
const showId = Number(route.params.id);
const detail = ref<ShowDetailResponse | null>(null);
const activeSeason = ref<string | null>(null);
const error = ref<string | null>(null);
const noteDraft = ref<string | null>(null);
const sonarr = ref<SonarrStatus | null>(null);
const sonarrFiles = ref<Map<string, EpisodeFileState>>(new Map());

async function reload() {
  error.value = null;
  try {
    detail.value = await api.showDetail(showId);
    if (noteDraft.value === null) noteDraft.value = detail.value.note ?? "";
    if (!activeSeason.value) {
      // Default to the season holding the next unwatched episode;
      // when fully caught up, land on the most recent (last) season.
      const seasons = detail.value.seasons;
      activeSeason.value =
        detail.value.nextUnwatched?.seasonId ??
        seasons[seasons.length - 1]?.season.id ??
        null;
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function loadSonarr() {
  try {
    const [status, eps] = [await api.sonarrStatus(showId), await api.sonarrEpisodes(showId)];
    sonarr.value = status;
    sonarrFiles.value = new Map(
      (eps.files ?? []).map((f) => [`${f.seasonNo}:${f.number}`, f]),
    );
  } catch {
    sonarr.value = null; // Sonarr down/unreachable: hide the section silently.
  }
}

function fileBadge(seasonNo: number, num: number | null, airstamp: string | null): string | null {
  if (sonarr.value?.matched !== true || num == null) return null;
  const f = sonarrFiles.value.get(`${seasonNo}:${num}`);
  if (!f) return null;
  if (f.downloading) return "⬇ downloading";
  if (f.hasFile) return null; // No noise when the file is there.
  if (!f.monitored) return null;
  if (airstamp && new Date(airstamp).getTime() > Date.now()) return null;
  return "missing file";
}

const showEnded = computed(
  () => detail.value?.show.showStatus === "Ended" && detail.value?.status !== "Ended",
);

const lastSynced = computed(() => detail.value?.show.lastSyncedAt ?? null);
const isStale = computed(
  () =>
    !lastSynced.value ||
    Date.now() - new Date(lastSynced.value).getTime() > STALE_DAYS * 86_400_000,
);

async function setRating(rating: number | null) {
  try {
    await api.patchSubscription(showId, { rating });
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function saveNote() {
  try {
    await api.patchSubscription(showId, { note: noteDraft.value?.trim() ? noteDraft.value : null });
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const isNoteDirty = computed(
  () => noteDraft.value !== null && noteDraft.value !== (detail.value?.note ?? ""),
);

async function autoSaveNote() {
  if (isNoteDirty.value) await saveNote();
}

const seasonFullyWatched = computed(() =>
  season.value
    ? season.value.progress.total > 0 &&
      season.value.progress.watched === season.value.progress.total
    : false,
);

async function toggleSeasonWatched() {
  if (activeSeason.value) await api.setSeasonWatched(activeSeason.value, !seasonFullyWatched.value);
  await reload();
}

const season = computed(() =>
  detail.value?.seasons.find((s) => s.season.id === activeSeason.value),
);

/** Compact chip label: bare names, "x left" on the in-progress season. */
function seasonTabLabel(seasonNo: number, watched: number, total: number): string {
  const name = seasonNo === 0 ? "Specials" : `S${seasonNo}`;
  if (total > 0 && watched === total) return `✓ ${name}`;
  if (watched > 0) return `${name} · ${total - watched} left`;
  return name;
}

async function toggle(
  ep: { tvmazeId: number; seasonNo: number; number: number | null; title: string },
  watched: boolean,
) {
  await api.setWatched(ep.tvmazeId, watched);
  await reload();
}

interface PendingGap {
  ep: { tvmazeId: number; seasonNo: number; number: number | null; title: string };
  gaps: string[];
}
const pendingGap = ref<PendingGap | null>(null);

/**
 * Checkbox clicks are intercepted (never toggle natively) so a dismissed
 * prompt leaves the UI exactly as it was — no reload needed on cancel.
 */
async function onEpClick(ep: {
  tvmazeId: number;
  seasonNo: number;
  number: number | null;
  title: string;
  watched: boolean;
}) {
  if (ep.watched || !detail.value) {
    await toggle(
      { tvmazeId: ep.tvmazeId, seasonNo: ep.seasonNo, number: ep.number, title: ep.title },
      false,
    );
    return;
  }
  const gaps = earlierUnwatched(ep.tvmazeId);
  if (gaps.length === 0) {
    await toggle(
      { tvmazeId: ep.tvmazeId, seasonNo: ep.seasonNo, number: ep.number, title: ep.title },
      true,
    );
    return;
  }
  pendingGap.value = {
    ep: { tvmazeId: ep.tvmazeId, seasonNo: ep.seasonNo, number: ep.number, title: ep.title },
    gaps,
  };
}

async function confirmGapAll() {
  if (!pendingGap.value) return;
  await api.watchUpToHere(pendingGap.value.ep.tvmazeId);
  pendingGap.value = null;
  await reload();
}

async function confirmGapOne() {
  if (!pendingGap.value) return;
  await api.setWatched(pendingGap.value.ep.tvmazeId, true);
  pendingGap.value = null;
  await reload();
}

function pendingEpTag(): string {
  const ep = pendingGap.value?.ep;
  if (!ep) return "";
  return ep.number != null ? `S${ep.seasonNo}E${ep.number}` : ep.title;
}

/** Unwatched episodes airing before the target, in air order (server mirrors this). */
function earlierUnwatched(targetId: number): string[] {
  if (!detail.value) return [];
  const all = detail.value.seasons.flatMap((s) =>
    s.episodes.map((e) => ({ ...e, seasonNo: s.season.seasonNo })),
  );
  const ordered = all.sort(
    (a, b) =>
      a.seasonNo - b.seasonNo ||
      (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER),
  );
  const idx = ordered.findIndex((e) => e.tvmazeId === targetId);
  if (idx < 0) return [];
  return ordered
    .slice(0, idx)
    .filter((e) => !e.watched)
    .map((e) => (e.number != null ? `S${e.seasonNo}E${e.number}` : e.title));
}

function jumpToNext() {
  // The target may live in a different season tab — switch there first,
  // then scroll once the newly rendered row exists.
  const target = detail.value?.nextUnwatched;
  if (!target) return;
  activeSeason.value = target.seasonId;
  nextTick(() => {
    document
      .querySelector("[data-next-unwatched]")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function refresh() {
  await api.refreshShow(showId);
  await reload();
}

async function setStatus(status: ShowStatus) {
  try {
    await api.setStatus(showId, status);
    await reload();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const pendingRemove = ref(false);

function requestRemove() {
  if (!detail.value) return;
  pendingRemove.value = true;
}

function cancelRemove() {
  pendingRemove.value = false;
}

async function confirmRemove() {
  if (!detail.value) return;
  try {
    await api.unsubscribe(showId);
    pendingRemove.value = false;
    router.push("/library");
  } catch (e) {
    pendingRemove.value = false;
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  await reload();
  await loadSonarr();
});
</script>

<template>
  <main v-if="detail">
    <header class="show-header">
      <img
        v-if="detail.show.posterUrl"
        :src="detail.show.posterUrl"
        :alt="`${detail.show.name} poster`"
      />
      <div v-else class="poster-fallback" aria-hidden="true" />
      <div>
        <h1>{{ detail.show.name }}</h1>
        <p class="meta">
          {{ detail.show.network }} · {{ detail.progress.watched }}/{{ detail.progress.total }} watched
        </p>
        <p class="meta small">
          Synced {{ detail.show.lastSyncedAt ? new Date(detail.show.lastSyncedAt).toLocaleDateString() : "never" }}
          <span v-if="isStale" class="stale" title="Not refreshed in 14+ days">stale</span>
        </p>
      </div>
    </header>
    <div v-if="showEnded" class="banner">
      This show has ended.
      <button class="ghost-pill" @click="setStatus('Ended')">Move to Ended</button>
    </div>
    <div class="row controls">
      <button v-if="detail.nextUnwatched" class="btn-primary" @click="jumpToNext">Next unwatched</button>
      <button
        class="icon-btn"
        @click="refresh"
        title="Refresh from TVMaze"
        aria-label="Refresh from TVMaze"
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
      <button
        class="icon-btn danger"
        @click="requestRemove"
        title="Remove show"
        aria-label="Remove show"
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
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
      <select
        v-if="detail.status"
        class="pill-select"
        :value="detail.status"
        @change="setStatus(($event.target as HTMLSelectElement).value as ShowStatus)"
        aria-label="Subscription status"
      >
        <option>Watching</option>
        <option>Backlog</option>
        <option>Paused</option>
        <option>Ended</option>
      </select>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="personal">
      <div class="stars" role="group" aria-label="Your rating">
        <button
          v-for="n in 5"
          :key="n"
          :class="{ lit: (detail.rating ?? 0) >= n }"
          @click="setRating(detail.rating === n ? null : n)"
          :title="`${n} star${n === 1 ? '' : 's'}`"
        >
          ★
        </button>
        <span v-if="detail.rating" class="meta small">{{ detail.rating }}/5 — tap again to clear</span>
      </div>
      <textarea
        v-model="noteDraft"
        rows="2"
        placeholder="Private note… (saves automatically)"
        @blur="autoSaveNote"
      />
      <span v-if="isNoteDirty" class="meta small">Unsaved changes…</span>
    </section>

    <section v-if="sonarr?.matched" class="sonarr">
      <p class="meta">
        Sonarr: {{ sonarr.withFiles }}/{{ sonarr.total }} files{{
          sonarr.downloadingCount ? ` · ${sonarr.downloadingCount} downloading` : ""
        }}{{ sonarr.monitored === false ? " · unmonitored" : "" }}
      </p>
    </section>

    <div class="tabs" role="tablist" aria-label="Seasons">
      <button
        v-for="s in detail.seasons"
        :key="s.season.id"
        role="tab"
        :class="{
          tab: true,
          active: s.season.id === activeSeason,
          done: s.progress.total > 0 && s.progress.watched === s.progress.total,
          partial: s.progress.watched > 0 && s.progress.watched < s.progress.total,
        }"
        :title="`${s.progress.watched}/${s.progress.total} watched`"
        @click="activeSeason = s.season.id"
      >
        {{ seasonTabLabel(s.season.seasonNo, s.progress.watched, s.progress.total) }}
      </button>
    </div>

    <section v-if="season">
      <div class="row">
        <button class="ghost-pill" @click="toggleSeasonWatched">
          {{ seasonFullyWatched ? "Mark season unwatched" : "Mark season watched" }}
        </button>
      </div>
      <ul class="eps">
        <li
          v-for="e in season.episodes"
          :key="e.tvmazeId"
          :data-next-unwatched="detail.nextUnwatched?.tvmazeId === e.tvmazeId || undefined"
          :class="{ next: detail.nextUnwatched?.tvmazeId === e.tvmazeId }"
        >
          <input
            type="checkbox"
            :checked="e.watched"
            @click.prevent="onEpClick(e)"
            :aria-label="`Mark ${e.title} ${e.watched ? 'unwatched' : 'watched'}`"
          />
          <span class="ep-main">
            <div class="ep-head">
              <span>
                <strong v-if="e.number != null">E{{ e.number }}</strong>
                {{ e.title }}
                <small class="airdate">{{ e.airdate }}</small>
                <small v-if="fileBadge(e.seasonNo, e.number, e.airstamp)" class="filebadge">{{
                  fileBadge(e.seasonNo, e.number, e.airstamp)
                }}</small>
              </span>
            </div>
            <img
              v-if="e.imageUrl"
              :src="e.imageUrl"
              :alt="''"
              loading="lazy"
              class="ep-still"
            />
            <p v-if="e.summary" class="summary">{{ e.summary }}</p>
          </span>
        </li>
      </ul>
    </section>
    <div
      v-if="pendingGap"
      class="modal-backdrop"
      @click.self="pendingGap = null"
      role="dialog"
      aria-modal="true"
      aria-label="Unwatched earlier episodes"
    >
      <div class="modal">
        <p>
          {{ pendingGap.gaps.slice(0, 5).join(", ")
          }}{{ pendingGap.gaps.length > 5 ? ` +${pendingGap.gaps.length - 5} more` : "" }}
          {{ pendingGap.gaps.length === 1 ? "is" : "are" }} still unwatched.
        </p>
        <button class="btn-primary" @click="confirmGapAll">
          Mark all through {{ pendingEpTag() }}
        </button>
        <button class="ghost-pill" @click="confirmGapOne">Only this episode</button>
        <button class="link-btn" @click="pendingGap = null">Cancel</button>
      </div>
    </div>
    <div
      v-if="pendingRemove"
      class="modal-backdrop"
      @click.self="cancelRemove"
      role="dialog"
      aria-modal="true"
      aria-label="Remove show"
    >
      <div class="modal">
        <p><strong>Remove “{{ detail.show.name }}”?</strong></p>
        <p class="meta small">
          This removes it from your library and deletes its watched history. This cannot be undone.
        </p>
        <button class="btn-danger" @click="confirmRemove">Remove show</button>
        <button class="link-btn" @click="cancelRemove">Cancel</button>
      </div>
    </div>
  </main>
  <main v-else>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else>Loading…</p>
  </main>
</template>

<style scoped>
.show-header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}
.show-header img,
.show-header .poster-fallback {
  width: 96px;
  height: 136px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}
.show-header .poster-fallback {
  background: #333;
}
.show-header h1 {
  margin: 0 0 0.25rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.75rem 0;
}
.controls {
  align-items: center;
}
.btn-primary {
  flex: 1;
  min-height: 48px;
  border-radius: 999px;
  border: none;
  background: var(--link);
  color: #fff;
  font-weight: 700;
  padding: 0.5rem 1.25rem;
}
.btn-danger {
  flex: 1;
  min-height: 48px;
  border-radius: 999px;
  border: none;
  background: var(--danger, #b3261e);
  color: #fff;
  font-weight: 700;
  padding: 0.5rem 1.25rem;
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
  font-size: 1.35rem;
  padding: 0;
  display: grid;
  place-content: center;
}
.icon-btn.danger {
  color: var(--danger, #e57373);
  border-color: var(--danger, #e57373);
}
.icon-btn svg {
  display: block;
}
.pill-select {
  min-height: 48px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  font-weight: 600;
  padding: 0.5rem 0.9rem;
}
.ghost-pill {
  min-height: 44px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  font-weight: 600;
  padding: 0.5rem 1.1rem;
}
.link-btn {
  background: none;
  border: none;
  color: var(--muted);
  min-height: 44px;
  font-weight: 600;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-content: center;
  padding: 1.5rem;
  z-index: 50;
}
.modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem;
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.modal p {
  margin: 0 0 0.4rem;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}
.tab {
  flex: 0 1 auto;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-weight: 600;
  white-space: nowrap;
}
.tab.done {
  opacity: 0.55;
}
.tab.partial {
  color: var(--text);
  border-color: var(--link);
}
.tab.active {
  opacity: 1;
  color: var(--text);
  background: var(--accent-bg, rgba(128, 128, 128, 0.15));
  border-color: var(--accent-border, var(--link));
}
.eps {
  list-style: none;
  padding: 0;
}
.eps li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #333;
}
.eps li.next {
  background: rgba(255, 255, 255, 0.06);
}
.eps input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--muted, #888);
  background: transparent;
  margin: 0;
  cursor: pointer;
  display: grid;
  place-content: center;
}
.eps input[type="checkbox"]::before {
  content: "✓";
  font-size: 1rem;
  line-height: 1;
  transform: scale(0);
  color: var(--text);
}
.eps input[type="checkbox"]:checked {
  border-color: var(--link);
}
.eps input[type="checkbox"]:checked::before {
  transform: scale(1);
}
.ep-main {
  flex: 1;
  min-width: 0;
}
.ep-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ep-head > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.airdate {
  white-space: nowrap;
}
.ep-still {
  float: left;
  width: 38%;
  max-width: 220px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 4px;
  margin: 0.4rem 0.75rem 0.25rem 0;
}
.summary {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  opacity: 0.8;
}
button {
  min-height: 44px;
}
small {
  opacity: 0.7;
  margin-left: 0.5rem;
}
.error { color: #e57373; }
.meta { opacity: 0.8; }
.meta.small { font-size: 0.85rem; }
.stale {
  font-size: 0.75rem;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 0.35rem;
  opacity: 0.8;
}
.banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid currentColor;
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  margin: 0.5rem 0;
}
.personal {
  margin: 1rem 0;
}
.stars {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin-bottom: 0.5rem;
}
.stars button {
  background: none;
  border: none;
  font-size: 1.6rem;
  min-height: 44px;
  min-width: 44px;
  opacity: 0.35;
  padding: 0;
}
.stars button.lit {
  opacity: 1;
}
.personal textarea {
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
}
.sonarr {
  margin: 0.5rem 0;
}
.filebadge {
  color: #e0a100;
}
</style>
