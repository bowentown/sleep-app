/**
 * 文案护栏：把「界面断言 vs 代码能力」这一整类缺陷变成可执行的检查。
 *
 * 起因（design-review/下一步-智能与人性化.md 第十四、十五节）：
 * 这个项目里反复出现同一类问题——**界面上的断言与代码实际能力脱节**。已修的实例：
 *
 *   1. 深睡是 generateSleepStages 推演出来的，却按实测呈现，还套临床阈值
 *   2. 「浅睡唤醒 ±20m」徽标：从未实现，而它承诺的是唤醒时机
 *   3. wakingMood 被三处采集却从未读取，且一键记录用时长短编造感受
 *   4. 深睡结论标题对推演值打临床招牌，并去夸一个只睡 4 小时的人
 *   5. 「结合当夜深睡…真实插值」（深睡是推演的）、「遵循 NSF 指南」（并不存在）
 *
 * 前几次都是「发现一处、改一处」。这个脚本换个做法：**把整类规则写成检查**，
 * 让新增的越界文案在 CI 上直接失败。
 *
 * 这个护栏自己在开发中被反向验证推翻了两次，两处都是**「看起来在保护、实际没保护」**：
 *
 *   盲点 A：提取器按行匹配 `>...<`，**跨行的 JSX 文本整段漏掉**。
 *           把违规文案写进跨行 JSX，护栏一条都不报。
 *           已改为逐字符状态机（同时跟踪字符串/注释状态）。
 *           提取量 873 → 1056 条，差额就是原先漏掉的跨行文本。
 *
 *   盲点 B：豁免按**整条提取出的文案**判断，而 JSX 文本节点是**整个段落**。
 *           于是一句「它不替代 CBT-I 治疗」把整段都放行了——包括同一段里
 *           我故意塞进去的「遵循…NSF 指南」。
 *           已改为按**匹配片段**判断：豁免生效，当且仅当 snippet 包住这段匹配。
 *
 * 两条设计上的硬要求（否则它会变成摆设）：
 *
 *   A. **必须证明扫描真的扫到了东西。** 文件数、中文串数、规则匹配总数三项都要
 *      非零，否则失败退出而不是打印"全部通过"。一个永远通过的护栏比没有护栏更糟。
 *   B. **豁免必须真的在起作用。** 每条豁免记录它豁免的片段和理由；若某条豁免
 *      一次都没豁免到东西，脚本报错要求删除——防止豁免清单腐烂成"什么都放行"。
 *      这条检查刚上线就抓出**我一开始写的 5 条豁免全部是多余的**。
 *
 * 运行：npm run verify:copy
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------- 规则
/**
 * 每条规则 = 一个正则 + 它禁止的**性质**。
 *
 * 规则要盯"性质"，不要盯句子：盯句子的断言会在改文案时变红，
 * 然后被人顺手删掉，最后什么也没防住。
 *
 * 同样重要的是**不要盯词**。第一版的「不得承诺疗效」里放了裸的「疗效」，
 * 结果误伤了 `我不评价疗效` 这种**拒绝**承诺的句子。现在盯的是承诺句式。
 */
