<template>
  <nav>
    <RouterLink to="/library">Library</RouterLink>
    <RouterLink to="/upcoming">Upcoming</RouterLink>
    <RouterLink to="/history">History</RouterLink>
  </nav>
  <RouterView />
</template>

<style scoped>
nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
nav a {
  flex: 1;
  text-align: center;
  text-decoration: none;
  color: var(--muted);
  font-weight: 600;
  padding: 0.6rem 0;
  border-radius: 999px;
  border: 1px solid transparent;
}
nav a.router-link-active {
  color: var(--text);
  background: var(--accent-bg, rgba(128, 128, 128, 0.15));
  border-color: var(--accent-border, var(--border));
}
</style>
