import { createRouter, createWebHistory } from "vue-router";
import LibraryView from "../views/LibraryView.vue";
import UpcomingView from "../views/UpcomingView.vue";
import HistoryView from "../views/HistoryView.vue";
import ShowDetailView from "../views/ShowDetailView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/library" },
    { path: "/upcoming", component: UpcomingView },
    { path: "/library", component: LibraryView },
    { path: "/history", component: HistoryView },
    { path: "/shows/:id", component: ShowDetailView },
  ],
});
