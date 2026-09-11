<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "../api/client";
import type { HistoryItem } from "@tvtrack/model";

const PAGE = 50;
const ACTION_W = 96;
const items = ref<HistoryItem[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const hasMore = ref(true);
type Side = "left" | "right";
const openAction = ref<{ key: number; side: Side } | null>(null);
const drag = ref<{ key: number; startX: number; base: number; dx: number } | null>(null);

function rowKey(i: HistoryItem): number {
  return i.episodeId;
}

function epLabel(i: HistoryItem): string {
  const ep = i.epNo != null ? `E${i.epNo}` : "Special";
  return `S${i.seasonNo} ${ep}`;
}

function whenLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function loadMore() {  loadingMore.value = true;
  error.value = null;
  try {
    const res = await api.history(PAGE, items.value.length);
    items.value.push(...res.items);
    if (res.items.length < PAGE) hasMore.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingMore.value = false;
  }
}

/**
 * Bidirectional swipe. Left reveals "Clear date" (stay watched, leave
 * History — for backfills); right reveals "Unwatch". Pointer events cover
 * touch + mouse drag; touch-action: pan-y keeps vertical scrolling native.
 */
function openSide(i: HistoryItem): Side | null {
  const o = openAction.value;
  return o && o.key === rowKey(i) ? o.side : null;
}

function contentStyle(i: HistoryItem): Record<string, string> {
  const k = rowKey(i);
  if (drag.value?.key === k) return { transform: `translateX(${drag.value.dx}px)` };
  const side = openSide(i);
  if (side === "left") return { transform: `translateX(${-ACTION_W}px)` };
  if (side === "right") return { transform: `translateX(${ACTION_W}px)` };
  return {};
}

function onSwipeStart(e: PointerEvent, i: HistoryItem) {
  const k = rowKey(i);
  if (openAction.value && openAction.value.key !== k) openAction.value = null;
  const base = openSide(i) === "right" ? ACTION_W : openSide(i) === "left" ? -ACTION_W : 0;
  drag.value = { key: k, startX: e.clientX, base, dx: base };
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onSwipeMove(e: PointerEvent, i: HistoryItem) {
  const d = drag.value;
  if (!d || d.key !== rowKey(i)) return;
  if (e.pointerType === "mouse" && e.buttons === 0) return;
  d.dx = Math.min(ACTION_W + 24, Math.max(-ACTION_W - 24, d.base + (e.clientX - d.startX)));
}

function onSwipeEnd(_e: PointerEvent, i: HistoryItem) {
  const d = drag.value;
  if (!d || d.key !== rowKey(i)) return;
  if (d.dx < -ACTION_W / 2) openAction.value = { key: d.key, side: "left" };
  else if (d.dx > ACTION_W / 2) openAction.value = { key: d.key, side: "right" };
  else if (openAction.value?.key === d.key) openAction.value = null;
  drag.value = null;
}

/** Tapping an open row's content closes it instead of following links. */
function onContentClick(e: Event, i: HistoryItem) {
  if (openSide(i)) {
    e.preventDefault();
    e.stopPropagation();
    openAction.value = null;
  }
}

function dropRow(i: HistoryItem) {
  const k = rowKey(i);
  items.value = items.value.filter((x) => rowKey(x) !== k);
  if (openAction.value?.key === k) openAction.value = null;
}

async function unwatch(i: HistoryItem) {
  try {
    await api.setWatched(i.episodeId, false);
    dropRow(i);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function clearDate(i: HistoryItem) {
  try {
    await api.clearWatchDate(i.episodeId);
    dropRow(i);
    notice.value = "Date removed — episode stays marked watched.";
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  try {
    const res = await api.history(PAGE, 0);
    items.value = res.items;
    if (res.items.length < PAGE) hasMore.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main>
    <h1>History</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-if="notice && !loading && !error" class="notice">{{ notice }}</p>
    <p v-else-if="items.length === 0">
      Nothing yet. Episodes you mark watched one by one (or fill in via gap
      detection) appear here, newest first. Season-wide backfills are skipped.
    </p>
    <ul v-else class="history">
      <li v-for="i in items" :key="rowKey(i)" class="swipe-row">
        <div class="swipe-actions left">
          <button
            class="unwatch-btn"
            tabindex="-1"
            @click="unwatch(i)"
            :aria-label="`Mark ${i.title} unwatched`"
          >
            Unwatch
          </button>
        </div>
        <div class="swipe-actions right">
          <button
            class="clear-btn"
            tabindex="-1"
            @click="clearDate(i)"
            :aria-label="`Remove watch date from ${i.title}, keep watched`"
          >
            Clear date
          </button>
        </div>
        <div
          class="swipe-content"
          :class="{ dragging: drag?.key === rowKey(i) }"
          :style="contentStyle(i)"
          @pointerdown="onSwipeStart($event, i)"
          @pointermove="onSwipeMove($event, i)"
          @pointerup="onSwipeEnd($event, i)"
          @pointercancel="onSwipeEnd($event, i)"
          @click.capture="onContentClick($event, i)"
        >
          <img
            v-if="i.posterUrl"
            :src="i.posterUrl"
            :alt="`${i.showName} poster`"
            loading="lazy"
          />
          <div v-else class="poster-fallback" aria-hidden="true" />
          <div class="history-body">
            <RouterLink :to="`/shows/${i.showId}`" class="title">
              {{ i.showName }} — {{ epLabel(i) }} “{{ i.title }}”
            </RouterLink>
            <div class="meta">{{ whenLabel(i.watchedAt) }}</div>
          </div>
        </div>
      </li>
    </ul>
    <button
      v-if="hasMore && !loading"
      class="ghost-pill"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ loadingMore ? "Loading…" : "More" }}
    </button>
  </main>
</template>

<style scoped>
.history {
  list-style: none;
  padding: 0;
  margin: 0;
}
.history li {
  border-bottom: 1px solid #333;
}
.swipe-row {
  position: relative;
  overflow: hidden;
}
.swipe-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 96px;
  display: flex;
}
.swipe-actions.right {
  right: 0;
}
.swipe-actions.left {
  left: 0;
}
.unwatch-btn {
  flex: 1;
  border: none;
  border-radius: 0;
  background: var(--danger, #b3261e);
  color: #fff;
  font-weight: 700;
  min-height: 0;
  margin: 0;
  padding: 0.5rem;
}
.clear-btn {
  flex: 1;
  border: none;
  border-radius: 0;
  background: var(--accent-bg, rgba(128, 128, 128, 0.25));
  color: var(--text);
  font-weight: 700;
  min-height: 0;
  margin: 0;
  padding: 0.5rem;
}
.swipe-content {
  position: relative;
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 0;
  background: var(--bg);
  touch-action: pan-y;
  transition: transform 0.18s ease;
}
.swipe-content.dragging {
  transition: none;
}
.history img,
.poster-fallback {
  width: 48px;
  height: 68px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.poster-fallback {
  background: #333;
}
.history-body {
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 600;
}
.meta {
  opacity: 0.75;
  font-size: 0.9rem;
}
button {
  min-height: 44px;
  padding: 0.5rem 1.5rem;
  margin: 1rem 0;
}
.ghost-pill {
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  font-weight: 600;
}
.error {
  color: #e57373;
}
.notice {
  color: var(--notice, #9ccc9c);
}
</style>
