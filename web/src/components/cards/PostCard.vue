<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps({
  item: { type: Object, required: true },
  featured: { type: Boolean, default: false },
});

const RATING_TONE = {
  不实: 'rating-false',
  误导: 'rating-mislead',
  部分属实: 'rating-partial',
  存疑: 'rating-doubt',
};

const ratingClass = computed(() => RATING_TONE[props.item.rating] || 'rating-none');
const updated = computed(() => {
  const raw = props.item.publishedAt || props.item.updatedAt;
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
});
const overdue = computed(() => {
  const reviewAt = props.item.reviewAt;
  return Boolean(reviewAt) && new Date(reviewAt).getTime() < Date.now();
});
</script>

<template>
  <RouterLink
    class="post-card reveal"
    :class="{ 'post-card--featured': featured }"
    :to="{ name: 'post', params: { id: item.id } }"
    :data-pinned="item.pinned ? 'true' : undefined"
    :data-review-overdue="overdue ? 'true' : undefined"
    v-reveal
  >
    <div v-if="item.cover" class="card-cover">
      <img :src="item.cover" :alt="`档案插图：${item.title}`" loading="lazy" decoding="async" />
    </div>

    <p v-if="item.pinned" class="card-pin">
      <span class="seal-mark" aria-hidden="true">置顶</span>
      当前置顶档案
    </p>

    <h3 class="card-title">{{ item.title }}</h3>

    <p class="card-rumor-label">传言称</p>
    <p class="card-rumor">{{ item.excerpt || '（本条暂无谣言摘要）' }}</p>

    <p v-if="item.tags.length" class="card-tags">
      <span v-for="tag in item.tags.slice(0, featured ? 8 : 4)" :key="tag" class="slip-tag">{{ tag }}</span>
      <span v-if="item.tags.length > (featured ? 8 : 4)" class="slip-tag">+{{ item.tags.length - (featured ? 8 : 4) }}</span>
    </p>

    <div class="card-foot">
      <span v-if="item.rating" class="rating" :class="ratingClass">{{ item.rating }}</span>
      <span v-if="item.sourcePlatform" class="foot-plain">源自 {{ item.sourcePlatform }}</span>
      <span v-if="item.imageCount" class="foot-plain">图 {{ item.imageCount }}</span>
      <span v-if="item.sourceCount" class="foot-plain">材料 {{ item.sourceCount }}</span>
      <span v-if="overdue" class="foot-warn">待复核</span>
      <time v-if="updated" class="foot-plain" :datetime="updated">{{ updated }}</time>
    </div>
  </RouterLink>
</template>

<style scoped>
.post-card--featured {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 0 var(--space-5);
}
.post-card--featured .card-cover {
  grid-row: span 5;
  margin-block-end: 0;
}
.post-card--featured .card-title {
  font-size: var(--text-head);
}
.post-card--featured .card-rumor {
  font-size: var(--text-body);
}

.card-pin {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  font-size: var(--text-micro);
  letter-spacing: 0.14em;
  color: var(--terra-signal-ink);
}
.seal-mark {
  display: inline-grid;
  place-items: center;
  inline-size: 2.4em;
  block-size: 2.4em;
  border: 2px solid currentColor;
  border-radius: var(--control-radius);
  font-family: var(--font-display);
  font-size: 0.95em;
  letter-spacing: 0;
  writing-mode: vertical-rl;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: var(--space-3) 0 0;
}

.rating {
  font-family: var(--font-display);
  font-size: var(--text-micro);
  letter-spacing: 0.1em;
  padding: 1px 6px;
  border: var(--grid-rule) solid currentColor;
  border-radius: var(--control-radius);
}
.rating-false {
  color: var(--terra-critical);
}
.rating-mislead {
  color: var(--anno-gold);
}
.rating-partial {
  color: var(--anno-indigo);
}
.rating-doubt {
  color: var(--ink-mute);
}
.rating-none {
  color: var(--rule-firm);
}

.foot-warn {
  color: var(--terra-signal-ink);
  letter-spacing: 0.1em;
}
.foot-plain {
  color: var(--ink-mute);
}

@media (max-width: 620px) {
  .post-card--featured {
    grid-template-columns: minmax(0, 1fr);
  }
  .post-card--featured .card-cover {
    grid-row: auto;
    margin-block-end: var(--space-3);
  }
}
</style>
