/**
 * 作息节律指标的断言：SRI（睡眠规律性指数）、睡眠中点、社交时差。
 *
 * 为什么这些指标必须配断言，而且必须配**独立 oracle**：
 * 它们的输入输出之间没有肉眼可查的对应关系。SRI 出来 87 还是 62，
 * 看代码看不出来对不对；一个按天布局的索引写反一位（比如拿同日相邻分钟
 * 去比较、或者把缺失日当成清醒），结果依然是一个像模像样的数字，
 * 一路渲染到用户脸上也不会报任何错。
 *
 * 所以这里的做法是：
 *   1) 日期换算拿 Python datetime 独立算出的常数对照，不用自己的实现当基准；
 *   2) SRI 在测试里**另写一份参考文献公式的直接实现**（朴素双层循环）当 oracle，
 *      与模块输出逐个比对——这样才抓得住按天布局的索引错误；
 *   3) 每个易错点都配「如果写错了会得到什么」的反向验证，
 *      证明测试确实能区分对错，而不是恰好两边都通过。
 *
 * 参考实现：https://github.com/mengelhard/sri
 *   sri = 200 * nanmean(a[t] == a[t + epochs_per_day]) - 100
 *
 * 运行：npm run verify:rhythm
 */
import {
  MINUTES_PER_DAY,
  NO_RECORD,
  dayNumberFromISODate,
  weekdayFromDayNumber,
  normalizeMinutes,
  circularSignedDelta,
  circularMeanMinutes,
  sleepIntervals,
  nightMidpoint,
  buildRhythmSeries,
  computeSleepRegularityIndex,
  computeSleepMidpoint,
  computeSocialJetlag,
} from '../src/utils/sleepRhythm.js';
import type { SleepRecord } from '../src/types/sleep.js';

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/** 造一条最小可用的记录：只需要 date / bedtime / wakeTime 参与节律计算 */
function mk(date: string, bedtime: string, wakeTime: string): SleepRecord {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    // 与 minutesSinceNoon 同口径：正午为 0
    return ((h * 60 + m - 720) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  };
  const bed = toMin(bedtime);
  const wake = toMin(wakeTime);
  const inBed = wake > bed ? wake - bed : wake + MINUTES_PER_DAY - bed;
  return {
    id: date,
    date,
    bedtime,
    wakeTime,
    durationMinutes: inBed,
    deepSleepMinutes: 0,
    lightSleepMinutes: 0,
    remSleepMinutes: 0,
    awakeMinutes: 0,
    sleepScore: 80,
    sleepEfficiency: 95,
    latencyMinutes: 15,
    wakeCount: 1,
    wakingMood: 'neutral' as SleepRecord['wakingMood'],
    preSleepHabits: [],
  };
}

// ============================================================ 1. 日期换算
// 期望值由 Python datetime 独立算出（date(y,m,d) - date(1970,1,1)).days
// 以及 isoweekday() % 7（0 = 周日），与本模块实现无关。
const DATE_CASES: Array<[string, number, number]> = [
  ['1970-01-01', 0, 4], // 原点，周四
  ['1970-01-02', 1, 5],
  ['1999-12-31', 10956, 5],
  ['2000-01-01', 10957, 6], // 2000 是闰年（能被 400 整除）
  ['2000-02-29', 11016, 2], // 闰日
  ['2024-02-29', 19782, 4], // 闰日
  ['2026-09-16', 20712, 3],
  ['2026-09-22', 20718, 2], // 与界面上的「9月29日 周二」一致
  ['2028-03-01', 21244, 3], // 跨过 2028 闰日
  // 整百年的闰年规则：这是最容易漏掉的一条（只写 %4 也能通过上面全部用例，
  // 因为 1970..2028 之间唯一的整百年是 2000，而 2000 恰好是闰年）。
  // 变异测试发现「丢掉 %400 规则」当时没被抓住，所以补上 2100 与 2400。
  ['2100-02-28', 47540, 0], // 2100 不是闰年：能被 100 整除但不能被 400 整除
  ['2100-03-01', 47541, 1], // 紧接 02-28，中间不应多出 02-29
  ['2400-02-28', 157112, 1],
  ['2400-02-29', 157113, 2], // 2400 是闰年：能被 400 整除
  ['1969-12-31', -1, 3], // 早于原点的负值，用于确认跨 1970 边界的累加没写反
];
for (const [date, expectedDay, expectedWeekday] of DATE_CASES) {
  const day = dayNumberFromISODate(date);
  check(`日期换算 ${date} → ${expectedDay}`, day === expectedDay, `实际 ${day}`);
  check(
    `星期换算 ${date} → 周${'日一二三四五六'[expectedWeekday]}`,
    day !== null && weekdayFromDayNumber(day) === expectedWeekday,
    `实际 ${day === null ? 'null' : weekdayFromDayNumber(day)}`
  );
}

