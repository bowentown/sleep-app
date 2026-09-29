/**
 * 「可解释结论」的断言：按时段状态、睡眠负债、作息规律性、一句话总结。
 *
 * 为什么这些也要断言：它们全都是文案。文案错了不会被类型检查、构建或任何
 * 运行时错误拦住——「超过目标就寝 1018 分钟」这种输出可以一路顺畅地渲染到
 * 用户脸上。这里把每句话的成立条件写下来。
 *
 * 最容易错的是跨午夜：23:30 与 00:20 只差 50 分钟，但如果直接对小时取分钟数，
 * 会被算成相隔 23 小时 10 分。就寝时间的均值、标准差、早晚比较全部依赖这一点。
 *
 * 运行：npm run verify:insights
 */
import {
  buildTargetTimeline,
  describeDelta,
  describeVsSelf,
  describeMoodVsScore,
  scoreBand,
  minutesSinceNoon,
  fromMinutesSinceNoon,
  getBedtimeStatus,
  computeSleepDebt,
  computeBedtimeRegularity,
  buildMorningSummary,
  describeWeekExtreme,
} from '../src/utils/sleepInsights.js';
import { buildSleepRecord, getInitialSleepLogs } from '../src/utils/sleepRecord.js';
import { formatDurationChinese } from '../src/utils/sleepScore.js';

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// 构造一条记录的唯一入口仍是 buildSleepRecord（见 README）。目标时长固定 8 小时，
// 这样负债/盈余的口径不会随默认值漂移。
const TARGET_MINUTES = 480;

function rec(date: string, bedtime: string, wakeTime: string) {
  return buildSleepRecord({ date, bedtime, wakeTime });
}

// ---------------------------------------------------------------- 跨午夜换算
section('跨午夜换算：分钟数必须单调递增');

{
  const cases: [string, number][] = [
    ['12:00', 0],
    ['18:00', 360],
    ['23:00', 660],
    ['23:30', 690],
    ['00:00', 720],
    ['00:20', 740],
    ['07:30', 1170],
  ];
  for (const [hhmm, expected] of cases) {
    check(`minutesSinceNoon(${hhmm}) = ${expected}`, minutesSinceNoon(hhmm) === expected,
      `实际 ${minutesSinceNoon(hhmm)}`);
  }

  // 这一条是全部跨午夜逻辑的根基：深夜要排在午夜之前，凌晨要排在午夜之后。
  const seq = ['21:00', '23:30', '00:20', '03:00', '07:30'].map(minutesSinceNoon);
  check('22:00→23:30→00:20→03:00→07:30 严格递增',
    seq.every((v, i) => i === 0 || v > seq[i - 1]),
    `实际序列 ${seq.join(', ')}——若不递增，说明把跨午夜算成了一整天`);

  check('fromMinutesSinceNoon 往返一致',
    ['23:30', '00:20', '07:30'].every((t) => fromMinutesSinceNoon(minutesSinceNoon(t)) === t),
    ['23:30', '00:20', '07:30'].map((t) => `${t}→${fromMinutesSinceNoon(minutesSinceNoon(t))}`).join(' '));

  // 非法输入不应算出数字
  check('非法时间返回 NaN', !Number.isFinite(minutesSinceNoon('')), `实际 ${minutesSinceNoon('')}`);
}

// ---------------------------------------------------------------- 按时段状态
section('首页就寝卡的按时段状态');

