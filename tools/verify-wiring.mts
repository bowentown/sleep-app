/**
 * 接线护栏：用户可设置的字段，到底有没有兑现？
 *
 * 起因（design-review/下一步-智能与人性化.md 第十六节）：
 * 前五轮修的四个缺陷是同一类——**界面上的断言与代码实际能力脱节**。其中两个是同一形状：
 *
 *   • `alarm.smartWakeEnabled` / `smartWakeWindowMinutes`：
 *     写在配置里、徽标显示「− 浅睡唤醒 ±20m +」，**但唤醒逻辑从不读它们**，
 *     `checkAlarm` 只做 `alarm.time === 当前分钟`。承诺的是唤醒时机。
 *   • `soundDetectionSensitivity` / `smartAlarmEnabled` / `vibrate`：
 *     定义了、设了默认值、**任何地方都不读**。
 *
 * 注意 `**`、`临床` 这类**文案**护栏（verify-copy）抓不到这两种——
 * 它们的问题不在措辞而在接线，文案本身没写错。
 *
 * 所以这个脚本查两个问题：
 *
 *   规则 1：用户可设置的字段，**被写入却从未被读取** → 死配置（零误报）
 *   规则 2：用户可设置的字段，**只在组件（渲染层）里被读取** → 有界面、没行为
 *
 * 规则 2 需要豁免清单，因为有些字段本来就只是显示偏好（`name`、`theme`）。
 * 豁免必须写明理由，且**必须真的被用到**（沿用 verify-copy 的教训：
 * 多余的豁免是在掩护问题，不是在澄清规则）。
 *
 * 已知局限（诚实记录）：规则 2 用「文件在 components/ 下」区分渲染层与逻辑层，
 * 但组件里也写业务逻辑（`aiConfig` 就在组件里发起模型调用）。
 * 所以它是**提示器**不是**判定器**——命中必须人来判断，豁免要写理由。
 * 真正零误报的是规则 1。
 *
 * 运行：npm run verify:wiring
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * 收集源文件。
 *
 * ★ `ext` 参数是这个函数的第二次修改。第一版写死 `/\.(tsx|ts)$/`，
 * 于是 `walk('tools')` **什么都收不到**——因为工具脚本是 `.mts`：
 * `\.(tsx|ts)$` 要求结尾是 `.ts`/`.tsx`，而 `verify-smartwake.mts` 结尾是 `.mts`。
 * 后果是死导出规则注释里写的「引用搜索必须包含 tools/」**根本没有生效**，
 * 一句写在注释里的保证与代码实际行为不符。
 *
 * 发现方式：智能唤醒模块的导出只被 `tools/verify-smartwake.mts` 引用，
 * 却被报成「无人引用」——说明 tools/ 确实没被搜到。
 */
function walk(dir: string, out: string[] = [], ext: RegExp = /\.(tsx|ts)$/): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out, ext);
    else if (ext.test(f)) out.push(f);
  }
  return out;
}

/** 剥注释——这个项目在「源码搜索匹配到自己的注释」上栽过三次，见 verify-copy。 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const relOf = (f: string) => f.replace(/\\/g, '/');

// ---------------------------------------------------------------- 取字段
/**
 * 只查**用户可设置**的类型：这些是界面承诺、代码要兑现的地方。
 * 不查 `SleepRecord` 之类的**派生数据**——那些字段只用来显示是合理的
 * （比如 `lightSleepMinutes` 就是给分期图看的，不需要任何行为）。
 */
const CONFIG_INTERFACES = ['UserProfile', 'CustomAlarmSetting'];

const typeSrc = readFileSync('src/types/sleep.ts', 'utf8');
const fields: Array<{ iface: string; field: string }> = [];
for (const m of typeSrc.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, iface, body] = m;
  if (!CONFIG_INTERFACES.includes(iface)) continue;
  for (const f of body.matchAll(/^\s{2}(\w+)\??:/gm)) fields.push({ iface, field: f[1] });
}
check('取到了配置字段（否则下面的检查都是空跑）',
  fields.length >= 15, `只取到 ${fields.length} 个字段`);

// ---------------------------------------------------------------- 统计读写
const files = walk('src').filter((f) => !f.endsWith('types/sleep.ts'));

interface Wiring { iface: string; field: string; reads: number; compReads: number; writes: number }
const wiring: Wiring[] = fields.map(({ iface, field }) => {
  const wordRe = new RegExp(`\\b${field}\\b`, 'g');
  const writeRe = new RegExp(`\\b${field}\\s*:`, 'g');
  let reads = 0, compReads = 0, writes = 0;
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const hits = [...src.matchAll(wordRe)].length;
    if (hits === 0) continue;
    const w = [...src.matchAll(writeRe)].length;
    writes += w;
    const r = hits - w;
    if (r > 0) {
      reads += r;
      // 只在「渲染层」（components 下的 tsx）出现 = 可能只有界面没有行为
      if (/^src\/components\/.*\.tsx$/.test(relOf(file))) compReads += r;
    }
  }
  return { iface, field, reads, compReads, writes };
});

