<script setup>
import { RouterLink } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useCatalogStore } from '../stores/catalog.js';

const auth = useAuthStore();
const catalog = useCatalogStore();

const GUARDS = [
  {
    title: '防攻击',
    items: [
      '写操作需会话 + CSRF 双提交令牌；口令错误按 IP 与用户名双维度计数，5 次锁定 10 分钟，计数落盘、重启不清零。',
      '登录接口独立限流（15 分钟 12 次），全站 API 每分钟限流，上传接口按用户/来源 IP 另计。',
      '富文本经服务端白名单净化（禁 script/style/iframe/事件属性/javascript: 链接），前端再净化一道。',
      '请求体上限 640KB；上传单图上限 5MB，超出直接 413。',
      '登录表单设蜜罐字段，命中即记入审计日志并返回统一失败文案。',
      'EPUB 解析只读包内目录与单条目，解压设上限并拒绝加密条目与非常规压缩方式；阅览正文同样过白名单，SVG 等可携带脚本的类型不下发。',
    ],
  },
  {
    title: '防嗅探',
    items: [
      '会话 Cookie 为 HttpOnly + SameSite=Strict，生产环境附加 Secure，并由 Nginx 强制 HTTPS 与 HSTS。',
      '生产环境下发严格 CSP：default-src/script/style/img/connect/form-action 均为 self，无 unsafe-inline。',
      '正文批注只用预置 class 表达颜色，不使用行内样式，因此无需为样式放宽 CSP。',
      '接口不回显口令；用户名册仅在登录后返回，且默认剔除口令列。',
    ],
  },
  {
    title: '防爬取',
    items: [
      '图片走 HMAC 签名短时效直链（默认 30 分钟），过期或伪造签名返回 403，外链无法长期批量抓取。',
      '游客翻页超过 20 页需登录；脚本型 UA 与空 UA 在无会话时直接拒绝。',
      '正文由接口以 JSON 提供给 SPA，静态产物中不含全文；API 响应带 X-Robots-Tag: noindex。',
      'Nginx 层对数据目录、日志与隐藏文件设 deny，并关闭目录列表与上游指纹。',
      '镜像册的在线阅览按章节逐页下发，10MB 以上强制分页；口令令牌 10 分钟失效，插图地址同带该令牌，吊销口令后已发令牌立即作废。',
    ],
  },
  {
    title: '懒加载',
    items: [
      '路由级代码分割：编辑器、检索、后台页各自成块，首屏只载外壳。',
      '卡片入场用共享的 IntersectionObserver，命中即 unobserve，卸载即断开。',
      '图片用原生 loading=lazy + decoding=async，配合占位避免瀑布流跳变。',
      '首页到底部哨兵进入视口前 480px 才请求下一批。',
    ],
  },
];

const MATRIX = [
  { action: '浏览与检索档案', guest: true },
  { action: '查看材料源与批注', guest: true },
  { action: '新增 / 修订 / 删除图文', guest: false },
  { action: '置顶与卷次重排', guest: false },
  { action: '编辑菜单与用户名册', guest: false },
];

