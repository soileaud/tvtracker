<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "../api/client";
import type { UpcomingBucket, UpcomingItem } from "@tvtrack/model";

const PAGE = 30;
const BUCKET_ORDER: UpcomingBucket[] = [
  "This week",
  "Next week",
  "Later this month",
  "Next month",
  "60 days",
  "90+ days",
];
const items = ref<UpcomingItem[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const hasMore = ref(true);

const groups = computed(() =>
  BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: items.value.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length > 0),
);

function epLabel(i: UpcomingItem): string {
  const ep = i.epNo != null ? `E${i.epNo}` : "Special";
  return `S${i.seasonNo}${ep}`;
}

async function loadMore() {
  loadingMore.value = true;
  error.value = null;
  try {
    const res = await api.upcoming(PAGE, items.value.length);
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
    const res = await api.upcoming(PAGE, 0);
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
    <h1>Upcoming</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="items.length === 0">Nothing upcoming. Add shows in the Library.</p>
    <template v-else>
      <section v-for="g in groups" :key="g.bucket">
        <h2>{{ g.bucket }}</h2>
        <ul class="agenda">
          <li
            v-for="i in g.items"
            :key="`${i.showId}-${i.seasonNo}-${i.epNo}-${i.airstamp}`"
          >
            <img
              v-if="i.posterUrl"
              :src="i.posterUrl"
              :alt="`${i.showName} poster`"
              loading="lazy"
            />
            <div v-else class="poster-fallback" aria-hidden="true" />
            <div class="agenda-body">
              <RouterLink :to="`/shows/${i.showId}`" class="title">
                {{ i.showName }} — {{ epLabel(i) }} “{{ i.title }}”
              </RouterLink>
              <div class="meta">{{ i.centralDisplay }} · {{ i.countdown }}</div>
              <p v-if="i.summary" class="summary">{{ i.summary }}</p>
            </div>
          </li>
        </ul>
      </section>
    </template>
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
h2 {
  margin: 1.5rem 0 0.25rem;
  font-size: 1.1rem;
  opacity: 0.9;
}
.agenda {
  list-style: none;
  padding: 0;
  margin: 0;
}
.agenda li {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #333;
}
.agenda img,
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
.agenda-body {
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
.summary {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  opacity: 0.85;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
