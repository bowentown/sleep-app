/**
 * 睡眠数据不变量自检
 *
 * 目的：把"记录字段之间必须成立的关系"写成可执行断言，防止任何一条记录路径
 * （实时监测 / 手动补录 / 一键记录 / 演示数据）产生自相矛盾的数据。
 *
 * 运行：npm run verify
 */
import { calculateSleepScore, generateSleepStages, clockAfter, timeInBedMinutes } from '../src/utils/sleepScore.js';
import { buildSleepRecord, getInitialSleepLogs } from '../src/utils/sleepRecord.js';
import { toLocalDateString } from '../src/utils/dateUtils.js';
import { isSafeHttpsUrl } from '../ssrfGuard.js';
import type { SleepRecord } from '../src/types/sleep.js';

// ---- 最小断言框架 ----
let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/**
 * 校验一条记录的全部内部一致性。
 * 语义约定（行业标准）：
 *   TIB (卧床) = wake - bed
 *   TST (总睡眠) = deep + light + rem        → record.durationMinutes
 *   SOL (潜伏期) = record.latencyMinutes
 *   awake        = SOL + WASO（含潜伏期）
 *   效率 SE      = TST / TIB
 */
function verifyRecord(tag: string, r: SleepRecord) {
  const tib = timeInBedMinutes(r.bedtime, r.wakeTime);
  const tst = r.durationMinutes;
  const stages = r.stages ?? [];
  const stageSum = stages.reduce((a, s) => a + s.durationMinutes, 0);
  const byStage = (stage: string) =>
    stages.filter((s) => s.stage === stage).reduce((a, s) => a + s.durationMinutes, 0);

  // 1) 分期总和 == 睡眠 + 清醒 == 卧床
  check(`${tag} 分期总和 = 时长 + 清醒`, stageSum === tst + r.awakeMinutes,
    `分期 ${stageSum} vs ${tst} + ${r.awakeMinutes} = ${tst + r.awakeMinutes}`);
  check(`${tag} 分期总和 = 真实卧床时长`, stageSum === tib, `分期 ${stageSum} vs 卧床 ${tib}`);

  // 2) 各分类分钟数与分期一致
  check(`${tag} 深睡分钟数 = 深睡分期之和`, byStage('deep') === r.deepSleepMinutes, `${byStage('deep')} vs ${r.deepSleepMinutes}`);
  check(`${tag} 浅睡分钟数 = 浅睡分期之和`, byStage('light') === r.lightSleepMinutes, `${byStage('light')} vs ${r.lightSleepMinutes}`);
  check(`${tag} REM 分钟数 = REM 分期之和`, byStage('rem') === r.remSleepMinutes, `${byStage('rem')} vs ${r.remSleepMinutes}`);
  check(`${tag} 清醒分钟数 = 清醒分期之和`, byStage('awake') === r.awakeMinutes, `${byStage('awake')} vs ${r.awakeMinutes}`);

  // 3) 总睡眠 == 深 + 浅 + REM
  check(`${tag} 总睡眠 = 深 + 浅 + REM`, tst === r.deepSleepMinutes + r.lightSleepMinutes + r.remSleepMinutes,
    `${tst} vs ${r.deepSleepMinutes + r.lightSleepMinutes + r.remSleepMinutes}`);

  // 4) 效率 = TST / TIB（用户看到的"睡眠效率"的定义）
  const expectedEff = Math.round((tst / tib) * 100);
  check(`${tag} 效率 = 总睡眠/卧床`, Math.abs(r.sleepEfficiency - expectedEff) <= 1,
    `记录 ${r.sleepEfficiency}% vs 应有 ${expectedEff}%`);

  // 5) 得分可复现
  const recomputed = calculateSleepScore(
    r.durationMinutes, r.deepSleepMinutes, r.remSleepMinutes,
    r.awakeMinutes, r.wakeCount, r.latencyMinutes
  );
  check(`${tag} 得分可复现`, recomputed.score === r.sleepScore, `重算 ${recomputed.score} vs 记录 ${r.sleepScore}`);
  check(`${tag} 效率可复现`, recomputed.efficiency === r.sleepEfficiency, `重算 ${recomputed.efficiency} vs 记录 ${r.sleepEfficiency}`);

  // 6) 取值范围 + 无 NaN
  check(`${tag} 得分在 0-100`, r.sleepScore >= 0 && r.sleepScore <= 100, String(r.sleepScore));
  check(`${tag} 效率在 0-100`, r.sleepEfficiency >= 0 && r.sleepEfficiency <= 100, String(r.sleepEfficiency));
  check(`${tag} 夜醒次数非负`, r.wakeCount >= 0, String(r.wakeCount));
  check(`${tag} 全部数值字段有限`,
    [r.durationMinutes, r.deepSleepMinutes, r.lightSleepMinutes, r.remSleepMinutes, r.awakeMinutes,
     r.sleepScore, r.sleepEfficiency, r.latencyMinutes, r.wakeCount].every(Number.isFinite),
    JSON.stringify([r.durationMinutes, r.awakeMinutes, r.sleepScore]));

  // 7) 夜醒次数 = 觉醒段数 - 潜伏期段
  const awakeSegments = stages.filter((s) => s.stage === 'awake').length;
  check(`${tag} 夜醒次数 = 觉醒段数-1`, r.wakeCount === Math.max(0, awakeSegments - 1),
    `记录 ${r.wakeCount} vs 段数 ${awakeSegments}`);

  // 8) 分期时间轴连续，且首尾与作息起止点吻合
  if (stages.length > 0) {
    check(`${tag} 首段起点 = bedtime`, stages[0].startTime === r.bedtime, `${stages[0].startTime} vs ${r.bedtime}`);
    let contiguous = true;
    for (let i = 1; i < stages.length; i++) {
      if (stages[i].startTime !== stages[i - 1].endTime) contiguous = false;
    }
    check(`${tag} 分期时间轴连续`, contiguous);
    check(`${tag} 末段终点 = wakeTime`, stages[stages.length - 1].endTime === r.wakeTime,
      `${stages[stages.length - 1].endTime} vs ${r.wakeTime}`);
  }
}

