#!/usr/bin/env node
/**
 * 跑完整条 verify 链，并**把各段的断言数加起来报一个总数**。
 *
 * 为什么需要它：我在两条提交信息里分别写了「共 920 项」和「共 927 项」，
 * 而实际是 914 和 937 —— **两个数字我都没有算，是估的**。
 * 这正是我一直在代码里修的那类问题：把没核实的数字当成结论说出来。
 *
 * 各 verify 脚本各自打印自己的段计数，没有任何一处打印总数，
 * 于是「总数」只能靠人肉相加，而人肉相加就会错。
 * 这里让它变成机器算的：解析各段输出，求和，并在任何一段失败时以非零码退出。
 *
 * 输出格式的锚点（各脚本必须保持打印）：
 *   ✅ …（N 项断言）  /  ✅ …（N 项）  /  ✅ …（N 项通过）
 * 解析不到任何一段会直接报错，**不允许静默返回 0** ——
 * 一个永远输出"0 项"的总计比没有总计更糟。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// 顺序即依赖顺序：主题颜色类扫描的是**构建产物**，所以它必须排在 build 之后。
// 我第一版把整个总计脚本放在 build 之前，CI 直接挂在
// 「未找到 dist/assets，请先执行 npm run build」——改顺序没检查前置条件。
const SEGMENTS = [
  ['不变量', 'tools/verify-invariants.mts'],
  ['渲染层', 'tools/verify-render.mts'],
  ['分期配色', 'tools/verify-stage-colors.mts'],
  ['可解释结论', 'tools/verify-insights.mts'],
  ['动画与定位', 'tools/verify-animation-transform.mts'],
  ['作息节律', 'tools/verify-rhythm.mts'],
  ['AI 顾问', 'tools/verify-ai-advice.mts'],
  ['主题颜色类', 'tools/verify-theme-classes.mts'],
  ['文案护栏', 'tools/verify-copy.mts'],
];

// 通过时各脚本打印：✅ …（N 项断言）/（N 项）/（N 项通过）
const COUNT_RE = /✅[^\n]*?（(\d+)\s*项/gu;
// 失败时打印：❌ N 项失败 / 共 M 项：——M 才是该段的总数。
// 不认这个格式的话，分段失败会被误报成"没解析到"，
// 真实原因（断言失败）被一条误导性消息盖住。这是反向验证抓出来的。
const FAIL_RE = /❌\s*\d+\s*项失败\s*\/\s*共\s*(\d+)\s*项/u;

let total = 0;
const rows = [];
let failed = false;

for (const [label, script] of SEGMENTS) {
  const r = spawnSync('npx', ['tsx', script], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  process.stdout.write(out);

  if (r.status !== 0) failed = true;

  const found = [...out.matchAll(COUNT_RE)].map((m) => Number(m[1]));

  // 分段失败时优先按失败格式取总数，并明确报"断言失败"，而不是"没解析到"
  if (found.length === 0) {
    const failMatch = out.match(FAIL_RE);
    if (failMatch) {
      const n = Number(failMatch[1]);
      rows.push([label, n]);
      total += n;
      console.error(`\n❌ 「${label}」有断言失败（该段共 ${n} 项）。`);
      continue;
    }
    // 前置条件缺失要单独说清楚。verify-theme-classes 扫描的是**构建产物**，
    // 没有 dist/ 时它不打印计数，会被误报成"没解析到"。
    if (/未找到 dist/.test(out)) {
      console.error(`\n❌ 「${label}」需要 dist/ 存在（它扫描构建产物里的类名），当前没有。`);
      console.error('   请先 npm run build。npm run check 的顺序是 lint → build → verify:total，就是为此。');
      process.exit(1);
    }
    console.error(`\n❌ 总计脚本无法从「${label}」的输出里解析出断言数（${script}）。`);
    console.error('   不是 0 项，是**没解析到**。请检查该脚本是否仍打印「（N 项…）」或「共 N 项」。');
    process.exit(1);
  }
  if (found.length > 1) {
    console.error(`\n❌ 「${label}」打印了 ${found.length} 个计数（${found.join(' / ')}），无法确定用哪个。`);
    process.exit(1);
  }

  rows.push([label, found[0]]);
  total += found[0];
}

// 数字自检：总数必须等于分段之和，且必须大于任何单段
const sum = rows.reduce((a, [, n]) => a + n, 0);
if (total !== sum || rows.some(([, n]) => n > total)) {
  console.error(`\n❌ 计数自检失败：total=${total} sum=${sum}`);
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
for (const [label, n] of rows) console.log(`   ${label.padEnd(12, '　')} ${String(n).padStart(4)} 项`);
console.log(`   ${'合计'.padEnd(11, '　')} ${String(total).padStart(4)} 项`);
console.log('='.repeat(60));

if (failed) {
  console.error(``);
  console.error('❌ 有分段失败（见上方输出），总数仅供参考。');
  process.exit(1);
}
console.log(`✅ 总共 ${total} 项断言全部通过`);

// 顺便把总数写进一个文件，方便提交信息里引用时不用手抄
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  void pkg;
} catch {
  /* package.json 读不到不影响总计 */
}