const RULES: Array<{ id: string; re: RegExp; why: string; bad: string; good: string; neg?: RegExp }> = [
  {
    id: '推演值不得挂临床判据',
    re: /(深睡|REM|快速眼动)[^。\n]{0,24}(临床目标|临床区间|临床判据|达标|正常范围)/,
    why: '深睡与 REM 由 generateSleepStages 推演（与时长 r=−0.769），不能套临床阈值',
    bad: '深睡占比 27%，低于临床目标',
    good: '深睡占比 27%（模型推算，非分期实测）',
  },
  {
    id: '不得承诺疗效',
    re: /(自我治愈|修复之旅|根治|治疗失眠|疗效显著|治愈失眠|包治)/,
    why: '这个 App 不做治疗；承诺疗效属于无依据的医疗宣称',
    bad: '黑夜是身体自我治愈的神圣时刻',
    good: '我不评价疗效，但可以把它变成一次试验',
  },
  {
    id: '不得把推演值说成真实/实测',
    re: /(深睡|REM|分期)[^。\n]{0,16}(真实插值|真实测量|实测值)/,
    why: '手机没有脑电电极，分期无法测量',
    bad: '并结合当夜深睡与潜伏期真实插值',
    good: '并结合你当夜的时长、入睡潜伏期与作息记录',
  },
  {
    id: '不得由不可靠测量推出生理结论',
    re: /利于褪黑素分泌/,
    why: '依据是未校准的麦克风估算（同文件注释自己承认 ±10 dB）',
    bad: '🟢 环境安静 · 利于褪黑素分泌',
    good: '🟢 环境安静',
  },
  {
    id: '规则表不得自称临床/医学引擎',
    re: /(临床|医学)(规则引擎|睡眠意图|意图|顾问)/,
    why: '它是关键词匹配表，不是临床决策系统',
    bad: '本地医学规则引擎',
    good: '本地睡眠规则引擎',
  },
  {
    // 两种语序都要抓：`提升深睡` 与 `深睡提升`。
    // 第一版只写了前者，而真实违规是后者（「覆盖深睡提升、20分钟离床重置」），
    // 结果规则的自检样本自己就匹配不上——自检当场抓住了这个错误。
    id: '不得声称能提升深睡',
    re: /((提升|改善|增加)[^。\n]{0,6}深睡|深睡[^。\n]{0,4}(提升|改善))/,
    why: '本 App 测不到深睡（分期是推演的），不能声称能提升它',
    bad: '覆盖深睡提升、20分钟离床重置',
    good: '把注意力放在时长和规律性上收益更大',
    // 明确**否认**该能力的句子不算违规。规则要禁止的是"声称能做"，
    // 不是"提到这个词"——否则护栏会去惩罚正确的免责表述（这里就误伤了
    // 我自己写的「不包含『提升深睡』——深睡无法被本 App 测量」）。
    neg: /不包含|无法被本 App 测量|测不到|做不到|不提供|重点不是|不需要|不要拿/,
  },
  {
    id: '不得声称遵循并不存在的指南',
    re: /遵循[^。\n]{0,20}(NSF|国家睡眠基金会|指南)/,
    why: '没有任何睡眠学会就"每日睡眠评分/深睡占比"发布过指南',
    bad: '建议遵循美国国家睡眠基金会（NSF）指南',
    good: '建议方向与失眠认知行为治疗（CBT-I）一致',
  },
  {
    id: '不得挂靠无法核对的机构或研究',
    re: /(哈佛|斯坦福|梅奥|约翰霍普金斯|牛津|剑桥|耶鲁|协和|北大|清华|中科院|世界卫生组织)/,
    why:
      'App 里没有引用系统，用户无法核对任何机构出处；' +
      '挂一个查不到的名字既不能被反向验证，也把「我们研究了」当成了论据。' +
      '（这条规则的由来：BreathingExercise 写着「源自哈佛睡眠医学研究」，' +
      '而它是个从未接上入口的孤儿组件，一直没被人看见。）',
    bad: '源自哈佛睡眠医学研究，快速平息心率入眠',
    good: '延长呼气会让副交感神经占上风，心率随之慢下来',
  },
];

/**
 * 豁免：确有依据的用法。
 *
 * ★ 这个清单刚建好时我写了 5 条，**经过「必须真的生效」检查后全部删掉了**——
 * 一条都没豁免到东西。原因是规则本来就按性质写、足够精确，我却是先写豁免后验证。
 * 其中第 5 条（`它不替代 CBT-I 治疗`）甚至主动掩护了它所在整段的其它违规。
 *
 * 所以：**先让规则去撞，撞到了再考虑豁免**；豁免的粒度是匹配片段，不是整段文案。
 * 每条的 snippet 必须**包住**它要豁免的那段匹配文本。
 */
const ALLOW: Array<{ file: string; snippet: string; why: string }> = [];

