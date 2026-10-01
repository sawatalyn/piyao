import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng, chartPng } from './png.js';
import { demoEpub, multiChapterEpub } from './epub.js';
import { demoPdf } from './pdf.js';
import { config } from '../src/config.js';
import { users } from '../src/store/users.js';

const MEDIA_DIR = config.mediaDir;
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
// 复核期限/收集日期落在 <input type="date"> 上，只认 yyyy-MM-dd
const day = (daysAgo) => iso(daysAgo).slice(0, 10);
// 演示图片用固定 id：反复 reseed 会覆盖同一批文件，而不是每次留下新的孤儿图。
let demoSeq = 0;
const mid = () => `demomedia${String(++demoSeq).padStart(2, '0')}`;

function putPng(buffer, alt) {
  const id = mid();
  fs.writeFileSync(path.join(MEDIA_DIR, `${id}.png`), buffer, { mode: 0o640 });
  return { id, alt, bytes: buffer.length };
}

const circle = (text, color = 'seal') => `<span class="anno anno-circle c-${color}">${text}</span>`;
const line = (text, color = 'seal') => `<span class="anno anno-line c-${color}">${text}</span>`;
const img = (record) => `<figure class="rich-fig"><img data-mid="${record.id}" src="/api/media/${record.id}" alt="${record.alt}" class="rich-img" loading="lazy" decoding="async"><figcaption class="rich-cap">${record.alt}</figcaption></figure>`;

const DEMO_NOTE =
  '<p class="p-lead">说明：本条为界面演示样例，用于展示对勘、批注与归档流程；结论以正式发布的辟谣档案为准。</p>';

const images = [];
const seedMedia = (buffer, alt) => {
  const record = putPng(buffer, alt);
  images.push({ ...record, type: 'image/png', file: `${record.id}.png` });
  return record;
};

const chartA = seedMedia(chartPng({ bars: [8, 12, 9, 14, 46, 11, 7], titleBars: 4, peak: 50 }), '谣言传播量按日统计（演示数据）');
const chartB = seedMedia(chartPng({ bars: [30, 28, 26, 22, 18, 14, 10], titleBars: 0, peak: 34 }), '检测值随加热次数变化（演示数据）');
const chartC = seedMedia(chartPng({ bars: [4, 6, 5, 7, 6, 8, 90], titleBars: 6, peak: 96 }), '各渠道转载量对比（演示数据）');
const chartD = seedMedia(encodePng(720, 400, (x, y) => (y > 300 && x > 90 && x < 640 ? [23, 24, 23] : x % 24 < 2 ? [150, 145, 130] : [246, 242, 232])), '档案卷面分隔示意（演示数据）');

const ellipse = (x, y, w, h, c = 'seal') => ({ k: 'ellipse', x, y, w, h, c });
const stroke = (x, y, w, h, c = 'seal') => ({ k: 'line', x, y, w, h, c });

