import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'

createApp(App).use(router).mount('#app')

// PWA: cache the app shell for flaky Wi-Fi. Prod only — in dev it would
// serve stale assets. See docs/pwa.md (needs HTTPS for full offline on LAN).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
