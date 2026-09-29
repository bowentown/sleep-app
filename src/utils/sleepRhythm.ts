/**
 * 作息节律指标：SRI（睡眠规律性指数）、睡眠中点、社交时差。
 *
 * 这些不是我自己造的指标，而是睡眠医学里已经在用的标准量：
 *
 * - **SRI（Sleep Regularity Index）**：Phillips et al. 2017, Scientific Reports
 *   （https://www.nature.com/articles/s41598-017-03171-4）。
 *   定义为「24 小时前后处于同一（睡/醒）状态的概率」映射到 -100..100。
 *   参考实现：https://github.com/mengelhard/sri
 *       sri = 200 * nanmean(a[t] == a[t + epochs_per_day]) - 100
 *   之所以值得引入：UK Biobank 对 72,269 人的研究显示 SRI 与主要心血管
 *   不良事件相关，且 SRI 比单纯的睡眠时长更能预测结局。它也是**无量纲**的，
 *   可以横向比较；而本项目原来的「就寝时间标准差 ±N 分钟」只能纵向看自己。
 *
 * - **睡眠中点（sleep midpoint）**：昼夜节律研究里的标准相位标记。
 *   比「就寝时间」更合适做规律性的基准，因为它同时包含入睡和起床两端——
 *   一个人可能每天 23:00 上床但起床时间差两小时，只盯就寝时间看不出来。
 *   时点这类**圆周量**不能用算术平均（23:50 和 00:10 的算术平均会算到 12:00），
 *   参考实现用的是 cos/sin 加权后的 arctan2：
 *       https://github.com/mengelhard/sri  calculate_midpoint()
 *
 * - **社交时差（social jetlag）**：Wittmann et al. 2006，
 *   定义为工作日与自由日睡眠中点的差值。即「周末补觉」的量化形式，
 *   与代谢和情绪问题相关。
 *
 * ⚠️ 口径说明（必须对用户诚实）：
 * 本模块的输入是**每晚的汇总区间**，不是逐分钟的体动记录仪（actigraphy）数据。
 * 真正的 SRI 需要整天的睡/醒二值序列；这里用「卧床区间」重建该序列，
 * 也就是：
 *   - 卧床区间内记作「睡」，区间外记作「醒」；
 *   - 夜间清醒分钟（awakeMinutes）无法定位到具体时刻，忽略不计，
 *     因此卧床区间略长于实际睡眠区间；
 *   - 没有记录的日子记作**缺失**，不记作「整夜清醒」。
 * 最后一条是关键：缺失日若当成清醒，会凭空把 SRI 拉低。
 *
 * 所以界面上的措辞必须是「按卧床区间估算」，不能宣称等同于体动记录仪的 SRI。
 */
import type { SleepRecord } from '../types/sleep.js';
import { minutesSinceNoon } from './sleepInsights.js';

export const MINUTES_PER_DAY = 1440;

/** 序列取值：1 = 睡，0 = 醒，-1 = 当天无记录（缺失，不参与比较） */
export const NO_RECORD = -1;

/**
 * 把 'YYYY-MM-DD' 换算成「1970-01-01 以来的天数」。
 *
 * 刻意只用字符串里的年月日做整数运算，不走 Date 对象——
 * `new Date('2026-09-22')` 会被解析成 UTC 午夜，在东八区取本地日期会退到 09-21，
 * 于是相邻两晚会映射到同一天，SRI 直接算错。本项目在别处已经修过一次
 * 同类 UTC 偏移问题，这里不再引入。
 */
export function dayNumberFromISODate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // 以 1970-01-01 为原点做「跨月天数」累加，闰年按标准规则判断
  const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > monthLengths[mo - 1]) return null;

  let days = 0;
  // 整年部分
  const yearsElapsed = y - 1970;
  days += yearsElapsed * 365;
  // 1970..(y-1) 之间的闰日数：能被 4 整除的年数减去能被 100 整除的、加回能被 400 整除的
  const leapBefore = (year: number) => {
    const n = year - 1;
    return Math.floor(n / 4) - Math.floor(n / 100) + Math.floor(n / 400);
  };
  days += leapBefore(y) - leapBefore(1970);
  // 当年已过整月
  for (let i = 0; i < mo - 1; i++) days += monthLengths[i];
  days += d - 1;
  return days;
}