// ============ 场景 1：演示数据 ============
section('场景 1：7 天演示数据');
const demo = getInitialSleepLogs();
check('演示数据为 7 条', demo.length === 7, String(demo.length));
for (const r of demo) verifyRecord(`[${r.date}]`, r);

// ============ 场景 2：评分函数语义 ============
section('场景 2：评分函数语义');

const bad = calculateSleepScore(120, 30, 25, 300, 5, 60, 480); // 卧床 8h 只睡 2h
check('低效率不托底（真实 25% 不显示为 50%）', bad.efficiency < 40, `得到 ${bad.efficiency}%`);

const awful = calculateSleepScore(60, 0, 0, 60, 8, 60, 480);
check('极差睡眠得低分', awful.score < 30, `得到 ${awful.score}`);

const lyingAwake = calculateSleepScore(120, 30, 25, 420, 5, 60, 480); // 卧床 9h 仅睡 2h
const shortSleep = calculateSleepScore(120, 30, 25, 0, 0, 0, 480);     // 卧床 2h 睡 2h
check('低效长卧床 < 高效短睡眠（与 CBT-I 方向一致）', lyingAwake.score < shortSleep.score,
  `躺 9h 得 ${lyingAwake.score} vs 睡 2h 得 ${shortSleep.score}`);

const perfect = calculateSleepScore(480, 106, 106, 15, 0, 10, 480);
check('完美睡眠接近满分', perfect.score >= 90 && perfect.score <= 100, String(perfect.score));

for (const [d, a] of [[0, 0], [0, 480], [480, 0]] as const) {
  const s = calculateSleepScore(d, 0, 0, a, 0, 0, 480);
  check(`边界 (${d},${a}) 无 NaN`, Number.isFinite(s.score) && Number.isFinite(s.efficiency), JSON.stringify(s));
}

// 潜伏期只应被计一次：同样卧床、同样清醒总量，效率不应随 SOL/WASO 的拆分方式变化
const solHeavy = calculateSleepScore(420, 90, 80, 60, 0, 60, 480); // 清醒 60 全是潜伏期
const wasoHeavy = calculateSleepScore(420, 90, 80, 60, 4, 5, 480); // 清醒 60 中仅 5 是潜伏期
check('潜伏期不重复计入卧床（SOL/WASO 拆分不影响效率）', solHeavy.efficiency === wasoHeavy.efficiency,
  `${solHeavy.efficiency}% vs ${wasoHeavy.efficiency}%`);

// ============ 场景 3：分期生成器 ============
section('场景 3：分期生成器');
for (const [bed, wake, lat] of [
  ['23:15', '07:10', 14],
  ['00:20', '07:30', 28],
  ['01:05', '07:15', 35],
] as const) {
  const g = generateSleepStages(bed, wake, lat, 2);
  const sum = g.stages.reduce((a, s) => a + s.durationMinutes, 0);
  const tib = timeInBedMinutes(bed, wake);
  check(`generate(${bed}→${wake}) 分期填满卧床`, sum === tib, `分期 ${sum} vs 卧床 ${tib}`);
  check(`generate(${bed}→${wake}) 分量自洽`,
    g.deepMinutes + g.lightMinutes + g.remMinutes + g.awakeMinutes === sum,
    `${g.deepMinutes}+${g.lightMinutes}+${g.remMinutes}+${g.awakeMinutes} vs ${sum}`);
  check(`generate(${bed}→${wake}) 首段为潜伏期`, g.stages[0].stage === 'awake' && g.stages[0].durationMinutes === lat,
    `首段 ${g.stages[0].stage}/${g.stages[0].durationMinutes}`);
  check(`generate(${bed}→${wake}) 夜醒段数 = 请求值`, g.wakeCount === 2, String(g.wakeCount));
}

// ============ 场景 4：统一记录构造函数（真实入口） ============
section('场景 4：buildSleepRecord（四条入口）');