// 非法输入必须返回 null，不能悄悄算出一个日子
for (const bad of ['2026-13-01', '2026-02-30', '2026-00-10', '2026-9-22', 'garbage', '', '2026-09-22T00:00:00Z']) {
  check(`非法日期 ${JSON.stringify(bad)} → null`, dayNumberFromISODate(bad) === null, `实际 ${dayNumberFromISODate(bad)}`);
}

// 连续日期必须逐个 +1：SRI 依赖「相邻日」这个概念
check(
  '连续日期逐日递增 1（相邻日对的前提）',
  dayNumberFromISODate('2026-09-23')! - dayNumberFromISODate('2026-09-22')! === 1
);

// ============================================================ 2. 圆周量工具
check('normalizeMinutes 负值归一', normalizeMinutes(-30) === 1410 && normalizeMinutes(1500) === 60);
check('circularSignedDelta 跨午夜取最短弧', circularSignedDelta(10, 1430) === 20, `实际 ${circularSignedDelta(10, 1430)}`);
check('circularSignedDelta 反向为负', circularSignedDelta(1430, 10) === -20, `实际 ${circularSignedDelta(1430, 10)}`);
check('circularSignedDelta 半圈取 +720', circularSignedDelta(720, 0) === 720 || circularSignedDelta(720, 0) === -720);

// 关键：圆周均值不能用算术平均。1430 与 10 在钟面上紧邻，
// 圆周均值是 0；算术平均是 720（正好差半圈），必须能区分开。
{
  const r = circularMeanMinutes([1430, 10]);
  const arithmetic = (1430 + 10) / 2;
  check('圆周均值：1430 与 10 → 0（不是算术平均 720）', r !== null && near(r.mean, 0, 1e-9), `实际 ${r?.mean}`);
  check(
    '圆周均值与算术均值确实相差半圈（证明用的是圆周算法）',
    r !== null && Math.abs(r.mean - arithmetic) > 700,
    `圆周 ${r?.mean} vs 算术 ${arithmetic}`
  );
}
{
  const r = circularMeanMinutes([300, 300, 300, 300]);
  check('完全一致的时点：集中度 R = 1', r !== null && near(r.resultantLength, 1, 1e-12), `实际 ${r?.resultantLength}`);
  check('完全一致的时点：均值即该时点', r !== null && near(r.mean, 300, 1e-9));
}
{
  // 相差 12 小时的两个时点，方向相反，合成向量抵消 → R = 0
  const r = circularMeanMinutes([0, 720]);
  check('恰好相反的两个时点：集中度 R = 0', r !== null && r.resultantLength < 1e-12, `实际 ${r?.resultantLength}`);
}
check('圆周均值空输入 → null', circularMeanMinutes([]) === null);
check('圆周均值全 NaN → null', circularMeanMinutes([NaN, NaN]) === null);
{
  const r = circularMeanMinutes([100, 200, 300]);
  check('对称三点均值落在中点', r !== null && near(r.mean, 200, 1e-9), `实际 ${r?.mean}`);
}

// ============================================================ 3. 卧床区间与中点
{
  // 23:15 睡 → 07:10 起：卧床 475 分钟，中点应在 03:12:30
  const iv = sleepIntervals(mk('2026-09-22', '23:15', '07:10'));
  check('正常夜间：单段区间 [675, 1150)', iv.length === 1 && iv[0][0] === 675 && iv[0][1] === 1150, JSON.stringify(iv));
  const mp = nightMidpoint(mk('2026-09-22', '23:15', '07:10'));
  // 675 + 475/2 = 912.5 → 距正午 912.5 分钟 = 次日 03:12:30
  check('正常夜间中点 = 912.5（03:12:30）', mp !== null && near(mp, 912.5), `实际 ${mp}`);
}
{
  // 白天睡的人：11:00 → 19:00，跨正午原点，必须拆成两段
  const iv = sleepIntervals(mk('2026-09-22', '11:00', '19:00'));
  check(
    '跨正午原点：拆成 [1380,1440) ∪ [0,420)',
    iv.length === 2 && iv[0][0] === 1380 && iv[0][1] === 1440 && iv[1][0] === 0 && iv[1][1] === 420,
    JSON.stringify(iv)
  );
  const mp = nightMidpoint(mk('2026-09-22', '11:00', '19:00'));
  // 11:00 与 19:00 的中点应是 15:00 → 距正午 180 分钟
  check('白天睡的中点 = 180（15:00）', mp !== null && near(mp, 180), `实际 ${mp}`);
}