/**
 * 规则 2 的豁免：**本来就只是显示偏好、不需要任何行为**的字段。
 * 每条必须写明理由；且必须真的被用到（见文件末尾的检查）。
 */
const DISPLAY_ONLY_OK: Array<{ field: string; why: string }> = [
  { field: 'name', why: '用户昵称，只用于称呼，没有需要它驱动的行为' },
  { field: 'aiConfig', why: '模型调用发生在组件内（AIAdvicePanel），逻辑层不参与；配置本身被真实使用' },
];

/**
 * ★ 第二类豁免：**功能尚未实现、但界面已经如实标注了**的字段。
 *
 * 这正是 `smartWakeEnabled` / `smartWakeWindowMinutes` 的情况：
 * 唤醒逻辑从不读它们（`checkAlarm` 只做 `alarm.time === 当前分钟`），
 * 所以它们确实是"只有界面在读"。但界面上写着「尚未生效」并给出原因，
 * **承诺已经被撤回**，此时保留字段是合理的（它定义了将来采集数据的窗口）。
 *
 * 关键设计：这不是一张空白通行证。豁免的生效**取决于那段披露真的存在**——
 * 披露文案被删掉，这里立刻变红。也就是说：
 * **「有界面没行为」只有在「界面自己说了没行为」时才被允许。**
 */
const DISCLOSED_NOT_IMPLEMENTED: Array<{
  field: string; file: string; disclosure: RegExp; why: string;
}> = [
  {
    field: 'smartWakeEnabled',
    file: 'src/components/AlarmManager.tsx',
    // 注意这是**源码**正则，不是渲染后正则：徽标在源码里是
    // `浅睡唤醒 <span …>尚未生效</span>`，窗口值以 `{newSmartWindow}` 插值出现，
    // 所以这里不能要求 `±\d+m`（渲染后才有数字）。
    // 又一次踩到「源码 vs 渲染」的区别——护栏扫源码，就必须按源码的形态写。
    disclosure: /浅睡唤醒[\s\S]{0,200}?尚未生效/,
    why: '唤醒时机尚未实现，界面已标注「尚未生效」并给出原因',
  },
  {
    field: 'smartWakeWindowMinutes',
    file: 'src/components/AlarmManager.tsx',
    // 注意这是**源码**正则，不是渲染后正则：徽标在源码里是
    // `浅睡唤醒 <span …>尚未生效</span>`，窗口值以 `{newSmartWindow}` 插值出现，
    // 所以这里不能要求 `±\d+m`（渲染后才有数字）。
    // 又一次踩到「源码 vs 渲染」的区别——护栏扫源码，就必须按源码的形态写。
    disclosure: /浅睡唤醒[\s\S]{0,200}?尚未生效/,
    why: '同上——它定义的是将来采集数据的窗口长度',
  },
];

// ---------------------------------------------------------------- 规则 1：死配置
// 判断依据只看「有没有被读取」：一个**从没被读**的配置字段，无论有没有被写入，
// 都是死配置。第一版多加了 `writes > 0` 的条件，于是"定义了但连写都没写"的字段
// 会被漏掉——反向验证时我往接口里放了一个这样的字段，护栏没反应才发现。
const dead = wiring.filter((w) => w.reads === 0);
check('没有「从未被读取」的配置字段', dead.length === 0,
  dead.length
    ? dead.map((d) => `${d.iface}.${d.field}（读 0 次，写了 ${d.writes} 次）`).join('、') +
      ' —— 这类字段会让读代码的人以为有行为，也可能哪天被接上界面变成假开关'
    : '');

// ---------------------------------------------------------------- 规则 2：有界面没行为
// ★ 必须剥注释后再匹配。这是本项目**第四次**栽在「检查匹配到自己的注释」上：
// 上一版这里读的是原始文件，于是正则匹配到了我在同文件里写的**解释性注释**
// （「这个徽标原来只写『浅睡唤醒 ±20m』…」），把真正的徽标删掉它也不会红。
// 反向验证就是靠这一点暴露的：三个反向测试全部静默通过。
const disclosureText = (file: string) => stripComments(readFileSync(file, 'utf8'));
const isDisclosed = (field: string) =>
  DISCLOSED_NOT_IMPLEMENTED.some(
    (d) => d.field === field && d.disclosure.test(disclosureText(d.file))
  );
