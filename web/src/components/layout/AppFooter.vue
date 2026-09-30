<script setup>
import { computed } from 'vue';
import licenses from '../../generated/licenses.json';
import { useCatalogStore } from '../../stores/catalog.js';

const catalog = useCatalogStore();

const packages = computed(() => licenses.packages);
const runtimes = licenses.runtimes;
const referenced = licenses.referenced;

/** 出处只放行 http(s)：登记表由脚本实测生成，渲染前仍按协议再筛一道 */
const homeOf = (row) => {
  const url = String(row?.home || '');
  return /^https?:\/\//i.test(url) ? url : '';
};
const homeLabel = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'github.com' ? 'GitHub' : host;
  } catch {
    return '出处';
  }
};
const roleOf = (row) =>
  row.purpose ||
  (row.workspace ? `${row.workspace === 'web' ? '前端' : '后端'}${row.kind === '运行时' ? '运行时' : '构建期'}` : '');
const roleTag = (row) => (row.workspace === 'web' ? (row.kind === '运行时' ? '运行时' : '构建期') : '后端');
</script>

<template>
  <footer class="shell-foot">
    <div class="foot-inner">
      <!-- 卷尾折叠文书块：本站体例与复核规则，均为真实约束 -->
      <section class="foot-petition">
        <h2 class="foot-title">卷尾 · 体例与复核</h2>
        <dl class="foot-rules">
          <dt>结论判定</dt>
          <dd>四级：<b>不实</b>（证据与主张相反）、<b>误导</b>（片段真实但推论不成立）、<b>部分属实</b>（含真实成分需限定条件）、<b>存疑</b>（证据不足，暂不背书）。</dd>
          <dt>复核期限</dt>
          <dd>每条档案登记复核日；逾期条目在批注栏清单上以印朱边标记提示重检。</dd>
          <dt>纠错通道</dt>
          <dd>登录后可在详情页直接修订，修订保留修订人与时间，原文与结论同时留档。</dd>
          <dt>材料源</dt>
          <dd>须登记来源机构、采集时刻与结论指向；无出处的断言不进入辟谣侧。</dd>
        </dl>
        <p class="foot-stats">
          现收录 <b class="tabular">{{ catalog.stats.total }}</b> 条档案 ·
          话题 <b class="tabular">{{ catalog.stats.tagged }}</b> 个 ·
          材料源 <b class="tabular">{{ catalog.stats.sources }}</b> 条
        </p>
      </section>

      <section>
        <h2 class="foot-title">本页所用框架与开源协议</h2>
        <div class="table-scroll">
        <table class="lic-table">
          <caption>许可信息由构建脚本从已安装依赖的 package.json 实测生成（{{ licenses.generatedAt.slice(0, 10) }}）</caption>
          <thead>
            <tr>
              <th scope="col">组件</th>
              <th scope="col">版本</th>
              <th scope="col">协议</th>
              <th scope="col">角色</th>
              <th scope="col">官网 / 仓库</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in packages" :key="row.name">
              <th scope="row">{{ row.name }}</th>
              <td class="tabular">{{ row.installed }}</td>
              <td>{{ row.license }}</td>
              <td>{{ roleOf(row) }}<span v-if="roleTag(row)" class="role-tag">（{{ roleTag(row) }}）</span></td>
              <td>
                <a v-if="homeOf(row)" :href="homeOf(row)" target="_blank" rel="noopener noreferrer nofollow">{{ homeLabel(homeOf(row)) }}</a>
                <span v-else class="role-tag">未声明</span>
              </td>
            </tr>
            <tr v-for="row in runtimes" :key="row.name">
              <th scope="row">{{ row.name }}</th>
              <td class="tabular">{{ row.installed }}</td>
              <td>{{ row.license }}</td>
              <td>{{ row.role }}</td>
              <td>
                <a v-if="homeOf(row)" :href="homeOf(row)" target="_blank" rel="noopener noreferrer nofollow">{{ homeLabel(homeOf(row)) }}</a>
                <span v-else class="role-tag">未声明</span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>

        <h3 class="foot-sub">外部参照与使用边界</h3>
        <ul class="foot-refs">
          <li v-for="row in referenced" :key="row.name">
            <code>{{ row.name }}</code>
            <a v-if="homeOf(row)" class="ref-home" :href="homeOf(row)" target="_blank" rel="noopener noreferrer nofollow">{{ homeLabel(homeOf(row)) }}</a>
            · {{ row.license }} · <b>{{ row.used }}</b>
            <span class="ref-note">{{ row.note }}</span>
          </li>
        </ul>

        <p class="foot-legal">
          界面语法为证据驱动的 Terra 阵营界面（受《明日方舟》世界观启发），与任何官方产品无关；
          本站未使用、未复制任何官方标识、阵营徽记、角色美术、关键视觉或 CDN 资源。
          版式仅参照通用 wiki 类站点的四段式信息架构，未复制其文本、图片、样式或商标。
          字体走本机字体栈，不加载第三方字体文件。
        </p>
      </section>
    </div>
  </footer>
</template>

<style scoped>
.foot-rules {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--text-small);
}
.foot-rules dt {
  font-family: var(--font-display);
  color: var(--band-ink-strong);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.foot-rules dd {
  margin: 0;
  color: var(--band-ink-mute);
  line-height: 1.7;
}
.foot-rules b {
  color: var(--anno-gold);
  font-weight: 700;
}
.foot-stats {
  margin: var(--space-4) 0 0;
  font-size: var(--text-small);
  color: var(--band-ink-mute);
}
.foot-stats b {
  color: var(--band-ink-strong);
}
.foot-sub {
  font-family: var(--font-display);
  font-size: var(--text-body);
  letter-spacing: 0.12em;
  color: var(--band-ink-strong);
  margin: var(--space-5) 0 var(--space-3);
}
.foot-refs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  font-size: var(--text-small);
  color: var(--band-ink-mute);
}
.foot-refs b {
  color: var(--anno-gold);
}
.ref-note {
  display: block;
  color: var(--ink-mute);
  font-size: var(--text-micro);
  line-height: 1.6;
}
.foot-legal {
  margin: var(--space-5) 0 0;
  padding-block-start: var(--space-3);
  border-block-start: var(--grid-rule) solid rgba(119, 122, 115, 0.4);
  font-size: var(--text-micro);
  line-height: 1.8;
  color: var(--ink-mute);
}
.lic-table td.tabular {
  font-family: var(--font-mono);
}
.role-tag {
  margin-inline-start: var(--space-2);
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
/* 页脚为暗面：链接沿用卷尾既有的强调色，保证对比度与焦点可见 */
.lic-table a,
.ref-home {
  color: var(--anno-gold);
  text-decoration: underline;
  text-decoration-color: rgba(201, 162, 39, 0.45);
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}
.lic-table a:hover,
.ref-home:hover {
  text-decoration-color: currentColor;
}
.lic-table a:focus-visible,
.ref-home:focus-visible {
  outline: var(--focus-ring) solid var(--anno-gold);
  outline-offset: 2px;
}
.ref-home {
  margin-inline-start: var(--space-2);
  font-size: var(--text-micro);
}
/* .table-scroll 见 styles/base.css 共用工具类 */
@media (max-width: 620px) {
  .foot-rules {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