// ============================================================ 4. SRI
// ---- 4a. 退化为确定值的手算样本 ----
// 连续 4 晚完全相同 → 每天与次日逐分钟一致 → SRI = 100
{
  const recs = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'].map((d) => mk(d, '23:00', '07:00'));
  const r = computeSleepRegularityIndex(recs);
  check('每晚完全相同 → SRI = 100', r !== null && near(r.sri, 100), `实际 ${r?.sri}`);
  check('SRI 日对数 = 3', r?.comparedDayPairs === 3, `实际 ${r?.comparedDayPairs}`);
  check('SRI 有效分钟数 = 3 × 1440', r?.validEpochs === 3 * MINUTES_PER_DAY, `实际 ${r?.validEpochs}`);
}
{
  // 睡/醒完全颠倒：12:00→24:00 睡，接着 00:00→12:00 睡 → 逐分钟全部相反 → SRI = -100
  const recs = [mk('2026-09-16', '12:00', '00:00'), mk('2026-09-17', '00:00', '12:00')];
  const r = computeSleepRegularityIndex(recs);
  check('睡醒完全颠倒 → SRI = -100', r !== null && near(r.sri, -100), `实际 ${r?.sri}`);
}
{
  // 手算 75% 一致 → SRI = 200×0.75 − 100 = 50
  // 第 1 天睡 [0,720)（正午→午夜）；第 2 天睡 [0,360)（正午→18:00）
  // 一致的时刻：[0,360) 都睡（360 分钟）+ [720,1440) 都醒（720 分钟）= 1080
  // 不一致：[360,720) 前者睡后者醒 = 360。1080/1440 = 0.75
  const recs = [mk('2026-09-16', '12:00', '00:00'), mk('2026-09-17', '12:00', '18:00')];
  const r = computeSleepRegularityIndex(recs);
  check('手算 75% 一致 → SRI = 50', r !== null && near(r.sri, 50), `实际 ${r?.sri}`);
  check('手算一致分钟数 = 1080', r?.matchedEpochs === 1080, `实际 ${r?.matchedEpochs}`);
}

