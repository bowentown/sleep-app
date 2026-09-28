import { SleepStage, SleepStageSegment } from '../types/sleep';

/** 一天 24 小时 = 1440 分钟 */
const MINUTES_PER_DAY = 24 * 60;

/** 未采集到入睡潜伏期时的默认假设值（**非实测**，UI 需如实标注为估算） */
export const DEFAULT_LATENCY_MINUTES = 12;

/** 未设置目标时长时的默认值（8 小时） */
export const DEFAULT_TARGET_DURATION_MINUTES = 480;

/** 解析 "HH:MM" → 当日分钟数；非法输入回退 0。 */
export function parseClock(clock: string): number {
  const [h, m] = String(clock ?? '').split(':').map(Number);
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}

/** 从 bedtime 起偏移 minutes 得到 "HH:MM"（跨午夜安全）。 */
export function clockAfter(bedtime: string, minutes: number): string {
  const total = parseClock(bedtime) + minutes;
  const norm = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

/**
 * bedtime → wakeTime 的卧床时长（分钟），跨午夜安全。
 * 这是"卧床时间 (TIB, time in bed)"，含入睡潜伏期与夜间清醒。
 */
export function timeInBedMinutes(bedtime: string, wakeTime: string): number {
  const bed = parseClock(bedtime);
  let wake = parseClock(wakeTime);
  if (wake <= bed) wake += MINUTES_PER_DAY;
  return wake - bed;
}

/**
 * 睡眠得分（0-100）与睡眠效率。
 *
 * 语义契约（调用方必须与此一致，否则效率会失真）：
 *   durationMinutes = 总睡眠时间 TST，**不含**清醒
 *   awakeMinutes    = 卧床期间的清醒总量 = 入睡潜伏期(SOL) + 夜间清醒(WASO)
 *   latencyMinutes  = 入睡潜伏期 SOL，**仅用于"入睡困难"扣分，不再重复计入卧床**
 *   卧床 TIB        = durationMinutes + awakeMinutes
 *   睡眠效率 SE     = TST / TIB
 *
 * 例：卧床 480 分钟只睡着 120 分钟 → 效率如实返回 25%，不托底。
 */
export function calculateSleepScore(
  durationMinutes: number,
  deepSleepMinutes: number,
  remSleepMinutes: number,
  awakeMinutes: number,
  wakeCount: number,
  latencyMinutes: number,
  targetDurationMinutes: number = DEFAULT_TARGET_DURATION_MINUTES
): { score: number; efficiency: number } {
  const tst = Math.max(0, durationMinutes);
  const awake = Math.max(0, awakeMinutes);
  const latency = Math.max(0, latencyMinutes);

  // awake 已包含入睡潜伏期，不能再 + latencyMinutes
  // （否则潜伏期被算两遍，效率被系统性压低：卧床 8h 真实 96% 会显示成 93%）
  const totalBedMinutes = tst + awake;
  const efficiency = totalBedMinutes > 0 ? Math.round((tst / totalBedMinutes) * 100) : 0;

  // 1. 时长得分（满分 40）—— 相对用户自设目标；过长与过短对称扣分
  //    （睡眠科学与流行病学研究均支持时长过短与过长关联更差结局）
  const durationHours = tst / 60;
  const absDiffHours = Math.abs(durationHours - targetDurationMinutes / 60);
  let durationScore: number;
  if (absDiffHours <= 0.5) {
    durationScore = 40;
  } else if (absDiffHours <= 1) {
    durationScore = 35;
  } else if (absDiffHours <= 1.5) {
    durationScore = 28;
  } else if (absDiffHours <= 2.5) {
    durationScore = 18;
  } else {
    durationScore = 10;
  }

  // 2. 深睡比例得分（满分 20）
  const deepRatio = tst > 0 ? deepSleepMinutes / tst : 0;
  let deepScore: number;
  if (deepRatio >= 0.16 && deepRatio <= 0.25) {
    deepScore = 20;
  } else if (deepRatio >= 0.12) {
    deepScore = 16;
  } else if (deepRatio >= 0.08) {
    deepScore = 12;
  } else {
    deepScore = 8;
  }

  // 3. REM 比例得分（满分 20）
  const remRatio = tst > 0 ? remSleepMinutes / tst : 0;
  let remScore: number;
  if (remRatio >= 0.2 && remRatio <= 0.26) {
    remScore = 20;
  } else if (remRatio >= 0.15) {
    remScore = 16;
  } else if (remRatio >= 0.1) {
    remScore = 11;
  } else {
    remScore = 7;
  }

  // 4. 连续性与效率（满分 20）
  let restScore = 20;
  if (wakeCount > 3) restScore -= (wakeCount - 3) * 2;
  if (latency > 30) restScore -= Math.min(6, Math.floor((latency - 30) / 10) * 2);
  if (efficiency < 85) restScore -= Math.min(6, Math.floor((85 - efficiency) / 3));
  // CBT-I 对齐：效率极低（卧床时间远超实际睡眠）要显著扣分，
  // 不能让"躺在床上更久"反而拿到更高分（与睡眠限制疗法方向一致）
  if (efficiency < 60) restScore -= Math.min(12, Math.round((60 - efficiency) / 5));
  restScore = Math.max(0, restScore);

  // 低分不托底：短睡/零深睡就该拿低分（托底会让差记录虚高 15-20 分）
  const finalScore = Math.min(99, Math.max(5, durationScore + deepScore + remScore + restScore));

  return {
    score: finalScore,
    // 如实报告效率（托底会把真实 25% 显示成 50%）
    efficiency: Math.max(0, Math.min(100, efficiency)),
  };
}

export interface GeneratedStages {
  stages: SleepStageSegment[];
  deepMinutes: number;
  lightMinutes: number;
  remMinutes: number;
  awakeMinutes: number;
  /** 实际采用的入睡潜伏期（已按卧床时长钳制） */
  latencyMinutes: number;
  /** 实际放入分期的夜醒段数（= 清醒段数 − 1） */
  wakeCount: number;
  /** 卧床时长 */
  timeInBedMinutes: number;
}

/**
 * 按超昼夜节律推演睡眠分期（Deep → Light → REM → Awake，周期约 90-110 分钟）。
 *
 * ⚠️ 这是**模型推演，不是实测**：输入只有作息起止点、入睡潜伏期与夜醒次数，
 * 不读取任何传感器（无加速度计、无麦克风、无 EEG）。调用方必须在 UI 上
 * 如实标注为估算值，不得表述为"监测/检测/脑波"。
 *
 * 硬性约束（由 tools/verify-invariants.mts 断言）：
 *   1. 所有分期时长之和 === 卧床时长
 *   2. deep/light/rem/awake 四个分量 === 对应分期之和
 *   3. 首段固定为入睡潜伏期（awake）；夜醒段数 === wakeCount
 */
export function generateSleepStages(
  bedtimeStr: string,
  wakeTimeStr: string,
  latencyMinutes: number = DEFAULT_LATENCY_MINUTES,
  wakeCount: number = 1
): GeneratedStages {
  const tib = Math.max(1, timeInBedMinutes(bedtimeStr, wakeTimeStr));

  // 入睡潜伏期不能吃掉整段卧床
  const latency = Math.max(1, Math.min(Math.round(latencyMinutes) || 1, Math.max(1, tib - 1)));

  // 夜醒段：默认 5 分钟一段；卧床不够时先缩短段长、再减少段数，保证至少 1 分钟睡眠
  let arousals = Math.max(0, Math.min(Math.round(wakeCount) || 0, 6));
  let arousalLen = 5;
  while (arousals > 0 && tib - latency - arousals * arousalLen < 1) {
    if (arousalLen > 1) arousalLen--;
    else arousals--;
  }
  const sleepPortion = tib - latency - arousals * arousalLen; // >= 1

  // 把睡眠主体拆成若干 ~90 分钟的周期
  const cycles = Math.max(1, Math.round(sleepPortion / 92));
  const perCycle = Math.floor(sleepPortion / cycles);

  const groups: Array<Array<{ stage: SleepStage; minutes: number }>> = [];
  for (let i = 0; i < cycles; i++) {
    const len = i === cycles - 1 ? sleepPortion - perCycle * (cycles - 1) : perCycle;
    if (len <= 0) continue;
    // 前两个周期深睡多，之后 REM 比例上升
    const deepRatio = i < 2 ? 0.34 : 0.12;
    const remRatio = i >= 2 ? 0.26 : 0.13;
    const deep = Math.round(len * deepRatio);
    let rem = Math.round(len * remRatio);
    if (deep + rem > len) rem = Math.max(0, len - deep); // 极短周期兜底
    const light = len - deep - rem;

    const seg: Array<{ stage: SleepStage; minutes: number }> = [];
    if (deep > 0) seg.push({ stage: 'deep', minutes: deep });
    if (light > 0) seg.push({ stage: 'light', minutes: light });
    if (rem > 0) seg.push({ stage: 'rem', minutes: rem });
    if (seg.length > 0) groups.push(seg);
  }

  // 夜醒均匀插在周期之间
  const gaps = Math.max(0, groups.length - 1);
  const perGap = new Array<number>(gaps).fill(0);
  if (gaps > 0) for (let a = 0; a < arousals; a++) perGap[a % gaps] += 1;

  const seq: Array<{ stage: SleepStage; minutes: number }> = [{ stage: 'awake', minutes: latency }];
  groups.forEach((g, i) => {
    seq.push(...g);
    for (let k = 0; k < (perGap[i] ?? 0); k++) seq.push({ stage: 'awake', minutes: arousalLen });
  });

  // 组装分期；时间戳由 bedtime + 累计偏移派生
  const stages: SleepStageSegment[] = [];
  const totals: Record<SleepStage, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  let offset = 0;
  for (const s of seq) {
    if (s.minutes <= 0) continue;
    stages.push({
      stage: s.stage,
      startTime: clockAfter(bedtimeStr, offset),
      endTime: clockAfter(bedtimeStr, offset + s.minutes),
      durationMinutes: s.minutes,
    });
    totals[s.stage] += s.minutes;
    offset += s.minutes;
  }

  // 兜底：把舍入差额并入最后一段，保证总和精确等于卧床时长
  if (offset !== tib && stages.length > 0) {
    const diff = tib - offset;
    const last = stages[stages.length - 1];
    if (last.durationMinutes + diff > 0) {
      last.durationMinutes += diff;
      last.endTime = clockAfter(bedtimeStr, tib);
      totals[last.stage] += diff;
    }
  }

  return {
    stages,
    deepMinutes: totals.deep,
    lightMinutes: totals.light,
    remMinutes: totals.rem,
    awakeMinutes: totals.awake,
    latencyMinutes: latency,
    wakeCount: Math.max(0, stages.filter((s) => s.stage === 'awake').length - 1),
    timeInBedMinutes: tib,
  };
}

export function formatDurationChinese(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}分钟`;
  return `${h}小时${m > 0 ? `${m}分` : ''}`;
}