{
  const at = (h: number, m: number) => new Date(2026, 8, 28, h, m);
  const TARGET = '23:00';

  const daytime = getBedtimeStatus(at(14, 0), TARGET);
  check('下午显示「今晚目标 23:00 就寝」', daytime.tone === 'daytime' && daytime.headline.includes('23:00'),
    `${daytime.tone} / ${daytime.headline}`);

  const soon = getBedtimeStatus(at(22, 40), TARGET);
  check('22:40 显示距目标 20 分钟', soon.tone === 'windDown' && soon.headline.includes('20分钟'),
    `${soon.tone} / ${soon.headline}`);

  // 边界：睡前窗口是 2 小时。20:00（距目标 3 小时）算白天，
  // 21:00（正好 2 小时）进入倒计时——4 小时前提醒就寝没有意义。
  const outside = getBedtimeStatus(at(20, 0), TARGET);
  check('20:00（距目标 3 小时）归入白天', outside.tone === 'daytime', `${outside.tone} / ${outside.headline}`);

  const boundary = getBedtimeStatus(at(21, 0), TARGET);
  check('21:00（正好 2 小时）进入倒计时', boundary.tone === 'windDown' && boundary.headline.includes('2小时'),
    `${boundary.tone} / ${boundary.headline}`);

  // 正好到点：不能说「已超过 0分钟」——一分钟都没超过
  const exactly = getBedtimeStatus(at(23, 0), TARGET);
  check('正好到目标就寝时不显示「已超过 0分钟」',
    exactly.tone === 'windDown' && !/已超过\s*0/.test(exactly.headline),
    `${exactly.tone} / ${exactly.headline}`);

  const late = getBedtimeStatus(at(23, 50), TARGET);
  check('23:50 显示已超过 50 分钟', late.tone === 'overdue' && late.headline.includes('50分钟'),
    `${late.tone} / ${late.headline}`);

  const deepNight = getBedtimeStatus(at(2, 0), '23:30');
  check('凌晨 2:00 跨午夜算出超过 2 小时 30 分',
    deepNight.tone === 'overdue' && deepNight.headline.includes('2小时30分'),
    `${deepNight.tone} / ${deepNight.headline}`);

  // 超过 4 小时就不该再喊「超时了」——那是「已经过了那一夜」
  const nextDay = getBedtimeStatus(at(5, 0), TARGET);
  check('05:00 不再喊超时（已过那一夜）', nextDay.tone === 'daytime', `${nextDay.tone} / ${nextDay.headline}`);

  // 时间推进时档位只能单向走：白天 → 临近 → 超时 → 白天
  const tones = ['20:00', '22:30', '23:30', '01:00', '06:00']
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      return getBedtimeStatus(at(h, m), TARGET).tone;
    });
  check('档位随时间单调：daytime→windDown→overdue→daytime',
    tones.join(',') === 'daytime,windDown,overdue,overdue,daytime', `实际 ${tones.join(',')}`);

  // 文案里的分钟数必须与 minutesToTarget 一致，不能一个算错
  const s = getBedtimeStatus(at(23, 50), TARGET);
  check('文案中的数字与 minutesToTarget 同源',
    s.headline.includes(formatDurationChinese(-s.minutesToTarget)), `${s.headline} / ${s.minutesToTarget}`);

  // 目标时间脏数据不应崩，也不能算出假数字
  const bad = getBedtimeStatus(at(23, 0), '不是时间');
  check('目标就寝时间非法时回退为白天文案', bad.tone === 'daytime' && Number.isFinite(bad.minutesToTarget),
    `${bad.tone} / ${bad.headline}`);
}

// ---------------------------------------------------------------- 睡眠负债
section('睡眠负债：缺口与盈余必须分开统计');

