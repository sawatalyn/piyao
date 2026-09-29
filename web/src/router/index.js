import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '卷首 · 档案瀑布' } },
  { path: '/post/:id', name: 'post', component: () => import('../views/PostView.vue'), meta: { title: '辟谣档案' } },
  { path: '/search', name: 'search', component: () => import('../views/SearchView.vue'), meta: { title: '检索' } },
  { path: '/tags', name: 'tags', component: () => import('../views/TagsView.vue'), meta: { title: '话题索引' } },
  { path: '/resources', name: 'resources', component: () => import('../views/ResourcesView.vue'), meta: { title: '辟谣常用资源库' } },
  { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue'), meta: { title: '洛琪希图书馆镜像' } },
  { path: '/library/:id/read', name: 'library-read', component: () => import('../views/ReaderView.vue'), meta: { title: '镜像在线阅览' } },
  { path: '/about', name: 'about', component: () => import('../views/AboutView.vue'), meta: { title: '凡例' } },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { title: '登录' } },
  {
    path: '/edit/:id?',
    name: 'edit',
    component: () => import('../views/EditorView.vue'),
    meta: { requiresAuth: true, title: '编写档案' },
  },
  {
    path: '/reorder',
    name: 'reorder',
    component: () => import('../views/ReorderView.vue'),
    meta: { requiresAuth: true, title: '卷次重排' },
  },
  {
    path: '/menu-editor',
    name: 'menu-editor',
    component: () => import('../views/MenuEditorView.vue'),
    meta: { requiresAuth: true, title: '菜单编辑' },
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('../views/UsersView.vue'),
    meta: { requiresAuth: true, title: '用户名册' },
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue'), meta: { title: '未收录' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, from, saved) => saved || (to.path === from?.path ? false : { top: 0 }),
});

/**
 * 注意：守卫的返回值会被 Vue Router 当作"重定向目标"，
 * 返回普通对象会立刻触发新一轮导航而形成死循环。这里只做副作用，不返回任何东西。
 */
router.beforeEach((to) => {
  document.title = `${to.meta.title || '辨妄阁'} · 辨妄阁辟谣档案库`;
});