// 手动补录：潜伏期由用户输入
verifyRecord('[手动补录]', buildSleepRecord({
  date: '2026-09-28', bedtime: '23:30', wakeTime: '07:30',
  latencyMinutes: 15, wakeCount: 2, wakingMood: 'neutral',
  preSleepHabits: ['reading', 'hot_bath'], targetDurationMinutes: 480,
}));

// 实时监测 / 一键记录：卧床由实测分钟数派生 wakeTime（含极短与超长边界）
for (const tib of [1, 2, 5, 14, 15, 45, 90, 200, 480, 600, 900]) {
  const wake = clockAfter('23:00', tib);
  const r = buildSleepRecord({
    date: '2026-09-28', bedtime: '23:00', wakeTime: wake,
    latencyMinutes: 12, wakeCount: tib < 15 ? 0 : 1, targetDurationMinutes: 480,
  });
  check(`[实时 ${tib}min] 卧床 = 时长 + 清醒`, r.durationMinutes + r.awakeMinutes === tib,
    `${r.durationMinutes} + ${r.awakeMinutes} = ${r.durationMinutes + r.awakeMinutes} vs ${tib}`);
  verifyRecord(`[实时 ${tib}min]`, r);
}

// 夜醒次数 0-6 必须真实反映到分期上
for (let wc = 0; wc <= 6; wc++) {
  const r = buildSleepRecord({
    date: '2026-09-28', bedtime: '23:00', wakeTime: '07:00',
    latencyMinutes: 15, wakeCount: wc, targetDurationMinutes: 480,
  });
  const actual = r.stages!.filter((s) => s.stage === 'awake').length - 1;
  check(`[夜醒 ${wc}] 分期觉醒段数 = ${wc}`, actual === wc, String(actual));
}

// ============ 场景 5：本地日期 ============
section('场景 5：本地日期');
const d = toLocalDateString();
check('本地日期格式 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(d), d);
const morning = new Date();
morning.setHours(7, 30, 0, 0);
const expectedLocal = `${morning.getFullYear()}-${String(morning.getMonth() + 1).padStart(2, '0')}-${String(morning.getDate()).padStart(2, '0')}`;
check('早 7:30 取到本地当天日期（不是 UTC 前一天）', toLocalDateString(morning) === expectedLocal,
  `${toLocalDateString(morning)} vs ${expectedLocal}`);

// ============ 场景 6：SSRF 防护 ============
section('场景 6：SSRF 防护（用户可填的自定义 AI 地址）');

// 必须拦截
const mustBlock: ReadonlyArray<readonly [string, string]> = [
  ['', '空值'],
  ['not-a-url', '非法 URL'],
  ['http://api.deepseek.com', '非 HTTPS'],
  ['https://localhost/v1', 'localhost'],
  ['https://foo.localhost/v1', '.localhost 后缀'],
  ['https://127.0.0.1/v1', '回环（精确匹配）'],
  ['https://127.0.0.2/v1', '回环段内其他地址 ← 原实现的真实漏洞'],
  ['https://127.1/v1', '短式回环（URL 会规范化成 127.0.0.1）'],
  ['https://2130706433/v1', '十进制整数 IP（URL 会规范化）'],
  ['https://0x7f000001/v1', '十六进制 IP（URL 会规范化）'],
  ['https://017700000001/v1', '八进制 IP（URL 会规范化）'],
  ['https://0.0.0.0/v1', '未指定地址'],
  ['https://10.0.0.5/v1', '10/8 内网'],
  ['https://192.168.1.10/v1', '192.168/16 内网'],
  ['https://172.16.0.1/v1', '172.16/12 内网下边界'],
  ['https://172.31.255.254/v1', '172.16/12 内网上边界'],
  ['https://169.254.169.254/latest/meta-data/', '云元数据服务'],
  ['https://[::1]/v1', 'IPv6 回环'],
  ['https://[::ffff:127.0.0.1]/v1', 'IPv4 映射回环 ← 原实现的真实漏洞'],
  ['https://foo.internal/v1', '.internal 后缀'],
  ['https://printer.local/v1', '.local 后缀'],
];
for (const [u, why] of mustBlock) {
  check(`SSRF 拦截：${why}`, isSafeHttpsUrl(u) === false, `被放行 → ${u || '(空)'}`);
}

// 必须放行，避免误伤正常配置
const mustAllow = [
  'https://api.deepseek.com/v1',
  'https://api.openai.com/v1',
  'https://generativelanguage.googleapis.com',
  'https://api.siliconflow.cn/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://8.8.8.8/v1', // 公网 IP 字面量，应当放行
  'https://10.example.com/v1', // 以 "10." 开头的域名文字，不是内网 IP
  'https://127.example.com/v1', // 同理
];
for (const u of mustAllow) {
  check(`SSRF 放行：${u}`, isSafeHttpsUrl(u) === true, '被误拦');
}

// ============ 汇总 ============
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 全部通过（${pass} 项断言）`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