{
  // 三晚偏短 + 一晚偏长。目标 8 小时。
  const records = [
    rec('2026-09-22', '23:30', '04:30'), // 约 5 小时
    rec('2026-09-23', '23:30', '04:30'),
    rec('2026-09-24', '23:30', '04:30'),
    rec('2026-09-25', '23:00', '08:30'), // 约 9.5 小时
  ];

  const debt = computeSleepDebt(records, TARGET_MINUTES);
  const tsts = records.map((r) => r.durationMinutes);

  const expectedShortfall = tsts.reduce((a, t) => a + Math.max(0, TARGET_MINUTES - t), 0);
  const expectedSurplus = tsts.reduce((a, t) => a + Math.max(0, t - TARGET_MINUTES), 0);

  check('缺口 = 逐日不足之和', debt.shortfallMinutes === expectedShortfall,
    `实际 ${debt.shortfallMinutes}，期望 ${expectedShortfall}`);
  check('盈余 = 逐日超出之和', debt.surplusMinutes === expectedSurplus,
    `实际 ${debt.surplusMinutes}，期望 ${expectedSurplus}`);
  check('净值 = 缺口 − 盈余', debt.netMinutes === debt.shortfallMinutes - debt.surplusMinutes,
    `${debt.netMinutes} vs ${debt.shortfallMinutes} - ${debt.surplusMinutes}`);

  // 这是本函数存在的理由：一晚 9.5 小时不该把三晚各欠 3 小时的负债抹平。
  // 如果只算净值，就会显示成「负债变少了」，而作息其实是乱的。
  check('一晚超长不会削减累计缺口（缺口只增不减）',
    debt.shortfallMinutes > debt.netMinutes && debt.surplusMinutes > 0,
    `缺口 ${debt.shortfallMinutes} / 净值 ${debt.netMinutes} / 盈余 ${debt.surplusMinutes}`);

  check('天数与记录数一致', debt.days === records.length, `实际 ${debt.days}`);

  const empty = computeSleepDebt([], TARGET_MINUTES);
  check('空记录时全为 0', empty.shortfallMinutes === 0 && empty.netMinutes === 0 && empty.days === 0,
    JSON.stringify(empty));
}

// ---------------------------------------------------------------- 作息规律性
section('作息规律性：跨午夜的标准差');

{
  check('少于 2 条记录返回 null（一晚算不出波动）',
    computeBedtimeRegularity([rec('2026-09-22', '23:00', '07:00')]) === null,
    String(computeBedtimeRegularity([rec('2026-09-22', '23:00', '07:00')])));

  // 23:00 与 23:30：样本标准差 = sqrt(2×15²/1) ≈ 21.2
  const near = computeBedtimeRegularity([
    rec('2026-09-22', '23:00', '07:00'),
    rec('2026-09-23', '23:30', '07:00'),
  ]);
  check('23:00 与 23:30 的标准差 ≈ 21.2 分钟',
    near !== null && Math.abs(near.stdDevMinutes - 21.2) < 0.1,
    `实际 ${near?.stdDevMinutes.toFixed(1)}`);
  check('平均就寝时间 = 23:15', near?.meanBedtime === '23:15', `实际 ${near?.meanBedtime}`);
  check('跨度 = 30 分钟', near?.spanMinutes === 30, `实际 ${near?.spanMinutes}`);

  // 关键回归：跨午夜。23:30 与 00:30 实际只差 60 分钟。
  // 若用了绝对小时数，标准差会算成约 1018 分钟（≈17 小时）。
  const across = computeBedtimeRegularity([
    rec('2026-09-22', '23:30', '07:00'),
    rec('2026-09-23', '00:30', '07:00'),
  ]);
  check('跨午夜（23:30 / 00:30）标准差 ≈ 42.4 分钟，而不是约 1018',
    across !== null && Math.abs(across.stdDevMinutes - 42.4) < 0.2,
    `实际 ${across?.stdDevMinutes.toFixed(1)}——若接近 1018 说明把跨午夜当成了一整天`);
  check('跨午夜的平均就寝时间 = 00:00', across?.meanBedtime === '00:00', `实际 ${across?.meanBedtime}`);
  check('跨午夜跨度 = 60 分钟', across?.spanMinutes === 60, `实际 ${across?.spanMinutes}`);

  // 规律与不规律的对比：标准差要能真的区分开
  const regular = computeBedtimeRegularity(
    ['23:00', '23:05', '22:55', '23:02', '22:58'].map((b, i) =>
      rec(`2026-09-2${i + 1}`, b, '07:00'))
  );
  const irregular = computeBedtimeRegularity(
    ['21:30', '01:10', '22:40', '02:30', '23:50'].map((b, i) =>
      rec(`2026-09-2${i + 1}`, b, '07:00'))
  );
  check('规律作息的波动明显小于不规律作息',
    regular !== null && irregular !== null && regular.stdDevMinutes < 10 && irregular.stdDevMinutes > 60,
    `规律 ${regular?.stdDevMinutes.toFixed(1)} / 不规律 ${irregular?.stdDevMinutes.toFixed(1)}`);

  // 就寝时间非法时不应把 NaN 混进统计。
  // 注意这里要放 3 条：只有 1 条有效记录时返回 null 是正确行为（见上一条）。
  const dirty = computeBedtimeRegularity([
    rec('2026-09-22', '23:00', '07:00'),
    rec('2026-09-23', '23:30', '07:00'),
    { ...rec('2026-09-24', '23:15', '07:00'), bedtime: 'xx:yy' },
  ]);
  check('单条脏数据被剔除后仍能算出结果', dirty !== null && Number.isFinite(dirty.stdDevMinutes),
    `实际 ${dirty === null ? 'null' : dirty.stdDevMinutes}`);
  check('脏数据被剔除后不影响另两条的计算（标准差 ≈ 21.2）',
    dirty !== null && Math.abs(dirty.stdDevMinutes - 21.2) < 0.1,
    `实际 ${dirty?.stdDevMinutes.toFixed(1)}`);
}

