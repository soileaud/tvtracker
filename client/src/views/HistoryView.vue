<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "../api/client";
import type { HistoryItem } from "@tvtrack/model";

const PAGE = 50;
const items = ref<HistoryItem[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const hasMore = ref(true);

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

async function loadMore() {
  loadingMore.value = true;
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
    <p v-else-if="items.length === 0">
      Nothing yet. Episodes you mark watched one by one (or fill in via gap
      detection) appear here, newest first. Season-wide backfills are skipped.
    </p>
    <ul v-else class="history">
      <li v-for="i in items" :key="`${i.showId}-${i.seasonNo}-${i.epNo}-${i.watchedAt}`">
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
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #333;
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
</style>
