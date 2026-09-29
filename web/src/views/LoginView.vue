<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const form = ref({ username: '', password: '', company_website: '' });
const errors = ref({ username: '', password: '' });
const touched = ref(false);

const busy = computed(() => auth.busy);

function validate() {
  errors.value = {
    username: form.value.username.trim() ? '' : '请填写用户名',
    password: form.value.password ? '' : '请填写密码',
  };
  return !errors.value.username && !errors.value.password;
}

async function submit() {
  touched.value = true;
  if (!validate()) return;
  const ok = await auth.login(form.value);
  if (ok) {
    form.value.password = '';
    await router.replace(String(route.query.next || '/'));
  } else {
    touched.value = false;
  }
}
</script>

<template>
  <div class="sheet-inner login-sheet">
    <header class="sheet-head">
      <h1 class="sheet-title">登录</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">游客可直接浏览与检索全部档案；登录后方可编写、修订、置顶、重排与编辑菜单。</p>
    </header>

    <form class="pane" :aria-busy="busy ? 'true' : 'false'" @submit.prevent="submit">
      <label class="field">
        <span class="field-label">用户名</span>
        <input
          v-model.trim="form.username"
          class="paper-input"
          type="text"
          name="username"
          autocomplete="username"
          :aria-invalid="Boolean(errors.username) ? 'true' : 'false'"
          :aria-describedby="errors.username ? 'err-user' : undefined"
          @blur="touched && validate()"
        />
        <span v-if="errors.username" id="err-user" class="field-error">{{ errors.username }}</span>
      </label>

      <label class="field">
        <span class="field-label">密码</span>
        <input
          v-model="form.password"
          class="paper-input"
          type="password"
          name="password"
          autocomplete="current-password"
          :aria-invalid="Boolean(errors.password) ? 'true' : 'false'"
          :aria-describedby="errors.password ? 'err-pass' : undefined"
          @blur="touched && validate()"
        />
        <span v-if="errors.password" id="err-pass" class="field-error">{{ errors.password }}</span>
      </label>

      <!-- 蜜罐：视觉隐藏且需 Tab 跳过，真人不会填、脚本常填 -->
      <label class="trap" aria-hidden="true">
        <span>公司网站（请勿填写）</span>
        <input v-model="form.company_website" type="text" tabindex="-1" autocomplete="off" />
      </label>

      <div class="row">
        <button class="paper-btn seal-press" type="submit" :disabled="busy">
          {{ busy ? '核验中…' : '用印登录' }}
        </button>
        <button class="paper-btn btn-quiet" type="button" @click="router.back()">返回浏览</button>
      </div>
    </form>

    <aside class="notice">
      <h2 class="micro-label">部署提醒</h2>
      <p>
        初始账号 <code>admin</code> / 初始口令 <code>admin</code>。按部署需求，可登录用户以
        <code>server/data/users.csv</code> 明文保存，因此<b>首次登录后应立即改名改密</b>；
        公网实例请设 <code>BW_HASH_PASSWORDS=1</code> 切换为 scrypt 存储。
      </p>
      <p>连续失败 5 次将锁定 10 分钟（按 IP 与用户名双维度计数，重启不清零）。</p>
    </aside>
  </div>
</template>

<style scoped>
.login-sheet {
  max-inline-size: 34rem;
}
.trap {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.notice {
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--anno-gold);
  padding: var(--space-4);
  font-size: var(--text-small);
  color: var(--ink-soft);
  background: var(--paper-deep);
}
.notice code {
  font-family: var(--font-mono);
  color: var(--terra-signal-ink);
}
.notice b {
  color: var(--terra-critical);
}
</style>