// ---------------------------------------------------------------- 一句话总结
section('起床后的一句话总结');

{
  const week = [
    rec('2026-09-22', '23:20', '07:10'),
    rec('2026-09-23', '23:40', '06:40'),
    rec('2026-09-24', '00:10', '07:30'),
    rec('2026-09-25', '23:15', '07:10'),
  ];
  const best = week.reduce((a, b) => (b.sleepScore > a.sleepScore ? b : a));
  const worst = week.reduce((a, b) => (b.sleepScore < a.sleepScore ? b : a));

  const sBest = buildMorningSummary(best, week, TARGET_MINUTES, '23:30');
  const sWorst = buildMorningSummary(worst, week, TARGET_MINUTES, '23:30');

  // 总结只写「表格里没有的东西」：与目标的差值、本周极值。
  // 总睡眠/效率/深睡分钟数在正下方的数据表里已经有了，复述一遍会让这一行
  // 长一倍，读者还要在两组相同的数字之间对照。所以这里反过来断言
  // 「不许出现」这些字段，防止以后又被加回去。
  check('总结不复述数据表里的总睡眠时长', !sBest.includes('总睡眠'), sBest);
  check('总结不复述数据表里的效率', !sBest.includes('效率'), sBest);
  check('总结不复述数据表里的深睡分钟数', !sBest.includes('深睡'), sBest);
  // 「本周最佳/最差」现在是卡片头部的徽标，不再拼进小结（拼进去实测要 315px，
  // 而卡内可用宽只有 326px，余量 11px）。它讲的是**这一周**，不是这一晚，
  // 所以由 describeWeekExtreme 单独给出，渲染在日期旁边。
  check('最高分被标为「本周最佳」', describeWeekExtreme(best, week) === '本周最佳',
    String(describeWeekExtreme(best, week)));
  check('最低分被标为「本周最差」', describeWeekExtreme(worst, week) === '本周最差',
    String(describeWeekExtreme(worst, week)));
  check('小结里不再重复写本周极值',
    !sBest.includes('本周最佳') && !sBest.includes('本周最差'), sBest);
  check('记录不足 3 天时不给「本周最佳/最差」', describeWeekExtreme(best, week.slice(0, 2)) === null,
    String(describeWeekExtreme(best, week.slice(0, 2))));

  // **小结必须放得下一行**。390px 宽的手机上卡片左右各 16px 内边距，
  // 卡内可用宽 326px（浏览器实测）。
  //
  // 只数字数不够准：汉字与数字宽度差近一倍。这里按 14px 的实测字宽估算。
  // 权重故意取大一点（宁可保守），并用浏览器 getBoundingClientRect 校准过：
  //   「…少睡24分、晚睡15分」          估算 252px / 实测 240.3px
  //   「…少睡24分、晚睡15分 · 本周最佳」 估算 329px / 实测 315.2px ← 只剩 11px 余量
  // 估算比实测大约高 4%，方向是对的：估算说放得下，实际就放得下。
  // 字体或字号一改，这两个权重和阈值都要重新量。
  const estimateWidth = (text: string) =>
    [...text].reduce((w, ch) => (/[\u4e00-\u9fa5]/.test(ch) ? w + 14 : w + 7), 0);
  check('小结放得下一行（估算宽度 ≤ 300px）', estimateWidth(sBest) <= 300,
    `估 ${Math.round(estimateWidth(sBest))}px / 可用 326px：「${sBest}」`);
  check('小结不超过 26 字', sBest.length <= 26, `${sBest.length} 字：${sBest}`);

  // 上面测的是**恰好只产生一个差值**的那条记录（最坏情况没被覆盖：
  // 把极值拼回去时它估 259px，照样过）。真正决定放不放得下的是最坏情况——
  // 最长的开头（「整体还可以」）+ 两个三位数差值。
  // 不测这个，断言就只是「今天这条数据放得下」，拦不住任何回归。
  const worstCase = '整体还可以 · 比目标少睡 120分、晚睡 115分';
  check('最坏情况下小结也放得下一行', estimateWidth(worstCase) <= 300,
    `估 ${Math.round(estimateWidth(worstCase))}px / 可用 326px：「${worstCase}」`);
  check('总结用 · 分段而不是逗号长句', sBest.includes(' · ') && !sBest.includes('，'), sBest);
  check('总结不以句号结尾（它是标语而不是句子）', !sBest.endsWith('。'), sBest);

  // 跨午夜的早晚比较：就寝 23:15 早于目标 23:30 → 应说「早睡」
  const early = buildMorningSummary(
    { ...best, bedtime: '23:15' }, week, TARGET_MINUTES, '23:30');
  check('就寝早于目标时说「早睡」', early.includes('早睡'), early);

  const late = buildMorningSummary(
    { ...best, bedtime: '23:45' }, week, TARGET_MINUTES, '23:30');
  check('就寝晚于目标时说「晚睡」', late.includes('晚睡'), late);

  // 跨午夜的另一侧：目标 23:30，实际 00:10 → 是「晚睡 40 分钟」而不是「早睡 23 小时」
  const afterMidnight = buildMorningSummary(
    { ...best, bedtime: '00:10' }, week, TARGET_MINUTES, '23:30');
  check('00:10 相对目标 23:30 判定为晚睡而非早睡',
    afterMidnight.includes('晚睡') && !afterMidnight.includes('早睡'), afterMidnight);

  // 差异小于 15 分钟时不应写进结论，避免把噪声说成事实
  const tiny = buildMorningSummary(
    { ...best, bedtime: '23:35', durationMinutes: TARGET_MINUTES + 5 },
    week, TARGET_MINUTES, '23:30');
  check('差异不足 15 分钟时不提「早睡/晚睡/多睡/少睡」',
    !tiny.includes('早睡') && !tiny.includes('晚睡') && !tiny.includes('多睡') && !tiny.includes('少睡'),
    tiny);

  // 天数不足 3 天时不该出现「本周最好」这种断言
  const twoDays = week.slice(0, 2);
  const sTwo = buildMorningSummary(twoDays[0], twoDays, TARGET_MINUTES, '23:30');
  check('不足 3 天时不评价「本周最好/最差」',
    !sTwo.includes('本周最好') && !sTwo.includes('本周最差'), sTwo);

  // 全部同分时几天都会自称「最好的一晚」，必须都不说
  const tied = week.map((r) => ({ ...r, sleepScore: 80 }));
  const sTied = buildMorningSummary(tied[0], tied, TARGET_MINUTES, '23:30');
  check('全部同分时不评价「本周最好/最差」',
    !sTied.includes('本周最好') && !sTied.includes('本周最差'), sTied);
}