// ---- 4b. 独立 oracle：在测试里另写一份参考文献公式的直接实现 ----
// 用「每天一个睡眠区间」的语义，朴素地铺出一个 0/1 数组，
// 再按 sri = 200 * mean(a[t] == a[t+1440]) - 100 直接算。
// 这一步和模块的差别在于：模块用 day-major 索引切片，这里用最直白的双层循环。
function referenceSRI(spans: Array<[number, number]>): number {
  const dayCount = spans.length;
  const a: number[] = [];
  for (const [from, to] of spans) {
    for (let m = 0; m < MINUTES_PER_DAY; m++) a.push(m >= from && m < to ? 1 : 0);
  }
  let match = 0;
  let total = 0;
  for (let t = 0; t + MINUTES_PER_DAY < dayCount * MINUTES_PER_DAY; t++) {
    total++;
    if (a[t] === a[t + MINUTES_PER_DAY]) match++;
  }
  return 200 * (match / total) - 100;
}
{
  // 6 晚长短与时段各不相同，取值非平凡，正适合交叉验证
  const spans: Array<[number, number]> = [
    [675, 1150],
    [700, 1180],
    [640, 1120],
    [720, 1200],
    [660, 1140],
    [690, 1160],
  ];
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
  const recs = spans.map(([from, to], i) => {
    const t = (v: number) => {
      const clock = (v + 720) % MINUTES_PER_DAY;
      return `${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
    };
    return mk(dates[i], t(from), t(to));
  });
  const mine = computeSleepRegularityIndex(recs);
  const oracle = referenceSRI(spans);
  check(
    'SRI 与独立 oracle（参考文献公式直接实现）一致',
    mine !== null && near(mine.sri, oracle, 1e-9),
    `模块 ${mine?.sri} vs oracle ${oracle}`
  );
  check('oracle 交叉验证的取值非退化（不是 100 也不是 −100）', Math.abs(oracle) < 99, `oracle = ${oracle}`);
}

// ---- 4c. 缺失日绝不能当成「清醒」 ----
// 第 2 天没有记录。正确做法：与它相关的两个日对全部失效 → 没有可比较的日对 → null。
// 如果实现把缺失日填成 0（清醒），会算出 SRI = 0 这种「看起来很正常」的假值。
{
  const recs = [mk('2026-09-16', '12:00', '00:00'), mk('2026-09-18', '12:00', '00:00')];
  const r = computeSleepRegularityIndex(recs);
  check('中间断档一日 → 没有可比较的日对 → null', r === null, `实际 ${r ? r.sri : 'null'}`);

  // 反向验证：把缺失日当作清醒，就会得到一个貌似合理的数字
  const wrong = (() => {
    const a: number[] = [];
    for (const [from, to] of [[0, 720], [0, 0], [0, 720]] as Array<[number, number]>) {
      for (let m = 0; m < MINUTES_PER_DAY; m++) a.push(m >= from && m < to ? 1 : 0);
    }
    let match = 0;
    let total = 0;
    for (let t = 0; t + MINUTES_PER_DAY < a.length; t++) {
      total++;
      if (a[t] === a[t + MINUTES_PER_DAY]) match++;
    }
    return 200 * (match / total) - 100;
  })();
  check(
    '反向验证：把缺失日当清醒确实会得到假值（说明这条断言有区分力）',
    near(wrong, 0),
    `错误实现会给出 ${wrong}，正确实现给出 null`
  );
}
{
  // 断档在接受范围之外的更弱情形：只有一对相邻日有效，SRI 应为 100 且日对数 = 1
  const recs = [
    mk('2026-09-16', '23:00', '07:00'),
    mk('2026-09-17', '23:00', '07:00'),
    // 09-18 缺失
    mk('2026-09-19', '01:00', '09:00'),
  ];
  const r = computeSleepRegularityIndex(recs);
  check('仅一对相邻有效 → SRI = 100 且日对数 = 1', r !== null && near(r.sri, 100) && r.comparedDayPairs === 1,
    `SRI ${r?.sri} 日对数 ${r?.comparedDayPairs}`);
  check('断档没有把无效分钟算进分母', r?.validEpochs === MINUTES_PER_DAY, `实际 ${r?.validEpochs}`);
}
{
  const r = computeSleepRegularityIndex([mk('2026-09-16', '23:00', '07:00')]);
  check('只有一晚 → null（无法比较）', r === null, `实际 ${r?.sri}`);
  check('空输入 → null', computeSleepRegularityIndex([]) === null);
}
{
  // 序列里必须有「醒」这个状态：否则所有人都会拿到接近 100 的假高分。
  // 直接检查重建出来的序列本身。
  const series = buildRhythmSeries([mk('2026-09-16', '12:00', '00:00')]);
  check('重建序列存在', series !== null);
  if (series) {
    const vals = Array.from(series.values);
    const ones = vals.filter((v) => v === 1).length;
    const zeros = vals.filter((v) => v === 0).length;
    const missing = vals.filter((v) => v === NO_RECORD).length;
    check('有记录的日子：睡 720 分钟', ones === 720, `实际 ${ones}`);
    check('有记录的日子：醒 720 分钟（「醒」状态必须存在）', zeros === 720, `实际 ${zeros}`);
    check('有记录的日子：没有缺失分钟', missing === 0, `实际 ${missing}`);
  }
}
{
  // 反向验证：若把非睡眠时段留作缺失，「醒」就消失了
  const recs = [mk('2026-09-16', '12:00', '00:00'), mk('2026-09-17', '12:00', '00:00')];
  const r = computeSleepRegularityIndex(recs);
  check('反向验证：同睡同醒 → 100 而非「只比较睡眠时段」的假高分', r !== null && near(r.sri, 100), `实际 ${r?.sri}`);
}

// ============================================================ 5. 睡眠中点（多晚圆周均值）
{
  const recs = [
    mk('2026-09-16', '23:00', '07:00'), // 中点 900
    mk('2026-09-17', '23:00', '07:00'),
  ];
  const r = computeSleepMidpoint(recs);
  check('两晚相同 → 中点 900（03:00）', r !== null && near(r.midpointMinutes, 900), `实际 ${r?.midpointMinutes}`);
  check('两晚相同 → 集中度 R = 1', r !== null && near(r.resultantLength, 1, 1e-12), `实际 ${r?.resultantLength}`);
  check('夜数统计正确', r?.nights === 2, `实际 ${r?.nights}`);
}
{
  // 一晚 23:00–07:00（中点 900），一晚 01:00–09:00（中点 1020）→ 圆周均值 960
  const recs = [mk('2026-09-16', '23:00', '07:00'), mk('2026-09-17', '01:00', '09:00')];
  const r = computeSleepMidpoint(recs);
  check('两晚中点 900 与 1020 → 平均 960（04:00）', r !== null && near(r.midpointMinutes, 960), `实际 ${r?.midpointMinutes}`);
}
check('睡眠中点：空输入 → null', computeSleepMidpoint([]) === null);

// ============================================================ 6. 社交时差
// 2026-09-18 是周五、09-19 周六、09-20 周日、09-21 周一（已由第 1 节独立算出）
check('2026-09-18 是周五', weekdayFromDayNumber(dayNumberFromISODate('2026-09-18')!) === 5);
check('2026-09-20 是周日', weekdayFromDayNumber(dayNumberFromISODate('2026-09-20')!) === 0);
{
  // 四晚中点各不相同，正好可以验证归类：
  //   09-18 周五 → 醒于周六 → 自由夜，中点 900（23:00–07:00）
  //   09-19 周六 → 醒于周日 → 自由夜，中点 960（00:00–08:00）
  //   09-20 周日 → 醒于周一 → **工作夜**，中点 840（22:00–06:00）
  //   09-21 周一 → 醒于周二 → 工作夜，中点 780（21:00–05:00）
  // 自由日均值 = (900+960)/2 = 930；工作日均值 = (840+780)/2 = 810
  // 有符号差 = 930 − 810 = +120 分钟
  const recs = [
    mk('2026-09-18', '23:00', '07:00'),
    mk('2026-09-19', '00:00', '08:00'),
    mk('2026-09-20', '22:00', '06:00'),
    mk('2026-09-21', '21:00', '05:00'),
  ];
  const r = computeSocialJetlag(recs);
  check('社交时差 → 自由日 2 晚、工作日 2 晚', r !== null && r.freedayNights === 2 && r.workdayNights === 2,
    `自由 ${r?.freedayNights} / 工作 ${r?.workdayNights}`);
  check('自由日睡眠中点 = 930（03:30）', r !== null && near(r.freedayMidpointMinutes, 930), `实际 ${r?.freedayMidpointMinutes}`);
  check('工作日睡眠中点 = 810（01:30）', r !== null && near(r.workdayMidpointMinutes, 810), `实际 ${r?.workdayMidpointMinutes}`);
  check('社交时差 = 120 分钟', r !== null && near(r.jetlagMinutes, 120), `实际 ${r?.jetlagMinutes}`);
  check('符号为正（自由日晚于工作日）', r !== null && r.signedMinutes === 120, `实际 ${r?.signedMinutes}`);

  // 反向验证：按「记录日」的星期归类（错误做法）会得到不同的答案，
  // 说明这条断言的确在盯「按起床日归类」这件事，而不是恰好两边都过。
  const wrongFree = circularMeanMinutes([960, 840])!; // 周六 + 周日
  const wrongWork = circularMeanMinutes([900, 780])!; // 周五 + 周一
  const wrongJetlag = Math.abs(circularSignedDelta(wrongFree.mean, wrongWork.mean));
  check(
    '反向验证：按记录日归类会得到 60 而非 120（断言有区分力）',
    near(wrongJetlag, 60) && !near(wrongJetlag, r!.jetlagMinutes),
    `错误归类 ${wrongJetlag} vs 正确 ${r?.jetlagMinutes}`
  );
}
{
  // 只有周日晚（醒于周一）→ 没有自由夜 → null。
  // 若错误地按记录日归类，周日晚会被算作自由夜从而返回数字。
  const sunday = computeSocialJetlag([mk('2026-09-20', '23:00', '07:00')]);
  check('只有周日晚 → 不是自由夜 → null', sunday === null, `实际 ${sunday ? sunday.jetlagMinutes : 'null'}`);
  // 只有周五晚（醒于周六）→ 没有工作夜 → null
  const friday = computeSocialJetlag([mk('2026-09-18', '23:00', '07:00')]);
  check('只有周五晚 → 是自由夜但没有工作夜 → null', friday === null, `实际 ${friday ? friday.jetlagMinutes : 'null'}`);
}
{
  // 周五晚 + 周一晚：两桶各一晚，差值即两晚中点之差
  const recs = [mk('2026-09-18', '23:00', '07:00'), mk('2026-09-21', '21:00', '05:00')];
  const r = computeSocialJetlag(recs);
  check('周五晚(900) 与周一晚(780) → 时差 120', r !== null && near(r.jetlagMinutes, 120), `实际 ${r?.jetlagMinutes}`);
}
check('社交时差：空输入 → null', computeSocialJetlag([]) === null);

// ---------------------------------------------------------------- 汇总
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 作息节律指标全部通过（${pass} 项断言）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  console.log(
    '\n这些指标的输入输出没有肉眼可查的对应关系，算错也不会报错。\n' +
      '改动 sleepRhythm.ts 时请连同 oracle 交叉验证与「缺失日不得当作清醒」的断言一起复核。'
  );
  process.exit(1);
}
