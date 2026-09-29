import { SleepRecord } from '../types/sleep';
import { formatDurationChinese } from './sleepScore';

/**
 * 首页与趋势页的「可解释结论」计算。
 *
 * 这些函数全部是纯函数（不读时钟、不碰 DOM），因为它们的输出会被写进断言：
 * 文案错了不会被任何类型检查或构建拦住，只能靠断言。
 * 需要当前时间的地方一律从参数传入 `now`。
 */

/**
 * 把 "HH:mm" 转成「距正午的分钟数」。
 *
 * 就寝时间跨越午夜（23:30 与 00:20 只差 50 分钟，不是 23 小时 10 分），
 * 直接对小时取绝对分钟数会把两者算成相隔一整天，均值与标准差全错。
 * 以正午为原点后，白天→傍晚→午夜→清晨在数值上单调递增：
 *   12:00 → 0      23:00 → 660
 *   00:30 → 750    07:30 → 1170
 * 只要作息落在「傍晚到第二天上午」这个正常区间，线性统计就是成立的。
 */
export function minutesSinceNoon(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return NaN;
  return ((h - 12 + 24) % 24) * 60 + min;
}

/** 距正午的分钟数还原成 "HH:mm" */
export function fromMinutesSinceNoon(mins: number): string {
  const wrapped = ((Math.round(mins) % 1440) + 1440) % 1440;
  // 必须把正午偏移加回去：690 距正午是 11:30，对应的钟点是 23:30。
  const h = (Math.floor(wrapped / 60) + 12) % 24;
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type BedtimeTone = 'daytime' | 'windDown' | 'overdue';

export interface BedtimeStatus {
  tone: BedtimeTone;
  /** 主文案：随当前时间变化 */
  headline: string;
  /** 次文案：与主文案同一档位给出的具体建议 */
  detail: string;
  /** 距目标就寝的分钟数，正数=还早，负数=已超 */
  minutesToTarget: number;
}

/** 窗口边界（分钟）。超过 2 小时就算「还早」——4 小时前提醒就寝没有意义。
 *  超过目标就寝 4 小时则视为「已经过了那一夜」，不再喊超时。 */
const WIND_DOWN_WINDOW = 120;
const MAX_OVERDUE = 240;

/**
 * 按当前时间给首页就寝卡一个状态。
 *
 * 原先这张卡是静态的「今晚准备入睡」，22:40 和凌晨 1 点看到的完全一样。
 * 同一个位置改成随时间变化：临近目标就寝时倒计时，超过目标就寝时提醒。
 */
export function getBedtimeStatus(now: Date, targetBedtime: string): BedtimeStatus {
  const target = minutesSinceNoon(targetBedtime);
  const current = ((now.getHours() - 12 + 24) % 24) * 60 + now.getMinutes();

  if (!Number.isFinite(target)) {
    return { tone: 'daytime', headline: '今晚准备入睡', detail: '记录真实作息起止点', minutesToTarget: 0 };
  }

  const diff = target - current;

  // 还早：不在睡前窗口内
  if (diff > WIND_DOWN_WINDOW) {
    return {
      tone: 'daytime',
      headline: `今晚目标 ${targetBedtime} 就寝`,
      detail: '记录真实作息起止点',
      minutesToTarget: diff,
    };
  }

  // 正好到点。原来 diff === 0 会掉进下面的 overdue 分支，
  // 渲染成「已超过目标就寝 0分钟」——明明一分钟都没超过。
  if (diff === 0) {
    return {
      tone: 'windDown',
      headline: '到目标就寝时间了',
      detail: '现在就放下手机',
      minutesToTarget: 0,
    };
  }

  // 睡前窗口内：倒计时
  if (diff > 0) {
    return {
      tone: 'windDown',
      headline: `距目标就寝 ${formatDurationChinese(diff)}`,
      detail: diff > 60 ? '可以开始调暗灯光、放下手机' : '该收尾了，尽量别再刷屏幕',
      minutesToTarget: diff,
    };
  }

  // 超过目标就寝，但还没过那一夜
  if (diff >= -MAX_OVERDUE) {
    return {
      tone: 'overdue',
      headline: `已超过目标就寝 ${formatDurationChinese(-diff)}`,
      detail: '现在直接去睡，比「再等一会儿」更容易入睡',
      minutesToTarget: diff,
    };
  }

  // 已经过了那一夜（例如下午打开）
  return {
    tone: 'daytime',
    headline: `今晚目标 ${targetBedtime} 就寝`,
    detail: '记录昨夜作息，或提前规划今晚',
    minutesToTarget: diff,
  };
}

export interface SleepDebt {
  /** 累计缺口（只算不够的天），分钟 */
  shortfallMinutes: number;
  /** 累计盈余（只算超出的天），分钟 */
  surplusMinutes: number;
  /** 净值 = 缺口 − 盈余；>0 是负债，<0 是盈余 */
  netMinutes: number;
  /** 参与统计的天数 */
  days: number;
}

/**
 * 睡眠负债：把目标时长与每晚实际总睡眠的差额逐日累加。
 *
 * 为什么缺口和盈余要分开统计：如果直接用净值，一晚睡 10 小时会把前面
 * 三晚各欠 1 小时全部抹平，显示成「没有负债」，而实际上作息是乱的。
 * 缺口的定义是不对称的——少睡一晚要两晚才能补回，多睡一晚并不能抵扣。
 * 所以主指标用 shortfall，净值只作为参考。
 */
export function computeSleepDebt(records: SleepRecord[], targetDurationMinutes: number): SleepDebt {
  let shortfall = 0;
  let surplus = 0;
  for (const r of records) {
    const delta = targetDurationMinutes - r.durationMinutes;
    if (delta > 0) shortfall += delta;
    else surplus += -delta;
  }
  return {
    shortfallMinutes: shortfall,
    surplusMinutes: surplus,
    netMinutes: shortfall - surplus,
    days: records.length,
  };
}

export interface BedtimeRegularity {
  /** 就寝时间的样本标准差（分钟，n−1） */
  stdDevMinutes: number;
  /** 平均就寝时间 "HH:mm" */
  meanBedtime: string;
  /** 以下三个是「距正午的分钟数」，供界面画分布带用（不能直接用钟点，跨午夜会错） */
  meanMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  /** 最早与最晚就寝之间相差多少分钟 */
  spanMinutes: number;
}

/**
 * 就寝时间的规律性。
 *
 * 用样本标准差（除以 n−1）而不是总体标准差：这 7 晚是从这个人的长期作息里
 * 抽出来的样本，我们要估计的是他作息本身的波动幅度。
 *
 * 少于 2 条记录时返回 null——一晚算不出波动，返回 0 会被读成「非常规律」。
 */
export function computeBedtimeRegularity(records: SleepRecord[]): BedtimeRegularity | null {
  const mins = records.map((r) => minutesSinceNoon(r.bedtime)).filter((v) => Number.isFinite(v));
  if (mins.length < 2) return null;

  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  const variance = mins.reduce((a, b) => a + (b - mean) ** 2, 0) / (mins.length - 1);

  const min = Math.min(...mins);
  const max = Math.max(...mins);
  return {
    stdDevMinutes: Math.sqrt(variance),
    meanBedtime: fromMinutesSinceNoon(mean),
    meanMinutes: mean,
    minMinutes: min,
    maxMinutes: max,
    spanMinutes: max - min,
  };
}

/**
 * 起床后的一句话总结。
 *
 * 报告卡原本是一张数据表，人得自己把数字翻译成结论。这句话把已有的数字
 * 串成一个判断，但只陈述数据里确实存在的比较（早/晚于目标、本周最高/最低），
 * 不做任何医学推断。
 */
export function buildMorningSummary(
  record: SleepRecord,
  weekRecords: SleepRecord[],
  targetDurationMinutes: number,
  targetBedtime: string
): string {
  // 开场：按评分档位，与首页评分环的档位保持一致
  const opener =
    record.sleepScore >= 88
      ? '睡得不错'
      : record.sleepScore >= 78
        ? '整体还可以'
        : record.sleepScore >= 68
          ? '睡得一般'
          : '睡得偏少';

  // 这里**只写增量信息**。总睡眠、效率、深睡分钟数在正下方的数据表里已经有了，
  // 复述一遍会让这一行变长一倍，读者还要在两组相同的数字之间对照。
  // 一句话总结的价值在于「把数字翻译成判断」，以及说出表格里没有的东西：
  // 与目标的差值、本周极值。
  // 差值与极值都用最紧凑的写法，目标是让这一行在 390px 宽的手机上**不折行**。
  // 实测「睡得不错 · 比目标少睡 24分钟、晚睡 15分钟 · 本周最好的一晚」需要约 363px，
  // 而卡内可用宽约 326px，会断成两行。把「分钟」压成「分」（两处共省约 28px）、
  // 「本周最好的一晚」压成「本周最佳」（省约 42px）之后才放得下。
  const parts: string[] = [];

  // 总睡眠与目标的差。低于 15 分钟不提，避免把噪声当结论。
  const deltaDuration = record.durationMinutes - targetDurationMinutes;
  if (Math.abs(deltaDuration) >= 15) {
    parts.push(
      deltaDuration > 0
        ? `多睡 ${Math.round(deltaDuration)}分`
        : `少睡 ${Math.round(-deltaDuration)}分`
    );
  }

  // 就寝时间与目标的差。两者都走「距正午的分钟数」，跨午夜才不会被算错。
  const actualBed = minutesSinceNoon(record.bedtime);
  const targetBed = minutesSinceNoon(targetBedtime);
  if (Number.isFinite(actualBed) && Number.isFinite(targetBed)) {
    const deltaBed = actualBed - targetBed;
    if (Math.abs(deltaBed) >= 15) {
      parts.push(
        deltaBed < 0
          ? `早睡 ${Math.round(-deltaBed)}分`
          : `晚睡 ${Math.round(deltaBed)}分`
      );
    }
  }

  // 「比目标」只写一次，两个差值用顿号并列：比目标少睡 24分钟、晚睡 15分钟。
  // 每个差值各带一次「比目标」会显得啰嗦，而去掉它又不知道在跟什么比。
  //
  // 「本周最佳/最差」不在这里拼——它讲的是**这一周**，属于日期那一行的信息，
  // 由 describeWeekExtreme 单独给出，在卡片头部渲染成小徽标。
  // 挤在这一行里实测要 315px，而可用宽只有 326px，余量 11px，换个字体就折行。
  return `${opener}${parts.length ? ' · 比目标' + parts.join('、') : ''}`;
}

/**
 * 这一晚在本周的位置：「本周最佳」/「本周最差」/ null。
 *
 * 只在本周记录 ≥3 天、且分数不是全部相同时才评价——
 * 只有两晚时「最佳」没有信息量，全部同分时每天都会自称「最佳」。
 */
export function describeWeekExtreme(
  record: SleepRecord,
  weekRecords: SleepRecord[]
): '本周最佳' | '本周最差' | null {
  if (weekRecords.length < 3) return null;
  const scores = weekRecords.map((r) => r.sleepScore);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  if (max === min) return null;
  if (record.sleepScore === max) return '本周最佳';
  if (record.sleepScore === min) return '本周最差';
  return null;
}

export interface TargetTimeline {
  /** 轨道左右端（距正午的分钟数），用于把各位置换算成百分比 */
  trackStartMin: number;
  trackEndMin: number;
  /** 以下四个是相对轨道的百分比位置 */
  actualStartPct: number;
  actualEndPct: number;
  targetBedPct: number;
  targetWakePct: number;
  /** 实际 − 目标（分钟）。负数 = 比目标早 */
  bedDeltaMinutes: number;
  wakeDeltaMinutes: number;
  /** 轨道两端的钟点标注 */
  startLabel: string;
  endLabel: string;
}

/**
 * 「昨夜 vs 目标」时间轴的几何。
 *
 * 原先泳道图下面是一条四色堆叠条，它表达的信息与上面的泳道图、下面的四个
 * 阶段方块完全重复。这里改成把「就寝 vs 目标 早于 15 分钟」这件已存在但
 * 只停留在文字上的信息画出来：一条时间轴，实际睡眠区间是实心条，目标是刻度。
 *
 * 任一时间非法时返回 null（界面据此不渲染时间轴，而不是画一条错的）。
 */
export function buildTargetTimeline(
  actualBedtime: string,
  actualWakeTime: string,
  targetBedtime: string,
  targetWakeTime: string,
  padMinutes = 40
): TargetTimeline | null {
  const bed = minutesSinceNoon(actualBedtime);
  const targetBed = minutesSinceNoon(targetBedtime);
  const targetWake = minutesSinceNoon(targetWakeTime);
  let wake = minutesSinceNoon(actualWakeTime);
  if (![bed, wake, targetBed, targetWake].every(Number.isFinite)) return null;

  // 起床必然在就寝之后。两者都以正午为原点，正常作息下 wake > bed 自动成立；
  // 若出现 wake <= bed，说明跨过了一整个白天，补一天再算。
  if (wake <= bed) wake += 1440;
  let targetWakeAdj = targetWake;
  if (targetWakeAdj <= targetBed) targetWakeAdj += 1440;

  const trackStart = Math.min(bed, targetBed) - padMinutes;
  const trackEnd = Math.max(wake, targetWakeAdj) + padMinutes;
  const span = trackEnd - trackStart;
  if (!(span > 0)) return null;

  const pct = (v: number) => ((v - trackStart) / span) * 100;

  return {
    trackStartMin: trackStart,
    trackEndMin: trackEnd,
    actualStartPct: pct(bed),
    actualEndPct: pct(wake),
    targetBedPct: pct(targetBed),
    targetWakePct: pct(targetWakeAdj),
    bedDeltaMinutes: bed - targetBed,
    wakeDeltaMinutes: wake - targetWakeAdj,
    startLabel: fromMinutesSinceNoon(trackStart),
    endLabel: fromMinutesSinceNoon(trackEnd),
  };
}

/** 把「实际 − 目标」的分钟差说成人话：早/晚 N 分钟，或「基本准时」 */
export function describeDelta(deltaMinutes: number, toleranceMinutes = 10): string {
  const rounded = Math.round(deltaMinutes);
  if (Math.abs(rounded) <= toleranceMinutes) return '基本准时';
  return rounded < 0 ? `早 ${formatDurationChinese(-rounded)}` : `晚 ${formatDurationChinese(rounded)}`;
}