/**
 * 由天数推出星期。0 = 周日 … 6 = 周六。
 * 1970-01-01 是星期四，所以偏移 4。
 */
export function weekdayFromDayNumber(dayNumber: number): number {
  return ((dayNumber + 4) % 7 + 7) % 7;
}

/** 把任意分钟数归一到 [0, 1440) */
export function normalizeMinutes(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * 圆周量的「最短弧」有符号差，结果落在 (-720, 720]。
 * 用来算两个时点差多少分钟（跨午夜时不会得到 ±1400 这种荒唐值）。
 */
export function circularSignedDelta(a: number, b: number): number {
  return normalizeMinutes(a - b + MINUTES_PER_DAY / 2) - MINUTES_PER_DAY / 2;
}

/**
 * 圆周均值 + 集中度（resultant length）。
 *
 * 时点不能直接算算术平均：23:50 与 00:10 的算术平均是 12:00，差了 12 小时。
 * 正确做法是把每个时点看成单位圆上的方向，先各自取 cos/sin 求平均，
 * 再 arctan2 回到时点。
 *
 * 返回的 `resultantLength` R = √(meanSin² + meanCos²) ∈ [0, 1] 是**集中度**：
 * R 接近 1 说明所有时点挤在一起（很规律），接近 0 说明散得很开。
 * 它是圆周统计里标准差的对等物，而且很重要——R 很低时「均值」本身没有意义
 * （比如一半人 00:00 睡、一半人 12:00 睡，均值会落在谁也不在的 06:00）。
 * 所以调用方必须在 R 偏低时避免把均值当成事实陈述。
 */
export function circularMeanMinutes(values: number[]): { mean: number; resultantLength: number } | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;

  let sumSin = 0;
  let sumCos = 0;
  for (const v of finite) {
    const angle = (normalizeMinutes(v) / MINUTES_PER_DAY) * 2 * Math.PI;
    sumSin += Math.sin(angle);
    sumCos += Math.cos(angle);
  }
  const meanSin = sumSin / finite.length;
  const meanCos = sumCos / finite.length;

  // atan2 返回 (-π, π]，换算回 [0, 1440)
  const angle = Math.atan2(meanSin, meanCos);
  const mean = normalizeMinutes((angle / (2 * Math.PI)) * MINUTES_PER_DAY);
  const resultantLength = Math.sqrt(meanSin * meanSin + meanCos * meanCos);
  return { mean, resultantLength };
}

/**
 * 一晚的卧床区间，落在「以正午为原点的一天」里的分钟区间。
 *
 * 本项目内部一律用 minutesSinceNoon（正午 = 0），因为睡眠时段天然跨午夜，
 * 以正午为原点后，23:15 入睡 → 07:10 起床 就是 675 → 1150 这样一段**不跨原点**
 * 的连续区间，处理起来最省事。
 *
 * 只有「白天睡」的人会跨原点（例如 11:00 睡到 19:00，即 1380 → 420），
 * 这时拆成 [1380,1440) ∪ [0,420) 两段，仍在同一个「正午日」坐标系内。
 *
 * 凌晨入睡且当天深夜起床这类超过 24 小时的极端区间会被截断到 1440 分钟，
 * 属于输入本身不合理，不在这里纠正。
 */
export function sleepIntervals(record: SleepRecord): Array<[number, number]> {
  const bed = normalizeMinutes(minutesSinceNoon(record.bedtime));
  const wake = normalizeMinutes(minutesSinceNoon(record.wakeTime));
  if (wake > bed) return [[bed, wake]];
  // 跨正午原点：从 bed 到当天结束，再从 0 到 wake
  return [
    [bed, MINUTES_PER_DAY],
    [0, wake],
  ];
}

/** 一晚的睡眠中点（在正午坐标系里，可能落在 [0,1440) 之外，由调用方归一） */
export function nightMidpoint(record: SleepRecord): number | null {
  const bed = normalizeMinutes(minutesSinceNoon(record.bedtime));
  const wake = normalizeMinutes(minutesSinceNoon(record.wakeTime));
  // 卧床时长：跨原点时加上 1440
  const inBed = wake > bed ? wake - bed : wake + MINUTES_PER_DAY - bed;
  if (!Number.isFinite(inBed) || inBed <= 0) return null;
  return normalizeMinutes(bed + inBed / 2);
}