// ---------------------------------------------------------------- 取用户可见文案
/**
 * 取**会渲染给用户**的中文串：字符串字面量与 JSX 文本节点。
 *
 * 必须做**逐字符状态机**，不能按行写正则（见文件头盲点 A）。
 *
 * 规则：
 *   - 注释（行注释、块注释、JSX 注释）里的内容**全部跳过**。
 *     注释里出现"临床"通常是在解释实现或引用依据，不是对用户的断言；
 *     不区分的话护栏会被自身的解释文字淹没。
 *   - 字符串字面量（单引号 / 双引号 / 反引号）里的中文算用户可见。
 *   - JSX 文本节点（`>` 与 `<` 之间，可跨行）里的中文算用户可见。
 */
function visibleStrings(src: string): string[] {
  const out: string[] = [];
  type Mode = 'code' | 'line' | 'block' | 's1' | 's2' | 'tpl';
  let mode: Mode = 'code';
  let buf = '';
  let jsxText = '';
  const flushStr = () => {
    if (/[\u4e00-\u9fa5]/.test(buf)) out.push(buf);
    buf = '';
  };
  const flushJsx = () => {
    const t = jsxText.trim();
    if (/[\u4e00-\u9fa5]/.test(t)) out.push(t);
    jsxText = '';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];

    if (mode === 'line') {
      if (c === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i++; }
      continue;
    }
    if (mode === 's1' || mode === 's2' || mode === 'tpl') {
      const q = mode === 's1' ? "'" : mode === 's2' ? '"' : '`';
      if (c === '\\') { buf += src[i + 1] ?? ''; i++; continue; }
      if (c === q) { flushStr(); mode = 'code'; continue; }
      buf += c;
      continue;
    }

    // mode === 'code'
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 's1'; continue; }
    if (c === '"') { mode = 's2'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '<') { flushJsx(); continue; }
    if (c === '>') { jsxText = ''; continue; }
    if (c === '{') { flushJsx(); continue; }
    jsxText += c;
  }
  flushJsx();
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(tsx|ts)$/.test(f)) out.push(f);
  }
  return out;
}

const relOf = (f: string) => f.replace(/\\/g, '/');

/**
 * 剥掉源码里的注释，供**源码扫描类检查**使用。
 *
 * 这个坑在这个项目里踩到**第三次**了：断言/护栏去源码里找某个模式，结果
 * 匹配到**它自己写的说明注释**，于是恒红或恒绿。前两次分别在
 * `verify-render.mts`（OneTap 源码护栏匹配到自己引用的旧代码）
 * 和这里（本文件的文档注释里写了 `{msg.content}`，护栏把自己报了）。
 *
 * 结论：**凡是要在源码里搜模式的检查，先剥注释。** 所以做成 helper，
 * 而不是每次记得手动处理。
 */