// ---------------------------------------------------------------- 昨夜 vs 目标时间轴
section('昨夜 vs 目标时间轴');

{
  // 就寝 23:15（比目标 23:30 早 15 分）、起床 07:10（比目标 07:30 早 20 分）
  const tl = buildTargetTimeline('23:15', '07:10', '23:30', '07:30');
  check('时间轴能算出几何', tl !== null, '不应为 null');

  if (tl) {
    check('就寝差为 −15 分钟（早于目标）', tl.bedDeltaMinutes === -15, `实际 ${tl.bedDeltaMinutes}`);
    check('起床差为 −20 分钟', tl.wakeDeltaMinutes === -20, `实际 ${tl.wakeDeltaMinutes}`);

    // 核心几何关系：实际就寝早于目标 → 实心条左端必须在目标刻度左边
    check('实际就寝早于目标时，实心条左端在目标刻度左侧',
      tl.actualStartPct < tl.targetBedPct,
      `实际 ${tl.actualStartPct.toFixed(2)}% vs 目标刻度 ${tl.targetBedPct.toFixed(2)}%`);
    check('实际起床早于目标时，实心条右端在目标刻度左侧',
      tl.actualEndPct < tl.targetWakePct,
      `实际 ${tl.actualEndPct.toFixed(2)}% vs 目标刻度 ${tl.targetWakePct.toFixed(2)}%`);
    check('实心条跨度为正', tl.actualEndPct > tl.actualStartPct,
      `${tl.actualStartPct.toFixed(2)}% → ${tl.actualEndPct.toFixed(2)}%`);
    check('所有位置都落在轨道内',
      [tl.actualStartPct, tl.actualEndPct, tl.targetBedPct, tl.targetWakePct].every((v) => v >= 0 && v <= 100),
      `${[tl.actualStartPct, tl.actualEndPct, tl.targetBedPct, tl.targetWakePct].map((v) => v.toFixed(1)).join(', ')}`);
    check('轨道两端标注是合法钟点',
      /^\d{2}:\d{2}$/.test(tl.startLabel) && /^\d{2}:\d{2}$/.test(tl.endLabel),
      `${tl.startLabel} / ${tl.endLabel}`);

    // 前后各留了 40 分钟空白，所以实心条不应贴边
    check('实心条两端都不贴轨道边缘',
      tl.actualStartPct > 0 && tl.actualEndPct < 100,
      `${tl.actualStartPct.toFixed(1)}% → ${tl.actualEndPct.toFixed(1)}%`);
  }

  // 反向：比目标晚睡晚起，实心条必须整体右移
  const late = buildTargetTimeline('23:55', '08:05', '23:30', '07:30');
  check('比目标晚睡晚起时实心条整体右移',
    late !== null && late.actualStartPct > late.targetBedPct && late.actualEndPct > late.targetWakePct,
    `就寝 ${late?.actualStartPct.toFixed(1)}% vs ${late?.targetBedPct.toFixed(1)}%`);

  // 跨午夜：就寝 00:20、起床 08:00，仍应算出正跨度
  const across = buildTargetTimeline('00:20', '08:00', '23:30', '07:30');
  check('跨午夜的就寝时间也能算出正常跨度',
    across !== null && across.actualEndPct > across.actualStartPct && Number.isFinite(across.bedDeltaMinutes),
    `${across?.actualStartPct.toFixed(1)}% → ${across?.actualEndPct.toFixed(1)}%`);

  // 非法输入返回 null，界面据此不渲染，而不是画一条错的
  check('非法时间返回 null', buildTargetTimeline('', '07:10', '23:30', '07:30') === null, '空字符串应返回 null');

  // 差值文案
  check('早 15 分钟的说法正确', describeDelta(-15) === '早 15分钟', describeDelta(-15));
  check('晚 20 分钟的说法正确', describeDelta(20) === '晚 20分钟', describeDelta(20));
  check('差值在容差内说「基本准时」', describeDelta(6) === '基本准时' && describeDelta(-9) === '基本准时',
    `${describeDelta(6)} / ${describeDelta(-9)}`);
}