export interface RhythmSeries {
  /** 序列第一天的天数编号 */
  startDay: number;
  /** 连续天数（含中间没有记录的空日） */
  dayCount: number;
  /** 长度 = dayCount * 1440 的睡眠/清醒/缺失序列 */
  values: Int8Array;
  /** 每天是否有记录 */
  hasRecord: boolean[];
}

/**
 * 把每晚记录重建为「逐分钟、按天排列」的睡/醒序列。
 *
 * 关键点：**补全成连续日**。SRI 比较的是相邻两天的同一时刻，
 * 所以必须先在日历上铺满，中间没有记录的日子填 NO_RECORD 而不是 0（清醒）。
 * 把没记录的日子当成清醒，会凭空制造出「那天整夜没睡」的假数据，
 * 把 SRI 拽低——这是这个指标最容易写错的地方。
 */
export function buildRhythmSeries(records: SleepRecord[]): RhythmSeries | null {
  const byDay = new Map<number, SleepRecord>();
  for (const r of records) {
    const d = dayNumberFromISODate(r.date);
    if (d === null) continue;
    // 同一天有多条记录时，后出现的覆盖先出现的（调用方按时间升序传入，即取最新）
    byDay.set(d, r);
  }
  if (byDay.size === 0) return null;

  const dayNumbers = [...byDay.keys()];
  const startDay = Math.min(...dayNumbers);
  const endDay = Math.max(...dayNumbers);
  const dayCount = endDay - startDay + 1;

  const values = new Int8Array(dayCount * MINUTES_PER_DAY).fill(NO_RECORD);
  const hasRecord: boolean[] = new Array(dayCount).fill(false);

  for (const [day, record] of byDay) {
    const idx = day - startDay;
    hasRecord[idx] = true;
    const base = idx * MINUTES_PER_DAY;
    // 先把这一整天填成「醒」，再挖出卧床区间填「睡」。
    // 顺序不能反：若只写睡眠区间、其余留作 NO_RECORD，那么「醒」这个状态
    // 就根本不存在，所有清醒时刻都会被当成缺失排除，SRI 只统计睡眠时段，
    // 任何人都会拿到接近 100 的假高分。
    values.fill(0, base, base + MINUTES_PER_DAY);
    for (const [from, to] of sleepIntervals(record)) {
      const lo = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(from)));
      const hi = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(to)));
      for (let m = lo; m < hi; m++) values[base + m] = 1;
    }
  }

  return { startDay, dayCount, values, hasRecord };
}

export interface SleepRegularityIndex {
  /** -100 … 100 */
  sri: number;
  /** 参与比较的相邻日对数 */
  comparedDayPairs: number;
  /** 实际参与比较的分钟数（两侧都有记录的那些时刻） */
  validEpochs: number;
  /** 两侧状态相同的分钟数 */
  matchedEpochs: number;
  /** 序列覆盖的天数（含空日） */
  spanDays: number;
}

/**
 * SRI（睡眠规律性指数）。
 *
 * 严格按参考实现：
 *     sri = 200 * nanmean(a[t] === a[t + 1440]) - 100
 * 其中 a 是逐分钟的睡/醒序列，nanmean 表示**只统计两侧都有值的时刻**。
 * 全部一致 → 100；完全相反（睡醒颠倒）→ -100；各占一半 → 0。
 *
 * 需要至少两晚**相邻**的记录才有一个可比较的日对；中间断档的日子会让
 * 它两侧的日对整体失效（这正是 nanmean 的语义，也是诚实的做法：
 * 隔着四天没记录，没法断言那四天前后是否规律）。
 */
