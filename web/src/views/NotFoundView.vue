<script setup>
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">未收录</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">卷内查无此页。可能是档案已被删除，或链接抄录有误。</p>
    </header>
    <div class="row">
      <RouterLink class="paper-btn" :to="{ name: 'home' }">返回卷首</RouterLink>
      <RouterLink class="paper-btn btn-quiet" :to="{ name: 'search' }">去检索</RouterLink>
    </div>
  </div>
</template>