/** 出厂示例清单：每个功能都带一份可删可改的实体，口令等敏感值不在本页展示 */
const SAMPLES = [
  {
    feature: '辟谣图文（对勘 / 圈划划线 / 图上批注 / 材料源 / 话题 / 复核期限 / 置顶）',
    sample: '6 条演示档案，首条已置顶；正文含朱砂圈划与下划线，插图带矢量批注',
    where: '详情页右上「修改 / 删除」；编辑器四叶折叠文书逐叶编辑',
  },
  {
    feature: '链接（原始载体与材料源出处）',
    sample: '每条演示档案的「原始载体链接」与首条材料源链接，一律取保留域 example.org，不冒充真实文献',
    where: '编辑器 → 谣言案例叶的「原始载体链接」；材料源每行的链接输入框',
  },
  {
    feature: '可登录用户',
    sample: '默认管理员（需求指定的出厂账号）+ 一名「示例馆员（可删除）」',
    where: '用户名册：同名提交即改密；非默认账号可「移除」，也可新增',
  },
  {
    feature: '辟谣常用资源库',
    sample: '13 条：12 条实测外部查证载体 + 1 条站内链接示例（指向本馆镜像页）',
    where: '资源库页登录后「修订条目 / 隐藏 / 删除」；侧栏同步呈现',
  },
  {
    feature: '镜像站在线阅览与取书（EPUB / PDF）',
    sample:
      '《辨妄阁分页阅览演示册》五章自产正文（逐章翻页、插图、全本通读）+《辨妄阁 PDF 阅览演示册》三枚书签自产正文（按节翻页）+ 一本单章占位书（刻意未入预览白名单，只显示"仅可下载"）',
    where: '镜像页「在线阅览」入口与登记/管理里的「允许在线预览」勾选；口令可在口令管理里停用、吊销或换范围',
  },
  {
    feature: '档案版本台账（逐版快照与两版比对）',
    sample: '每条演示档案都带一份「建档」快照；修订一次即累积两版，正文按字与词标出增删',
    where: '详情页「版本台账」入口；任选两版设为基线/对照，每档保留最近若干版（服务端可调）；登录后可在「版本台账总表」看全站口径',
  },
  {
    feature: '馆务台账（媒体对账与安全日志聚合）',
    sample: '孤儿图片、失效索引记录与登录失败/CSRF 拒绝等信号在页内可查；清理默认只预演',
    where: '馆务台账页（登录可见）；点名勾选后确认才真删，越界路径与在用记录一律拒绝',
  },
  {
    feature: '菜单与卷次顺序',
    sample: '出厂 12 项功能菜单（含资源库、镜像站、馆务台账与版本台账总表）与已排好的卷次顺序',
    where: '菜单编辑（勾选与拖动）；卷次重排（拖动后保存）',
  },
];
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">凡例</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        本站为图文辟谣档案库：以「谣言 ↔ 辟谣」双栏对勘为基本体例，重点以朱砂圈划，材料逐条登记出处。
      </p>
    </header>

    <section class="pane">
      <h2>体例</h2>
      <ul class="rules">
        <li><b>谣言侧</b>只收录原话与原始载体，不作改写；圈划处为被指认的关键断言。</li>
        <li><b>辟谣侧</b>先给结论判定（不实 / 误导 / 部分属实 / 存疑），再列证据与推理。</li>
        <li><b>材料源</b>须写来源机构与采集时刻；无出处的断言不进入辟谣侧。</li>
        <li><b>复核</b>每条档案登记复核日，逾期在卷身卡片以印朱左边提示重检；侧栏导轨按话题导航，游客亦可读。</li>
      </ul>
    </section>

    <section class="pane">
      <h2>权限</h2>
      <table class="matrix">
        <caption class="micro-label">当前身份：{{ auth.isAuthed ? `已登录（${auth.user.displayName || auth.user.username}）` : '游客' }}</caption>
        <thead>
          <tr>
            <th scope="col">动作</th>
            <th scope="col">游客</th>
            <th scope="col">登录</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in MATRIX" :key="row.action">
            <th scope="row">{{ row.action }}</th>
            <td>{{ row.guest ? '可用' : '—' }}</td>
            <td>可用</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!auth.isAuthed" class="field-hint">
        <RouterLink :to="{ name: 'login' }">登录</RouterLink>后可编写与修订档案。
      </p>
    </section>

    <section class="pane">
      <h2>出厂示例</h2>
      <table class="matrix">
        <caption class="micro-label">
          每项功能都随包附一份实体示例，全部可再编辑或删除；执行 <code>pnpm seed</code> 可恢复出厂演示内容（已改过的管理员密码不会被覆盖）
        </caption>
        <thead>
          <tr>
            <th scope="col">功能</th>
            <th scope="col">出厂示例</th>
            <th scope="col">在哪编辑或删除</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in SAMPLES" :key="row.feature">
            <th scope="row">{{ row.feature }}</th>
            <td>{{ row.sample }}</td>
            <td>{{ row.where }}</td>
          </tr>
        </tbody>
      </table>
      <p class="field-hint">演示链接与出处一律取 RFC 2606 保留域，仅作字段形态示范，不可作为辟谣依据。</p>
    </section>

    <section v-for="group in GUARDS" :key="group.title" class="pane">
      <h2>{{ group.title }}</h2>
      <ul class="rules">
        <li v-for="line in group.items" :key="line">{{ line }}</li>
      </ul>
    </section>

    <section class="pane">
      <h2>数据存放</h2>
      <p>
        档案、话题、菜单与登录用户分别以 <code>posts.json</code>、<code>tags.json</code>、<code>menu.json</code>
        与 <code>users.csv</code> 存放在服务端数据目录，资源库与镜像书目另存 <code>resources.json</code>、
        <code>library.json</code> 与 <code>library-keys.json</code>；写入采用「临时文件 + 原子改名」，读改写串行排队。
        检索索引常驻内存并在写入后标脏重建，因此内容改动无需刷新页面即可反映到列表与搜索结果。
        现共 <b class="tabular">{{ catalog.stats.total }}</b> 条档案。
      </p>
    </section>
  </div>
</template>

<style scoped>
.rules {
  margin: 0;
  padding-left: 1.2em;
  display: grid;
  gap: var(--space-2);
  color: var(--ink-soft);
  font-size: var(--text-small);
  line-height: 1.8;
}
.rules b {
  color: var(--terra-ink);
}
.matrix {
  inline-size: 100%;
  border-collapse: collapse;
  font-size: var(--text-small);
}
.matrix caption {
  text-align: start;
  margin-block-end: var(--space-2);
}
.matrix th,
.matrix td {
  text-align: start;
  vertical-align: top;
  padding: var(--space-2) var(--space-3);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
  line-height: 1.7;
}
.matrix tbody th {
  font-weight: 600;
  color: var(--terra-ink);
  inline-size: 26%;
}
.matrix thead th {
  border-block-end: var(--frame-rule) solid var(--rule-firm);
  font-family: var(--font-display);
  letter-spacing: 0.08em;
}
code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--terra-signal-ink);
}
</style>