export function computeSleepRegularityIndex(records: SleepRecord[]): SleepRegularityIndex | null {
  const series = buildRhythmSeries(records);
  if (!series || series.dayCount < 2) return null;

  const { values, dayCount } = series;
  let valid = 0;
  let matched = 0;
  let comparedDayPairs = 0;

  for (let d = 0; d < dayCount - 1; d++) {
    const cur = d * MINUTES_PER_DAY;
    const next = (d + 1) * MINUTES_PER_DAY;
    let pairValid = 0;
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const a = values[cur + m];
      const b = values[next + m];
      if (a === NO_RECORD || b === NO_RECORD) continue; // 缺失不参与
      pairValid++;
      if (a === b) matched++;
    }
    valid += pairValid;
    if (pairValid > 0) comparedDayPairs++;
  }

  if (valid === 0) return null;

  return {
    sri: 200 * (matched / valid) - 100,
    comparedDayPairs,
    validEpochs: valid,
    matchedEpochs: matched,
    spanDays: dayCount,
  };
}

export interface SleepMidpointResult {
  /** 平均睡眠中点，归一在 [0, 1440) 的正午坐标系里 */
  midpointMinutes: number;
  /** 集中度 0..1，越接近 1 越规律 */
  resultantLength: number;
  nights: number;
}

/**
 * 平均睡眠中点（圆周均值）+ 集中度。
 *
 * 每晚报一个中点再取圆周均值（每晚等权）。参考实现的做法是把所有「睡眠时刻」
 * 汇在一起做加权圆周均值，等价于按卧床时长加权；对个人应用来说每晚等权更好解释，
 * 所以这里选了前者，并在结果里一并给出集中度，让调用方能判断均值是否可信。
 */
export function computeSleepMidpoint(records: SleepRecord[]): SleepMidpointResult | null {
  const midpoints: number[] = [];
  for (const r of records) {
    const mp = nightMidpoint(r);
    if (mp !== null && Number.isFinite(mp)) midpoints.push(mp);
  }
  const result = circularMeanMinutes(midpoints);
  if (!result) return null;
  return { midpointMinutes: result.mean, resultantLength: result.resultantLength, nights: midpoints.length };
}

export interface SocialJetlag {
  /** 自由日与工作日睡眠中点的绝对差值（分钟），沿最短弧计算 */
  jetlagMinutes: number;
  /** 有符号差值：正数表示自由日晚于工作日 */
  signedMinutes: number;
  workdayMidpointMinutes: number;
  freedayMidpointMinutes: number;
  workdayNights: number;
  freedayNights: number;
}

/**
 * 社交时差：自由日与工作日睡眠中点的差值。
 *
 * ⚠️ 归类用的是**起床日**，不是记录日。
 * 本项目的 `date` 是「就寝当晚」的日期（09-22 就寝 23:15 → 09-23 早上醒）。
 * MCTQ 的口径是：一夜属于「自由夜」当且仅当它的**起床日**不用上班。
 * 因此：
 *   周五晚（记录日 周五）→ 周六醒 → 自由夜 ✅
 *   周六晚（记录日 周六）→ 周日醒 → 自由夜 ✅
 *   周日晚（记录日 周日）→ 周一醒 → 工作夜 ❌（不是自由夜）
 * 如果图省事直接按记录日的星期归类，就会漏掉周五晚、误收周日晚，
 * 结果整体偏移——这正是这个指标最容易写错的地方，测试里专门盯住它。
 *
 * 另外只按星期几区分，不询问用户的实际上班日；对轮班人群不适用。
 */
export function computeSocialJetlag(records: SleepRecord[]): SocialJetlag | null {
  const workday: number[] = [];
  const freeday: number[] = [];

  for (const r of records) {
    const day = dayNumberFromISODate(r.date);
    if (day === null) continue;
    const mp = nightMidpoint(r);
    if (mp === null) continue;
    // 起床日 = 记录日 + 1（记录日是就寝当晚）
    const wakeWeekday = weekdayFromDayNumber(day + 1);
    const isFree = wakeWeekday === 0 || wakeWeekday === 6; // 周日 / 周六
    (isFree ? freeday : workday).push(mp);
  }

  const w = circularMeanMinutes(workday);
  const f = circularMeanMinutes(freeday);
  if (!w || !f) return null;

  const signed = circularSignedDelta(f.mean, w.mean);
  return {
    jetlagMinutes: Math.abs(signed),
    signedMinutes: signed,
    workdayMidpointMinutes: w.mean,
    freedayMidpointMinutes: f.mean,
    workdayNights: workday.length,
    freedayNights: freeday.length,
  };
}
