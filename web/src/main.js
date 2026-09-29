import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { vReveal } from './directives/reveal.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/motion.css';
import './styles/layout.css';

createApp(App).use(createPinia()).use(router).directive('reveal', vReveal).mount('#app');