const posts = [
  {
    title: '螃蟹与柿子同食会中毒？所谓"食物相克"缺乏可重复证据',
    tags: ['食物相克', '食品安全', '营养与膳食', '毒理学'],
    level: '高',
    scope: '短视频与家庭群聊',
    reviewAt: day(120),
    publishedAt: iso(12),
    chart: chartA,
    rumor: `网传"螃蟹与柿子同食会生成砒霜类物质，轻则腹泻重则致命"，并附有${circle('两人同食后抢救的截图')}与${line('自制的化学反应式')}。该说法在秋季传播量陡增，${img(chartA)}图中第 5 日的传播峰值即来自一条拼接短视频。`,
    verdict: `① 该反应的化学前提不成立：柿子含鞣酸，螃蟹含蛋白质，二者结合生成的是${line('难以消化的鞣酸蛋白沉淀')}，不是砷类化合物；② 所谓"抢救截图"经比对来自不同事件的旧图；③ 营养学界的对照试验与人群观察均未复现"相克中毒"。腹泻的常见真实原因是${circle('螃蟹未彻底加热或柿子空腹大量食用')}导致的胃肠刺激，与"同食"无必然关系。${DEMO_NOTE}`,
    sources: [
      { title: '市场监管部门秋季水产品抽检结果通报', org: '示例：市级市场监管部门', collectedAt: day(14), note: '演示材料，非真实出处' },
      { title: '鞣酸与蛋白质反应的食品化学教材章节', org: '示例：高校食品学院', collectedAt: day(30), note: '演示材料' },
      { title: '短视频拼接原图比对', org: '示例：平台辟谣接口', collectedAt: day(11), note: '演示材料', mediaId: chartA.id },
    ],
    annotations: { [chartA.id]: [ellipse(0.5, 0.16, 0.16, 0.5), stroke(0.1, 0.82, 0.72, 0.02, 'indigo')] },
  },
  {
    title: 'Wi-Fi 路由器辐射致癌？非电离辐射的能量不足以破坏化学键',
    tags: ['电磁辐射', 'Wi-Fi', '健康谣言', '物理常识'],
    level: '高',
    scope: '社区群聊与二手交易平台',
    reviewAt: day(90),
    publishedAt: iso(20),
    chart: chartB,
    rumor: `传言称"路由器 24 小时辐射会累积诱发肿瘤，睡前必须断电"，配图把${circle('微波加热与通信辐射混为同一件事')}，并声称${line('国标限值比欧美宽松十倍')}。${img(chartB)}`,
    verdict: `① Wi-Fi 工作在 2.4GHz/5GHz 的${line('非电离辐射')}，单光子能量约 10⁻⁵ eV 量级，远低于断裂化学键所需的数 eV；② 路由器发射功率通常以百毫瓦计，随距离按平方反比衰减，一米外的功率密度已低于日常太阳辐射的热效应；③ 所谓"限值更宽"是对不同频段测量口径的误读，把${circle('不同单位的限值直接比大小')}。${DEMO_NOTE}`,
    sources: [
      { title: '电磁环境控制限值公开文本', org: '示例：生态环境主管部门', collectedAt: day(22), note: '演示材料' },
      { title: '家用路由器实测功率密度记录', org: '示例：第三方检测机构', collectedAt: day(21), note: '演示材料', mediaId: chartB.id },
    ],
    annotations: { [chartB.id]: [ellipse(0.06, 0.2, 0.2, 0.42, 'gold')] },
  },
  {
    title: '微波炉加热食物会产生致癌物？加热方式不改变分子结构',
    tags: ['微波炉', '食品科学', '致癌物', '烹饪方式'],
    level: '中',
    scope: '家庭群聊',
    reviewAt: day(60),
    publishedAt: iso(6),
    chart: chartC,
    rumor: `传言称"微波使食物分子产生变化，生成致癌物"，并列出${circle('一份没有署名的"研究结论清单')}。${img(chartC)} 末列为该清单在单一平台的转载峰值。`,
    verdict: `① 微波通过使极性分子振荡产热，属于${line('介质加热')}，不提供足以改变分子结构的能量；② 与明火、油煎相比，微波温度更低、时间更短，产生的美拉德与焦化产物通常${circle('更少而非更多')}；③ 唯一需要提醒的是容器材质：不合格塑料在油脂高温下可能迁移，这是${line('容器问题而不是微波问题')}。${DEMO_NOTE}`,
    sources: [
      { title: '食品加热方式与有害物生成的综述资料', org: '示例：高校食品学院', collectedAt: day(8), note: '演示材料' },
      { title: '塑料容器耐温标识说明', org: '示例：标准化机构公开资料', collectedAt: day(7), note: '演示材料' },
    ],
    annotations: { [chartC.id]: [ellipse(0.82, 0.1, 0.14, 0.62), stroke(0.1, 0.9, 0.78, 0.015, 'ink')] },
  },
  {
    title: '千滚水亚硝酸盐超标？实测增量远低于限值',
    rating: '误导',
    tags: ['饮用水', '亚硝酸盐', '健康谣言', '检测数据'],
    level: '中',
    scope: '公众号与短视频',
    reviewAt: day(45),
    publishedAt: iso(3),
    chart: chartD,
    rumor: `传言称"水反复烧开亚硝酸盐会成倍升高，长期饮用致癌"，配图把${circle('一次检测的波动值画成指数曲线')}。${img(chartD)}`,
    verdict: `① 反复煮沸主要造成水分蒸发，溶质被浓缩，绝对增量有限；② 在常规饮水总量下，即使煮沸数十次，实测浓度仍${line('低于生活饮用水限值一个数量级')}；③ 真正需要关注的是${circle('长时间敞口存放造成的二次污染')}与水源本身的高氟高砷问题。${DEMO_NOTE}`,
    sources: [
      { title: '饮用水反复煮沸实验记录', org: '示例：水质检测实验室', collectedAt: day(5), note: '演示材料', mediaId: chartD.id },
      { title: '生活饮用水卫生标准限值条目', org: '示例：标准公开文本', collectedAt: day(5), note: '演示材料' },
    ],
    annotations: { [chartD.id]: [stroke(0.12, 0.78, 0.7, 0.02, 'seal')] },
  },
  {
    title: '电梯下坠时落地前一秒跳起可自救？反应时间并不存在',
    tags: ['应急常识', '电梯安全', '物理误区', '逃生误区'],
    level: '高',
    scope: '转发型图文',
    reviewAt: day(30),
    publishedAt: iso(25),
    chart: chartA,
    rumor: `传言称"电梯自由下坠时，在触地前一秒向上跳起即可抵消冲击"。这条说法把${circle('理想真空条件下的速度叠加')}当作可操作技巧，并忽略了人无法感知触地时刻。`,
    verdict: `① 自由下坠的电梯与人体速度相同，${line('人无法判断"前一秒"')}，也就无从起跳；② 起跳带来的速度改变量与坠地速度不在同一量级；③ 现代电梯有限速器、安全钳与曳引绳多重保护，真实事故多为${circle('困人而非自由落体')}；④ 正确做法：背靠轿厢壁、屈膝、护住头颈，按下全部楼层并求助。${DEMO_NOTE}`,
    sources: [
      { title: '电梯检验规程中的安全部件说明', org: '示例：特检机构公开资料', collectedAt: day(26), note: '演示材料' },
      { title: '应急处置指引', org: '示例：城市应急管理部门', collectedAt: day(26), note: '演示材料' },
    ],
    annotations: {},
  },
  {
    title: '不锈钢杯泡茶会析出重金属？合格材质在饮用条件下溶出可忽略',
    rating: '部分属实',
    tags: ['食品接触材料', '不锈钢', '重金属', '饮茶'],
    level: '中',
    scope: '家庭群聊与带货短视频',
    reviewAt: day(20),
    publishedAt: iso(1),
    chart: chartB,
    rumor: `传言称"不锈钢遇茶水会释放铬镍锰，长期饮用等于吃重金属"，并用${circle('强酸长时间浸泡的实验数据')}冒充泡茶场景。${img(chartB)}`,
    verdict: `① 茶水的 pH 通常在 5 至 7 之间，远弱于实验所用的强酸介质；② 食品接触用不锈钢需通过${line('迁移量试验')}，合格产品在标准浸泡条件下的溶出量低于限值；③ 关键变量是${circle('材质牌号与是否合格')}，而非"不锈钢"三个字本身；④ 长时间存放的茶汤问题在于微生物与感官品质，建议及时清洗。${DEMO_NOTE}`,
    sources: [
      { title: '食品接触用金属制品迁移试验方法', org: '示例：检测机构公开方法', collectedAt: day(2), note: '演示材料' },
      { title: '常见牌号耐蚀性对照表', org: '示例：材料公开资料', collectedAt: day(2), note: '演示材料', mediaId: chartB.id },
    ],
    annotations: { [chartB.id]: [ellipse(0.34, 0.28, 0.22, 0.4, 'indigo')] },
  },
];