/**
 * 剥掉注释后再查内容。
 *
 * ★ 这里原来只去「整行 //」注释，**不去行尾注释**，于是
 * `const a = 1; // 由**实测**决定` 里的星号会被当成用户可见文案。
 * 这是本仓库第 9 次栽在同一个根因上（verify-wiring 里修过一次，换了个文件又出现）。
 * 所以改用与 verify-wiring 相同的一套正则：块注释 + 行尾注释，只放过 `://`。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

// ---------------------------------------------------------------- 执行
const files = walk('src');
check('扫描到了源文件（否则下面的检查都是空跑）', files.length >= 20, `只扫到 ${files.length} 个文件`);

const hits: Array<{ file: string; rule: string; text: string }> = [];
const usedAllow = new Set<number>();
let totalStrings = 0;
let totalMatches = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relOf(file);
  for (const text of visibleStrings(src)) {
    totalStrings++;
    for (const r of RULES) {
      // 用 g 标志逐处匹配，才能按**匹配片段**而不是整条文案判断豁免
      const re = new RegExp(r.re.source, 'g');
      for (const m of text.matchAll(re)) {
        totalMatches++;
        // 规则级的否定豁免：整条文案在**否认**这个能力时说到了这个词，不算违规
        if (r.neg && r.neg.test(text)) continue;
        const idx = ALLOW.findIndex(
          (a) => rel.endsWith(a.file) && a.snippet.includes(m[0])
        );
        if (idx >= 0) { usedAllow.add(idx); continue; }
        hits.push({ file: rel, rule: r.id, text: m[0] });
      }
    }
  }
}

if (process.env.DBG_COPY) {
  console.log(`总提取 ${totalStrings} 条 / 规则匹配 ${totalMatches} 处 / 违规 ${hits.length} 处 / 生效豁免 ${usedAllow.size} 条 / 豁免共 ${ALLOW.length} 条`);
  for (const h of hits) console.log(`  [${h.rule}] ${h.file}: ${h.text}`);
}

check('确实提取到了用户可见文案（防止提取逻辑失效导致空跑）',
  totalStrings >= 200, `只提取到 ${totalStrings} 条中文串，提取逻辑可能坏了`);
// ★ 不能用"代码库里匹配到几处"来证明正则没写坏——**在健康的代码库里零违规才是期望状态**。
// 第一版就是这么写的，代码库清干净之后它反而报错，等于在惩罚正确的状态。
// 正确做法：给每条规则配一个已知违规样本，自检正则本身是活的。
for (const r of RULES) {
  check(`规则自检（必中）：${r.id}`, r.re.test(r.bad), `这条规则匹配不到自己的违规样本「${r.bad}」`);
  check(`规则自检（不误伤）：${r.id}`, !r.re.test(r.good), `这条规则误伤了合法文案「${r.good}」`);
}

for (const r of RULES) {
  const offenders = hits.filter((h) => h.rule === r.id);
  check(`文案护栏：${r.id}`, offenders.length === 0,
    offenders.length ? `${offenders.map((o) => `${o.file}: ${o.text}`).slice(0, 2).join(' | ')}（${r.why}）` : '');
}

// ---------------------------------------------------------------- 结构性检查：Markdown 粗体
/**
 * ★ 这条查的不是"有没有 `**`"，而是"用了 `**` 的值有没有经过渲染器"。
 *
 * 起因：项目里有 79 处用户可见文案写了 `**粗体**`，而 JSX **不解析 Markdown**。
 * 最严重的是危机求助文案——它在聊天气泡里就是 `{msg.content}` 一个纯文本节点，
 * 于是 `**请珍重您的生命，您并不孤单！**` 带着星号显示给一个正在痛苦中的用户。
 *
 * 修在渲染层（`src/utils/richText.tsx` 的 renderEmphasis），一次覆盖全部。
 *
 * ★ 第一版这条检查写错了对象：它按文件去查"含 `**` 的文件有没有 import 渲染器"，
 * 结果把 `sleepFindings.ts` / `clinicalSleepEngine.ts` 判为违规——
 * 可这两个文件是**生产字符串**的工具模块，它们从不渲染任何东西。
 * 渲染发生在 `AIAdvicePanel.tsx`。**检查必须盯渲染点，不是盯生产点。**
 *
 * 现在查的是：组件里这些插值必须被 renderEmphasis 包住。
 */
const RENDER_FIELDS = ['f.detail', 'f.headline', 'f.levers[0]', 'msg.content', 'f.value'];
let renderChecked = 0;

for (const file of files) {
  if (!/\.tsx$/.test(file)) continue;
  const src = stripComments(readFileSync(file, 'utf8'));
  const rel = relOf(file);
  for (const field of RENDER_FIELDS) {
    if (!src.includes(`{${field}}`)) continue;
    renderChecked++;
    check(`渲染 ${field} 时走粗体渲染器：${rel}`, false,
      `用了 {{${field}}} 直接渲染。若该值含 **，用户会看到字面星号；` +
      `请改成 {renderEmphasis(${field})}（危机求助文案就在这条路径上）`);
  }
  // 反向：确认接线确实发生了（避免上面的检查因为字段名写错而空跑）
  if (src.includes('renderEmphasis(')) {
    renderChecked++;
    check(`确实接入了粗体渲染器：${rel}`, true);
  }
}
check('渲染点检查确实覆盖到了东西（不是空跑）', renderChecked >= 1, '一个渲染点都没检查到');