const displayOnly = wiring.filter(
  (w) =>
    w.reads > 0 &&
    w.reads === w.compReads &&
    !DISPLAY_ONLY_OK.some((a) => a.field === w.field) &&
    !isDisclosed(w.field)
);
check('没有「只有界面在读、逻辑层从不读」的配置字段', displayOnly.length === 0,
  displayOnly.length
    ? displayOnly.map((d) => `${d.iface}.${d.field}`).join('、') +
      ' —— 要么补上行为，要么在 DISPLAY_ONLY_OK 里写明为什么它不需要行为'
    : '');

// 反向：这两条检查都真的在检查东西（不是空跑）
check('规则 1 确实覆盖到了字段（不是空跑）', wiring.length >= 15, `共 ${wiring.length}`);
check('至少有一个字段被逻辑层读取（说明分类逻辑没把一切都归到渲染层）',
  wiring.some((w) => w.reads > w.compReads), '所有读取都落在组件里，分类可能写坏了');

// 「界面自己说了没行为」才是豁免的依据——所以那段披露必须真的存在。
// 披露被删掉而字段还在，就是**无披露的假承诺**，这里的断言保证它变红。
for (const d of DISCLOSED_NOT_IMPLEMENTED) {
  check(`「尚未生效」的披露仍然存在：${d.field}`,
    d.disclosure.test(disclosureText(d.file)),
    `${d.file} 里找不到披露文案了。字段 ${d.field} 只有界面在读、逻辑层从不读——` +
    `没有披露就是无说明的假承诺，要么补上行为，要么把「尚未生效」加回去`);
}

// 附条件豁免也必须仍然必要：如果行为真的接上了，披露和豁免都该清理掉。
for (const d of DISCLOSED_NOT_IMPLEMENTED) {
  const w = wiring.find((x) => x.field === d.field);
  check(`「尚未生效」豁免仍然必要：${d.field}`,
    !!w && w.reads > 0 && w.reads === w.compReads,
    `字段 ${d.field} 已经被逻辑层读取（或不存在）——行为接上了，` +
    `请把界面上的「尚未生效」撤掉、并删掉这条豁免，别让豁免留在原地变成永久通行证`);
}

// ---------------------------------------------------------------- 豁免不许腐烂
// 沿用 verify-copy 的教训：只检查"字段还在"不够，要检查"这条豁免还在起作用"。
for (const a of DISPLAY_ONLY_OK) {
  const w = wiring.find((x) => x.field === a.field);
  check(`豁免仍然必要：${a.field}`, !!w && w.reads > 0 && w.reads === w.compReads,
    `这条豁免已经用不上了（字段不存在、或已经被逻辑层读取）——请删掉它，` +
    `多余的豁免是在掩护问题，不是在澄清规则`);
}

// ---------------------------------------------------------------- 规则 3：导出了却无人引用
/**
 * 这一类是**「有实现、无入口」**——和前面两条正好相反：
 *
 *   规则 1/2：界面声称了代码做不到的事（有承诺、无实现）
 *   规则 3  ：代码有能力，但没有任何路径能到达它（有实现、无入口）
 *
 * 两者都是「界面与能力脱节」，只是方向反了。
 *
 * 这条规则第一次运行就抓到了 6 个：`cancelNativeDownload`（详见下）、
 * 以及 **4 个完整的 UI 组件**（`AndroidStatusBar` / `BreathingExercise` /
 * `PWAExportModal` / `SoundscapePlayer`）——它们从未被 import，也没有动态导入，
 * 也就是说用户根本到不了这些界面。
 *
 * ★ 引用搜索**必须包含 `tools/`**：有些导出只被断言使用（比如给测试用的纯函数），
 * 只扫 `src/` 会把他们误判成死代码。
 */
// 注意这里必须显式传扩展名：默认的 `/\.(tsx|ts)$/` 收不到 `.mts`。
//
// ★ 还必须把**本文件自己**排除掉——这是本项目第五次「检查匹配到自己」，
// 而且是最隐蔽的一次：被检查的名字只出现在本文件的 `ORPHAN_KNOWN` 登记表里，
// 而登记表是**代码**（一个数组字面量里的字符串），`stripComments` 剥不掉它。
// 后果：登记表把「孤儿」自己变成了「有人引用」，
// 于是死导出规则永远查不出孤儿，而「孤儿记录仍然成立」反而全部报错——
// 一个用来记录缺陷的清单，亲手把自己要查的缺陷藏了起来。
const SELF = 'verify-wiring.mts';
const refFiles = [
  ...files,
  ...walk('tools', [], /\.(mts|ts|tsx)$/).filter((f) => !f.endsWith(SELF)),
];
check('引用搜索排除了本文件（否则登记表会把自己要查的孤儿藏起来）',
  !refFiles.some((f) => f.endsWith(SELF)), refFiles.filter((f) => f.endsWith(SELF)).join('、'));
const refSources = refFiles.map((f) => stripComments(readFileSync(f, 'utf8')));

