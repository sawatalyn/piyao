<script setup>
import { onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from './components/layout/AppHeader.vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import AppFooter from './components/layout/AppFooter.vue';
import ToastStack from './components/paper/ToastStack.vue';
import { useAuthStore } from './stores/auth.js';
import { useCatalogStore } from './stores/catalog.js';
import { useMenuStore } from './stores/menu.js';
import { useResourceStore } from './stores/resources.js';
import { useLibraryStore } from './stores/library.js';
import { useUiStore } from './stores/ui.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const menu = useMenuStore();
const resources = useResourceStore();
const library = useLibraryStore();
const ui = useUiStore();

async function guardAuth() {
  if (!route.meta.requiresAuth) return;
  if (auth.ready && !auth.isAuthed) {
    ui.notify('该功能仅登录后可用，请先登录', 'error', true);
    await router.replace({ name: 'login', query: { next: route.fullPath } });
  }
}

onMounted(async () => {
  await auth.fetchMe();
  await Promise.all([catalog.bootstrap(), menu.load(), resources.load(), library.load()]);
  await guardAuth();
});

watch([() => route.fullPath, () => auth.isAuthed], guardAuth);
</script>

<template>
  <a class="skip-link" href="#main">跳至卷身</a>
  <div class="shell" :data-margin-open="String(ui.marginOpen)">
    <AppHeader />
    <AppSidebar />
    <main id="main" class="sheet-main">
      <RouterView v-slot="{ Component }">
        <Transition name="veil">
          <component :is="Component" class="route-veil" />
        </Transition>
      </RouterView>
    </main>
    <AppFooter />
  </div>
  <ToastStack />
</template>

<style scoped>
.veil-enter-active {
  transition: opacity 200ms var(--ease-archive);
}
.veil-enter-from {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .veil-enter-active {
    transition: none;
  }
}
</style>
