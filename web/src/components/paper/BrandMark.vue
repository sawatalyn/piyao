<script setup>
// 原始设计：版框 + 界栏 + 单字「辨」；不含任何官方标识或美术资源
</script>

<template>
  <svg
    class="mark"
    viewBox="0 0 64 64"
    role="img"
    aria-label="辨妄阁标识：版框内书辨字"
    focusable="false"
  >
    <rect x="2.5" y="2.5" width="59" height="59" fill="none" stroke="currentColor" stroke-width="3" />
    <rect x="9" y="9" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1" opacity="0.55" />
    <path d="M9 9 L16 9 M55 9 L48 9 M9 55 L16 55 M55 55 L48 55" stroke="currentColor" stroke-width="1" opacity="0.4" />
    <g class="glyph" transform="translate(32 34)">
      <text
        x="0"
        y="0"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Songti SC, STSong, Noto Serif SC, SimSun, serif"
        font-size="30"
        font-weight="700"
        fill="currentColor"
      >
        辨
      </text>
    </g>
    <path d="M20 47 L44 47" stroke="currentColor" stroke-width="1" opacity="0.35" />
  </svg>
</template>

<style scoped>
.mark {
  color: var(--terra-ink);
  display: block;
}
</style>