const exportNames = new Map<string, { file: string; dup: boolean }>();
for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const re = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g;
  for (const m of src.matchAll(re)) {
    const prev = exportNames.get(m[1]);
    if (prev) prev.dup = true;
    else exportNames.set(m[1], { file: relOf(file), dup: false });
  }
}

/** 已知「建好了但还到不了」的符号。每条都要写清去向，它同时也是给用户的待办清单。 */
const ORPHAN_KNOWN: Array<{ name: string; why: string }> = [
  { name: 'SoundscapePlayer', why: '声景播放器组件已完整，但没有入口——待产品决定' },
  { name: 'PWAExportModal', why: 'PWA 导出弹窗已完整，但没有入口——待产品决定' },
  { name: 'AndroidStatusBar', why: 'Android 状态栏配色组件，没有入口——可能已被主题系统取代，待确认后删除' },
  { name: 'moonLitPath', why: '月相相关的绘图辅助函数，未被使用——可能是重构遗留，待确认后删除' },
];

const orphans: Array<{ name: string; file: string }> = [];
for (const [name, info] of exportNames) {
  if (info.dup) continue;                       // 多处同名导出，无法可靠判定
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let total = 0;
  for (const src of refSources) total += [...src.matchAll(re)].length;
  if (total <= 1) orphans.push({ name, file: info.file });   // 只有定义处那一次
}

check('导出的符号都被引用到了（没有「有实现、无入口」）',
  orphans.every((o) => ORPHAN_KNOWN.some((k) => k.name === o.name)),
  orphans.filter((o) => !ORPHAN_KNOWN.some((k) => k.name === o.name))
    .map((o) => `${o.file} → ${o.name}`).join('、') +
  ' —— 要么接上入口，要么确认是废弃代码后删除');

// 已知孤儿也必须仍然"孤儿"：一旦有人给它接上入口，这条记录就该删掉。
for (const k of ORPHAN_KNOWN) {
  check(`孤儿记录仍然成立：${k.name}`,
    orphans.some((o) => o.name === k.name),
    `${k.name} 已经被引用了——说明它接上了入口，请把这条记录删掉（它是待办清单，不是永久豁免）`);
}

check('确实检查到了导出符号（不是空跑）', exportNames.size >= 50, `只收集到 ${exportNames.size} 个`);

// ---------------------------------------------------------------- 针对性回归：取消要真的取消
/**
 * 死导出规则能保证 `cancelNativeDownload` 被引用，但**保证不了它被用对**。
 *
 * 缺陷原状：`downloadLocalLlm` 的原生分支调 `plugin.downloadModel()` 时**不传 signal**，
 * UI 的「取消」只做 `abort()`——那只中止 JS 的等待，**原生下载会继续把 462 MB 跑完**。
 * 而 `setLlmProgress(null)` 在 await 之后，所以用户点了取消进度条也不消失，
 * 看起来像按钮坏了。
 *
 * 所以这里钉住接线本身：abort 必须挂到 cancelNativeDownload 上。
 */
{
  const llm = stripComments(readFileSync('src/utils/localLlmEngine.ts', 'utf8'));
  const start = llm.indexOf('export async function downloadLocalLlm');
  // ★ 边界必须用**代码**地标，不能用注释地标：
  // 上面刚 stripComments 剥掉了 `//`，再拿 `// Web：…` 去找边界必然找不到，
  // `indexOf` 返回 -1，`slice(0, -1)` 就退化成"整个文件剩余部分"——
  // 于是后面的 `cancelNativeDownload` **定义**也被算进来，条件恒真、断言空跑。
  // 这是我自己写的一条空跑断言，靠反向验证（拆掉接线它不报）才发现。
  // 注意必须**从 start 之后**开始找：`caches` 在文件更前面也出现过，
  // 不加 fromIndex 会拿到一个在 start 之前的边界（实测 start=5591 / end=3796），
  // 那样 scoped 为空、断言又会以另一种方式空跑。
  const end = llm.indexOf('if (typeof caches ===', start);
  check('断言能定位到原生分支的边界（否则下面的检查会空跑）',
    start >= 0 && end > start, `start=${start} end=${end}`);
  const scoped = start >= 0 && end > start ? llm.slice(start, end) : '';

  check('原生下载的取消被接到 AbortSignal 上',
    /addEventListener\('abort',\s*onAbort/.test(scoped) && /cancelNativeDownload\(\)/.test(scoped),
    'downloadLocalLlm 的原生分支没有把 abort 转到 cancelNativeDownload()——' +
    '用户点「取消」时原生下载会继续跑完');
  check('abort 监听器被摘掉（避免重复注册导致泄漏）',
    /removeEventListener\('abort',\s*onAbort/.test(scoped),
    '注册了 abort 监听却没有移除');
}

// ---------------------------------------------------------------- 汇总
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 接线护栏全部通过（${pass} 项断言，检查 ${wiring.length} 个可配置字段）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