// 豁免清单不许腐烂，而且必须**真的在起作用**。
// 只检查"这段字还在文件里"是不够的——那测不出"这条豁免已经没人需要了"，
// 而一条多余的豁免会让护栏看起来更严格、实际更宽松。
ALLOW.forEach((a, i) => {
  if (usedAllow.has(i)) return;
  check(`豁免仍然必要：${a.snippet.slice(0, 24)}…`, false,
    `这条豁免没有豁免到任何匹配（${a.file}）。文案改了请删掉它；` +
    `它也可能是多余的——多余的豁免是在掩护违规，不是在澄清规则。`);
});

// ---------------------------------------------------------------- 汇总
// ─────────────────────────────────────────────────────────────
// 规则 9：JSX 不解析 Markdown —— 用户可见的 `**粗体**` 必须走 renderEmphasis
//
// 起因：我在设置页的桌宠卡片里写了「心情只由你的**实测**评分决定」，
// 结果界面原样显示了两个星号。项目里其实**早有** renderEmphasis 专门解决它
// （richText.tsx 的注释写着"79 处文案写了 Markdown 粗体，但 JSX 不解析"），
// 我既没用它，也没有任何护栏拦着。
//
// 判据刻意收窄，避免误报：
//   • 只看 .tsx（.ts 里的 `**` 是给 renderEmphasis 准备的字符串，渲染在别处）
//   • 先剥注释（`**` 出现在注释里无害）
//   • 该文件若已调用 renderEmphasis 就整体放过（它把星号交给谁也看得见）
//   • 豁免必须写明理由，和 RULES 同一套（ALLOW）
const emphasisHits: string[] = [];
for (const f of files) {
  if (!f.endsWith('.tsx')) continue;
  const src = stripComments(readFileSync(f, 'utf8'));
  if (src.includes('renderEmphasis')) continue;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // 只认成对的 `**...**`，落单的星号（乘法、指针注释残留）不算
    if (/\*\*[^*]+\*\*/.test(lines[i]!)) {
      emphasisHits.push(`${f}:${i + 1} → ${lines[i]!.trim().slice(0, 70)}`);
    }
  }
}
check('自检·stripComments 去掉整行注释', !stripComments('// 由**实测**决定\nconst a = 1;').includes('实测'));
check('自检·stripComments 去掉行尾注释', !stripComments('const a = 1; // 由**实测**决定').includes('实测'));
check('自检·stripComments 保留 ://', stripComments('const u = "https://x.dev";').includes('://'));

check('用户可见的 Markdown 粗体都走 renderEmphasis',
  emphasisHits.length === 0,
  emphasisHits.length ? `原样显示星号 ${emphasisHits.length} 处:\n     ${emphasisHits.join('\n     ')}` : '');

// 自检：这条规则本身得能在坏输入上变红
const EMPHASIS_SELFTEST = [
  { src: 'const a = 1;\n<p>心情由你的**实测**评分决定</p>', expect: true },
  { src: 'const a = 1; // 由**实测**决定\n<p>普通文案</p>', expect: false },
  { src: 'import { renderEmphasis } from "./richText";\n<p>由**实测**决定</p>', expect: false },
  { src: '<p>a * b * c</p>', expect: false },
];
for (const [i, c] of EMPHASIS_SELFTEST.entries()) {
  const hit = !c.src.includes('renderEmphasis') &&
    /\*\*[^*]+\*\*/.test(stripComments(c.src));
  check(`自检·粗体规则样例 ${i + 1}`, hit === c.expect, `期望 ${c.expect} 得到 ${hit}`);
}

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 文案护栏全部通过（${pass} 项断言，${files.length} 个文件 / ${totalStrings} 条中文串 / ${totalMatches} 处规则匹配）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