const items = posts.map((post, position) => {
  // 演示链接一律用 RFC 2606 保留域 example.org：字段与渲染链路是真的，出处本身不冒充真实文献
  const slug = `n${String(position + 1).padStart(2, '0')}`;
  return {
    id: `p${(now + position).toString(36)}`,
    title: post.title,
    tags: post.tags,
    rumor: {
      html: `<p>${post.rumor}</p>`,
      source: {
        platform: post.scope.split('与')[0],
        url: `https://example.org/rumor/${slug}`,
        seenAt: String(post.publishedAt).slice(0, 10),
      },
    },
    verdict: {
      html: `<p>${post.verdict}</p>`,
      rating: post.rating || '不实',
    },
    sources: post.sources.map((source, i) => ({
      id: `s${position}-${i}`,
      url: i === 0 ? `https://example.org/evidence/${slug}-${i + 1}` : '',
      ...source,
    })),
    annotations: post.annotations,
    meta: {
      editor: '示例档案',
      publishedAt: post.publishedAt,
      reviewAt: post.reviewAt,
      scope: post.scope,
      level: post.level,
    },
    pinned: position === 0,
    order: position,
    author: '档案管理员',
    reviser: '',
    createdAt: post.publishedAt,
    updatedAt: post.publishedAt,
  };
});