console.log('\n══ 自指对照：和自己的基线比，而不是和临床阈值比 ══');
{
  const mk = (dur: number, day = 1): any => ({
    id: 'r' + day, date: `2026-09-${String(day).padStart(2, '0')}`, bedtime: '23:00', wakeTime: '07:00',
    durationMinutes: dur, deepSleepMinutes: 90, lightSleepMinutes: 260, remSleepMinutes: 100,
    awakeMinutes: 20, sleepScore: 80, sleepEfficiency: 95, latencyMinutes: 15, wakeCount: 1,
    wakingMood: 'neutral', preSleepHabits: [],
  });

  // 睡眠领域唯一一项 MRT 实测（Takeuchi 2024, JMIR, DOI 10.2196/49669）有效的形式
  // 是「与用户自己的基线对比的变化量」，不是绝对分数。这个函数就是那个形式。
  const up = describeVsSelf([mk(480), ...Array.from({ length: 6 }, (_, i) => mk(420, i + 2))]);
  check('比基线长时报「多睡」', up?.text.includes('多睡') === true, up?.text);
  check('差值用「38分」口径（与首页一句话总结一致，不是「38分钟」）',
    /\d+分$/.test(up?.text ?? ''), up?.text);
  check('文案里出现「你自己」，明确是自指对照', up?.text.includes('你自己') === true, up?.text);
  // 最关键的一条：绝不能退化成"和临床阈值比"
  check('文案不含任何绝对时长阈值（如 8小时）',
    !/\d+小时/.test(up?.text ?? ''), `出现了绝对时长：${up?.text}`);

  const down = describeVsSelf([mk(360), ...Array.from({ length: 6 }, (_, i) => mk(430, i + 2))]);
  check('比基线短时报「少睡」', down?.text.includes('少睡') === true, down?.text);

  const flat = describeVsSelf([mk(425), ...Array.from({ length: 6 }, (_, i) => mk(430, i + 2))]);
  check('10 分钟以内差异说「差不多」，不把噪声报成变化',
    flat?.text.includes('差不多') === true, flat?.text);

  // 取样纪律：与发现引擎「需要 ≥2 晚有、≥2 晚无」同一标准
  check('基线只有 2 晚时不给结论', describeVsSelf([mk(480), mk(420, 2), mk(420, 3)]) === null);
  check('只有 1 晚时不给结论', describeVsSelf([mk(480)]) === null);
  check('空数组不崩', describeVsSelf([]) === null);
  check('基线全是 0 分钟时不给结论（不能拿 0 当基线）',
    describeVsSelf([mk(480), ...Array.from({ length: 6 }, (_, i) => mk(0, i + 2))]) === null);

  // 真实数据通路：演示数据必须能产出，否则这个功能在 App 里根本不显示
  const onDemo = describeVsSelf(getInitialSleepLogs());
  check('演示数据（7 晚）能产出自指对照', onDemo !== null, '真实数据通路上没产出');
  check('对照引用了真实的晚数', onDemo?.text.includes('最近 6 晚') === true, onDemo?.text);
}

