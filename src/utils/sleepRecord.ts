import { SleepRecord, WakingMood } from '../types/sleep';
import {
  calculateSleepScore,
  generateSleepStages,
  DEFAULT_LATENCY_MINUTES,
  DEFAULT_TARGET_DURATION_MINUTES,
} from './sleepScore';

/**
 * 睡眠记录的唯一构造函数。
 *
 * 所有入口（实时监测 / 手动补录 / 一键记录 / 演示数据 / 导入修复）都必须走这里，
 * 以保证字段语义与分期数据永远自洽：
 *
 *   卧床 TIB        = bedtime → wakeTime 的实际跨度
 *   总睡眠 TST      = deep + light + rem        → record.durationMinutes
 *   清醒 awake      = 入睡潜伏期 + 夜间清醒      → record.awakeMinutes
 *   睡眠效率        = TST / TIB
 *
 * 需要"卧床时长"作为输入时（例如实时监测已知精确卧床分钟数），请用
 * `clockAfter(bedtime, 实测卧床分钟数)` 派生 wakeTime，这样跨度与实测值精确一致。
 */
export interface BuildSleepRecordInput {
  id?: string;
  /** YYYY-MM-DD（本地时区，请用 toLocalDateString） */
  date: string;
  /** HH:mm */
  bedtime: string;
  /** HH:mm */
  wakeTime: string;
  /** 入睡潜伏期；未采集时用默认假设值，UI 需标注为估算 */
  latencyMinutes?: number;
  /** 夜醒次数（0-6），会真实反映到分期的觉醒段数上 */
  wakeCount?: number;
  wakingMood?: WakingMood;
  preSleepHabits?: string[];
  dreamNotes?: string;
  soundEvents?: SleepRecord['soundEvents'];
  targetDurationMinutes?: number;
}

export function buildSleepRecord(input: BuildSleepRecordInput): SleepRecord {
  const target = input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MINUTES;

  const gen = generateSleepStages(
    input.bedtime,
    input.wakeTime,
    input.latencyMinutes ?? DEFAULT_LATENCY_MINUTES,
    input.wakeCount ?? 1
  );

  // 总睡眠时间 = 深 + 浅 + REM（清醒不计入睡眠）
  const durationMinutes = gen.deepMinutes + gen.lightMinutes + gen.remMinutes;

  const { score, efficiency } = calculateSleepScore(
    durationMinutes,
    gen.deepMinutes,
    gen.remMinutes,
    gen.awakeMinutes,
    gen.wakeCount,
    gen.latencyMinutes,
    target
  );

  const notes = input.dreamNotes?.trim();

  return {
    id: input.id ?? `sleep-${Date.now()}`,
    date: input.date,
    bedtime: input.bedtime,
    wakeTime: input.wakeTime,
    durationMinutes,
    deepSleepMinutes: gen.deepMinutes,
    lightSleepMinutes: gen.lightMinutes,
    remSleepMinutes: gen.remMinutes,
    awakeMinutes: gen.awakeMinutes,
    sleepScore: score,
    sleepEfficiency: efficiency,
    latencyMinutes: gen.latencyMinutes,
    wakeCount: gen.wakeCount,
    wakingMood: input.wakingMood ?? 'neutral',
    preSleepHabits: input.preSleepHabits ?? [],
    dreamNotes: notes ? notes : undefined,
    stages: gen.stages,
    ...(input.soundEvents ? { soundEvents: input.soundEvents } : {}),
  };
}

/**
 * 7 天演示数据。
 *
 * 手写的只有作息时间、潜伏期与叙事字段；所有数值字段一律由 buildSleepRecord 派生，
 * 因此分期总和、深睡/浅睡/REM 分量、时长、效率、得分永远互相自洽。
 */
const DEMO_SPEC: Array<{
  id: string;
  date: string;
  bedtime: string;
  wakeTime: string;
  latencyMinutes: number;
  wakeCount: number;
  wakingMood: WakingMood;
  preSleepHabits: string[];
  dreamNotes?: string;
}> = [
  {
    id: 'log-7',
    date: '2026-09-22',
    bedtime: '23:15',
    wakeTime: '07:10',
    latencyMinutes: 14,
    wakeCount: 1,
    wakingMood: 'refreshed',
    preSleepHabits: ['reading', 'hot_bath', 'meditation'],
    dreamNotes: '梦见在海边森林散步，微风徐徐，很舒服。',
  },
  { id: 'log-6', date: '2026-09-21', bedtime: '23:45', wakeTime: '07:00', latencyMinutes: 22, wakeCount: 2, wakingMood: 'neutral', preSleepHabits: ['screen_time'] },
  { id: 'log-5', date: '2026-09-20', bedtime: '00:20', wakeTime: '07:30', latencyMinutes: 28, wakeCount: 3, wakingMood: 'tired', preSleepHabits: ['screen_time', 'caffeine'], dreamNotes: '赶公交车迟到的紧张梦境。' },
  { id: 'log-4', date: '2026-09-19', bedtime: '23:30', wakeTime: '08:00', latencyMinutes: 12, wakeCount: 1, wakingMood: 'refreshed', preSleepHabits: ['meditation', 'reading'] },
  { id: 'log-3', date: '2026-09-18', bedtime: '23:10', wakeTime: '06:55', latencyMinutes: 16, wakeCount: 1, wakingMood: 'neutral', preSleepHabits: ['hot_bath'] },
  { id: 'log-2', date: '2026-09-17', bedtime: '01:05', wakeTime: '07:15', latencyMinutes: 35, wakeCount: 4, wakingMood: 'groggy', preSleepHabits: ['screen_time', 'alcohol'] },
  { id: 'log-1', date: '2026-09-16', bedtime: '23:00', wakeTime: '07:05', latencyMinutes: 15, wakeCount: 1, wakingMood: 'refreshed', preSleepHabits: ['meditation'] },
];

export function getInitialSleepLogs(): SleepRecord[] {
  return DEMO_SPEC.map((spec) =>
    buildSleepRecord({
      id: spec.id,
      date: spec.date,
      bedtime: spec.bedtime,
      wakeTime: spec.wakeTime,
      latencyMinutes: spec.latencyMinutes,
      wakeCount: spec.wakeCount,
      wakingMood: spec.wakingMood,
      preSleepHabits: spec.preSleepHabits,
      dreamNotes: spec.dreamNotes,
      ...(spec.id === 'log-7'
        ? {
            soundEvents: [
              { time: '02:40', decibel: 32, label: '翻身微动' },
              { time: '05:15', decibel: 38, label: '轻微呼吸声' },
            ],
          }
        : {}),
    })
  );
}

/** 导入/读取外部数据时用于修复缺失字段，避免下游 `r.bedtime.split` 直接抛错 */
export function isSleepRecordLike(value: unknown): value is SleepRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    typeof r.bedtime === 'string' &&
    /^\d{1,2}:\d{2}$/.test(r.bedtime) &&
    typeof r.wakeTime === 'string' &&
    /^\d{1,2}:\d{2}$/.test(r.wakeTime)
  );
}