const tagCounts = new Map();
for (const post of items) for (const tag of post.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

fs.writeFileSync(config.paths.posts, JSON.stringify({ version: 1, items }, null, 2));
/* 版本台账：每条出厂档案带一版"建档"快照，版本页一打开就有内容可看；真实修订会续加在后面 */
fs.writeFileSync(
  config.paths.revisions,
  JSON.stringify(
    {
      version: 1,
      items: items.map((post, position) => ({
        id: `rseed${position + 1}`,
        postId: post.id,
        kind: 'create',
        at: post.createdAt,
        by: post.meta?.editor || '辨妄阁',
        snapshot: post,
      })),
    },
    null,
    2
  )
);
fs.writeFileSync(
  config.paths.tags,
  JSON.stringify(
    { version: 1, items: [...tagCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) },
    null,
    2
  )
);
fs.writeFileSync(
  config.paths.mediaIndex,
  JSON.stringify(
    {
      version: 1,
      items: images.map((image) => ({
        id: image.id,
        file: image.file,
        type: 'image/png',
        bytes: image.bytes,
        alt: image.alt,
        uploadedBy: 'seed',
        createdAt: iso(0),
      })),
    },
    null,
    2
  )
);
/**
 * 示例用户：让"名册可增删改"这条链路在出厂状态就有可删可改的对象。
 * 只在缺失时补一行——绝不覆盖已存在用户的口令（管理员改过密码后重跑种子不能把它冲掉）。
 */
const usersFresh = !fs.existsSync(config.paths.users);
users.init();
const hadDemo = users.all().some((row) => row.username === 'demo');
if (!hadDemo) {
  users.upsert({ username: 'demo', password: 'demo-pass', role: 'editor', displayName: '示例馆员（可删除）' });
}
const demoNote = usersFresh
  ? 'users.csv 由本次生成（出厂 admin）'
  : hadDemo
    ? 'users.csv 已存在，未改动任何口令'
    : 'users.csv 已存在，仅补入示例馆员一行';

/* —— 辟谣常用资源库：先登记用户点名的条目，其余由调研线补齐 —— */
/**
 * 辟谣常用资源库基线：无职转生专题的查证载体清单。
 * 只登记入口与"能核实什么"，不抓取、不镜像任何受版权保护文本；可信度按一手/二手/未核分层。
 * 状态与结论取自 2026-09-29 一轮带代理的实测（原始件留在 .scratch-mt-resources-h3v8/）。
 */
const RESOURCE_SEED = [
  {
    name: '无职转生 动画官网（新闻 / BD / radio）',
    url: 'https://mushokutensei.jp/',
    group: '官方一手出处',
    note: '企划启动、播出档期、BD 特典与官方 radio（《心の声ラジオ》）以这里为准；打"动画删改 / 换声优 / 延期"先看 news 与 bluray 页。',
    trust: '高',
  },
  {
    name: 'MF Books（KADOKAWA 书面品牌站）',
    url: 'https://mfbooks.jp/',
    group: '官方一手出处',
    note: '原作单行本的刊行主体；打"换了出版社 / 书没了"先对品牌站书目。',
    trust: '高',
  },
  {
    name: '小说特设页：卷数表与 ISBN',
    url: 'https://mfbooks.jp/special/mushoku/mushoku.html',
    group: '官方一手出处',
    note: '第 2—26 卷书志与"完結記念"记载（本轮核到 2022-09-09 时点）；打"某卷不存在 / 被撤 / 完结时点"的首选依据。',
    trust: '高',
  },
  {
    name: 'Studio Bind 官网（动画制作方）',
    url: 'https://st-bind.jp/',
    group: '官方一手出处',
    note: '制作主体与其作品列表（含原画集）；打"外包换了 / 制作公司变了"对这里。域名易被误记为 studio-bind，以本域名为准。',
    trust: '高',
  },
  {
    name: '日文维基「理不尽な孫の手」（原作者条目）',
    url: 'https://ja.wikipedia.org/wiki/%E7%90%86%E4%B8%8D%E5%B0%BD%E3%81%AA%E5%AD%AB%E3%81%AE%E6%89%8B',
    group: '中文区查证载体',
    note: '原作在「小说家になろう」2012—2015 连载与载体迁移时间线；打"作者被封号 / 原作断更"须连同其一手引用一起看。',
    trust: '中',
  },
  {
    name: '中文维基「無職轉生」条目',
    url: 'https://zh.wikipedia.org/wiki/%E7%84%A1%E8%81%B2%E8%BD%89%E7%94%9F%EF%BD%9E%E5%88%B0%E4%BA%86%E7%95%B0%E4%B8%96%E7%95%8C%E5%B0%B1%E6%8B%BF%E5%87%BA%E7%9C%9F%E6%9C%AC%E4%BA%8B%EF%BD%9E',
    group: '中文区查证载体',
    note: '中文事件叙述与分季列表；引用前回到条目脚注核源头，勿以条目正文本身作证据。',
    trust: '中',
  },
  {
    name: '萌娘百科「无职转生」条目',
    url: 'https://zh.moegirl.org.cn/zh-cn/%E6%97%A0%E8%81%8C%E8%BD%AC%E7%94%9F%EF%BD%9E%E5%88%B0%E4%BA%86%E5%BC%82%E4%B8%96%E7%95%8C%E5%B0%B1%E6%8B%BF%E5%87%BA%E7%9C%9F%E6%9C%AC%E4%BA%8B%EF%BD%9E',
    group: '中文区查证载体',
    note: '中文区名词译法与事件传播路径的线索库；UGC，须看条目内引注与编辑历史再用。',
    trust: '中',
  },
  {
    name: '洛琪希图书馆 · 借书柜台',
    url: 'https://pan.roxylib.com/%E6%B4%9B%E7%90%AA%E5%B8%8C%E5%9B%BE%E4%B9%A6%E9%A6%86%20-%20%E5%80%9F%E4%B9%A6%E6%9F%9C%E5%8F%B0',
    group: '访谈与翻译合集',
    note: '中文区粉丝维护的访谈/翻译合集借阅柜台，本馆镜像即以其条目为备份对象。本轮实测：柜台子域在线，主站 roxylib.com 返回反代 404 / 源站 522，引用前先确认可达性。',
    trust: '待核实',
  },
  {
    name: 'NDLサーチ（日本国立图书馆书志检索）',
    url: 'https://iss.ndl.go.jp/',
    group: '事实核对工具',
    note: '日版单行本的馆藏与书志硬证据；打"这一卷根本不存在"用它出条目号。',
    trust: '高',
  },
  {
    name: 'CiNii Research（学术论文与研究数据）',
    url: 'https://cir.nii.ac.jp/',
    group: '事实核对工具',
    note: '涉及"学界已证实 / 论文里说过"一类断言时来这找文献。注意 CiNii Books 已并入 NDL 搜索，旧路径会 404。',
    trust: '中',
  },
  {
    name: 'BookLive!（日版电子卷在售页）',
    url: 'https://booklive.jp/',
    group: '事实核对工具',
    note: '日版电子卷的在售与卷数状态，可反证"某卷下架"。属第三方商店，只作旁证。',
    trust: '待核实',
  },
  {
    name: 'ORICON NEWS（销量榜与播出报道）',
    url: 'https://www.oricon.co.jp/',
    group: '事实核对工具',
    note: '"首卷销量多少 / 榜首第几"一类数字的报道来源；须回原页取数值与日期，勿转引截图。',
    trust: '待核实',
  },
  {
    name: '示例：本站镜像页（站内链接形态）',
    url: '/library',
    group: '事实核对工具',
    note: '演示条目：资源库的"入口"不限于外链，也可登记本站页面。本条可直接改名、换链接或删除。',
    trust: '待核实',
  },
];
const existingResources = fs.existsSync(config.paths.resources)
  ? JSON.parse(fs.readFileSync(config.paths.resources, 'utf8')).items
  : [];
const resourcesByUrl = new Map(existingResources.map((item) => [item.url, item]));
/** 种子条目按 url 幂等刷新（说明会随核实更新），运维手工添加的行原样保留。 */
const resourceItems = RESOURCE_SEED.map((item, index) => {
  const prior = resourcesByUrl.get(item.url);
  resourcesByUrl.delete(item.url);
  return {
    id: prior?.id || `r${crypto.createHash('sha1').update(item.url).digest('hex').slice(0, 9)}`,
    ...item,
    visible: prior ? prior.visible : true,
    order: prior && prior.addedBy !== 'seed' ? prior.order : index,
    addedBy: prior?.addedBy || 'seed',
    createdAt: prior?.createdAt || iso(0),
    updatedAt: prior?.updatedAt || iso(0),
  };
});
resourceItems.push(...resourcesByUrl.values());
fs.writeFileSync(config.paths.resources, JSON.stringify({ version: 1, items: resourceItems }, null, 2));

/* —— 洛琪希图书馆镜像：演示占位书 + 演示口令（真实馆藏由运维放入 server/data/library/） —— */
// 文件名一律 ASCII，标题保留中文：ZIP 条目名的编码在跨平台上不可靠（.NET 写 cp936、
// Explorer 按 OEM 码页解、Linux unzip 按 CP437 解），一旦包里有非 ASCII 文件名，
// 总有一端解出来是乱码，而镜像站是按文件名找实体的。界面上看得见的是 title，不受影响。
const LIB_FILE = 'bianwang-demo-placeholder.epub';
const READ_FILE = 'bianwang-demo-reader.epub';
const PDF_FILE = 'bianwang-demo-pdf.pdf';
fs.mkdirSync(config.libraryDir, { recursive: true });
const demoBook = demoEpub({
  title: '辨妄阁镜像功能演示占位书',
  author: '辨妄阁',
  note: '本文件用于演示"输入口令后下载"的镜像链路，不含任何他人作品或受版权保护内容。',
});
fs.writeFileSync(path.join(config.libraryDir, LIB_FILE), demoBook, { mode: 0o640 });
const demoSha = crypto.createHash('sha256').update(demoBook).digest('hex');
const readBook = multiChapterEpub({ title: '辨妄阁分页阅览演示册', chapters: 5 });
fs.writeFileSync(path.join(config.libraryDir, READ_FILE), readBook, { mode: 0o640 });
const readSha = crypto.createHash('sha256').update(readBook).digest('hex');
const pdfBook = demoPdf({ title: '辨妄阁 PDF 阅览演示册' });
fs.writeFileSync(path.join(config.libraryDir, PDF_FILE), pdfBook, { mode: 0o640 });
const pdfSha = crypto.createHash('sha256').update(pdfBook).digest('hex');
fs.writeFileSync(
  config.paths.library,
  JSON.stringify(
    {
      version: 1,
      items: [
        {
          id: 'bseed1',
          title: '辨妄阁镜像功能演示占位书',
          author: '辨妄阁',
          translator: '',
          group: '演示',
          note: '演示占位件；真实镜像需馆员把文件放入 server/data/library/ 后在此登记。',
          sourceUrl: 'https://pan.roxylib.com/%E6%B4%9B%E7%90%AA%E5%B8%8C%E5%9B%BE%E4%B9%A6%E9%A6%86%20-%20%E5%80%9F%E4%B9%A6%E6%9F%9C%E5%8F%B0',
          rights: '自产演示文件，无第三方权利问题。收录他人作品前须自行确认授权。',
          file: LIB_FILE,
          type: 'application/epub+zip',
          bytes: demoBook.length,
          sha256: demoSha,
          enabled: true,
          // 刻意留一本未入白名单的：演示"可下载 ≠ 可预览"，架上只会显示"仅可下载"
          previewable: false,
          addedBy: 'seed',
          createdAt: iso(0),
        },
        {
          id: 'bseed2',
          title: '辨妄阁分页阅览演示册',
          author: '辨妄阁',
          translator: '',
          group: '演示',
          note: '五章自产正文，用于演示"按章节分页在线阅览"；不含任何他人作品。',
          sourceUrl: 'https://pan.roxylib.com/%E6%B4%9B%E7%90%AA%E5%B8%8C%E5%9B%BE%E4%B9%A6%E9%A6%86%20-%20%E5%80%9F%E4%B9%A6%E6%9F%9C%E5%8F%B0',
          rights: '自产演示文件，无第三方权利问题。收录他人作品前须自行确认授权。',
          file: READ_FILE,
          type: 'application/epub+zip',
          bytes: readBook.length,
          sha256: readSha,
          enabled: true,
          previewable: true,
          addedBy: 'seed',
          createdAt: iso(0),
        },
        {
          id: 'bseed3',
          title: '辨妄阁 PDF 阅览演示册',
          author: '辨妄阁',
          translator: '',
          group: '演示',
          note: '三章带书签的自产 PDF，用于演示"书签优先、无书签回退固定页数"的分节阅览；不含任何他人作品。',
          sourceUrl: 'https://pan.roxylib.com/%E6%B4%9B%E7%90%AA%E5%B8%8C%E5%9B%BE%E4%B9%A6%E9%A6%86%20-%20%E5%80%9F%E4%B9%A6%E6%9F%9C%E5%8F%B0',
          rights: '自产演示文件，无第三方权利问题。收录他人作品前须自行确认授权。',
          file: PDF_FILE,
          type: 'application/pdf',
          bytes: pdfBook.length,
          sha256: pdfSha,
          enabled: true,
          previewable: true,
          addedBy: 'seed',
          createdAt: iso(0),
        },
      ],
    },
    null,
    2
  )
);
fs.writeFileSync(
  config.paths.libraryKeys,
  JSON.stringify(
    {
      version: 1,
      items: [
        {
          id: 'kseed1',
          code: 'roxy-guest',
          label: '演示口令（对外发放前请改掉）',
          hint: '演示用途；正式使用请在镜像页重新设定。',
          scope: 'all',
          fileIds: [],
          expiresAt: 0,
          active: true,
          downloads: 0,
          createdBy: 'seed',
          createdAt: iso(0),
        },
      ],
    },
    null,
    2
  )
);

console.log(
  `已写入 ${items.length} 条演示档案、${images.length} 张演示图片、${tagCounts.size} 个话题标签、` +
    `${resourceItems.length} 条资源库条目、3 本自产演示镜像册（一本仅下载 + 一本五章分页阅览 + 一本带书签 PDF）、1 条演示口令；` +
    `示例用户 ${hadDemo ? 'demo 已存在' : '已补入 demo'}；版本台账按档案数补入 ${items.length} 条建档快照；${demoNote}。`
);