console.log('\n══ 主观感受与分数的矛盾：以你的感受为准 ══');
{
  const mk = (score: number, mood: string): any => ({
    id: 'x', date: '2026-09-22', bedtime: '23:00', wakeTime: '07:00', durationMinutes: 456,
    deepSleepMinutes: 95, lightSleepMinutes: 265, remSleepMinutes: 96, awakeMinutes: 19,
    sleepScore: score, sleepEfficiency: 96, latencyMinutes: 15, wakeCount: 1,
    wakingMood: mood, preSleepHabits: [],
  });

  // wakingMood 此前被三处录入、被 sanitize 保留、被演示数据填充，却**没有任何一处读取**。
  // 这里首先钉住"它真的被用起来了"。
  const high = describeMoodVsScore(mk(99, 'groggy'));
  const low = describeMoodVsScore(mk(60, 'refreshed'));
  check('高分 + 记录疲惫 → 出面对照', high !== null, String(high));
  check('低分 + 记录精力充沛 → 出面对照', low !== null, String(low));

  // 最核心的一条：不能否定用户的感受，必须以它为准
  check('矛盾时明确「以你的感受为准」（不否定用户）',
    high?.includes('以你的感受为准') === true && low?.includes('以你的感受为准') === true,
    `${high} / ${low}`);
  check('矛盾时引用的是用户自己的原话（含感受标签）',
    high?.includes('昏沉困倦') === true && low?.includes('精力充沛') === true,
    `${high} / ${low}`);

  // 反向：不能出现把用户感受说成错的措辞
  const NEGATING = /其实|误记|记错|并不|错觉|不用担心|别在意/;
  check('文案不把用户的感受说成错的',
    !NEGATING.test(high ?? '') && !NEGATING.test(low ?? ''),
    '出现了否定用户感受的措辞');

  // 一致时**必须不说话**（JITAI 要求显式设计「不提供任何东西」）
  check('一致时不出面对照（高分+精力充沛）', describeMoodVsScore(mk(99, 'refreshed')) === null);
  check('一致时不出面对照（低分+昏沉）', describeMoodVsScore(mk(60, 'groggy')) === null);
  check('一致时不出面对照（中档+略微疲劳）', describeMoodVsScore(mk(74, 'tired')) === null);

  // neutral 是 App 里"没问/没说"的默认值（buildSleepRecord 的 ?? 'neutral'），
  // 一键记录也会落成它。把它当成"感觉不错"会凭空造出矛盾。
  check('neutral 不被当成「感觉好」', describeMoodVsScore(mk(60, 'neutral')) === null,
    '把"没说"当成了"感觉好"');
  check('neutral 也不被当成「感觉坏」', describeMoodVsScore(mk(99, 'neutral')) === null,
    '把"没说"当成了"感觉坏"');

  check('空记录不崩', describeMoodVsScore(null) === null && describeMoodVsScore(undefined) === null);
  check('分数非有限值时不说话', describeMoodVsScore(mk(NaN, 'groggy')) === null);

  // 演示数据必须一条都不触发——否则首页一打开就在制造噪声
  const demoMoods = getInitialSleepLogs().map((r) => describeMoodVsScore(r));
  check('演示数据不产生任何假矛盾',
    demoMoods.every((m) => m === null),
    `有 ${demoMoods.filter((m) => m !== null).length} 条不该出现的对照`);

  // scoreBand 是档位的唯一定义（原先写死在 TodayTab 的 getScoreColor 里）
  check('档位边界正确（88/78/68）',
    scoreBand(99) === '优' && scoreBand(88) === '优' && scoreBand(87) === '良'
    && scoreBand(78) === '良' && scoreBand(77) === '平' && scoreBand(68) === '平'
    && scoreBand(67) === '差',
    `${scoreBand(88)}/${scoreBand(87)}/${scoreBand(78)}/${scoreBand(77)}/${scoreBand(68)}/${scoreBand(67)}`);
}

// ---------------------------------------------------------------- 汇总
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 可解释结论全部通过（${pass} 项断言）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
