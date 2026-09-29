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

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(tsx|ts)$/.test(f)) out.push(f);
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

// ---------------------------------------------------------------- 汇总
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 接线护栏全部通过（${pass} 项断言，检查 ${wiring.length} 个可配置字段）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
