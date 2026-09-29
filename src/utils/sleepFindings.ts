import { SleepRecord, UserProfile } from '../types/sleep';

/**
 * 数据驱动的「发现」引擎 —— 替代原先的关键词固定稿答库。
 *
 * ## 为什么要重写
 *
 * 旧实现（clinicalSleepEngine 的 generateLocalChatReply）实测有两个硬伤：
 *
 * 1. **75% 的真实提问答不了**。16 个常见问题里 12 个掉进兜底分支
 *    （"我每天睡 6 小时够吗"、"周末补觉有用吗"、"为什么睡了 9 小时还是累"…），
 *    兜底内容是复述问题 + 让用户换个说法。
 * 2. **命中的分支也是固定稿**。同一句「深睡比例偏低怎么提升？」，一个用户
 *    深睡占比 21%，另一个 7% 且凌晨 2:40 才睡、夜醒 5 次——两段回答
 *    去掉数字后**逐行完全相同**。等于给健康人和重度紊乱者同一套建议。
 *
 * 根因是把功能定位成「问诊机器人」，但它的知识是固定稿、它对数据无感知。
 * 换个定位就通了：**先算指标 → 指标越过临床阈值才生成一条「发现」→
 * 发现里点名最可能的原因（从用户自己的记录里找，不是罗列所有可能）**。
 * 提问只用来**选择展示哪条发现**，不再负责生成内容。
 *
 * 于是同一句话在不同数据下必然给出不同回答——不是靠写更多分支，
 * 而是因为回答本来就是从数据算出来的。
 *
 * ## 安全边界（保持不变）
 *
 * 危机干预与处方药问询仍由 clinicalSleepEngine 无条件熔断，不走这里。
 */

export type FindingSeverity = 'act' | 'watch' | 'good';

/**
 * 数据的来源。这个字段存在的唯一理由是**防止把模拟量当测量量**。
 *
 * 背景（实测）：`generateSleepStages` 按固定周期模型（前两周期深睡 34%、之后 12%）
 * 从「就寝/起床/入睡用时/夜醒次数」算出分期，深睡占比因此几乎完全由睡眠时长决定
 * （穷举 8470 组输入，与时长相关 r = −0.769；触发「深睡偏低」的样本 89% 是睡 ≥9 小时的人）。
 *
 * 所以阶段拆分是 `modeled`——推演值，不是测量值。
 * 就寝时刻、起床时刻、入睡用时、夜醒次数、醒来心情是用户直接录入的，属 `measured`。
 *
 * 规则：`modeled` 的指标不得进入默认清单、不得判为 act。
 * 因为对它下临床判断，等于对模型下诊断。
 */
export type Provenance = 'measured' | 'modeled';

export interface Finding {
  id: string;
  /** 这个指标的数值从哪来（见 Provenance 的说明） */
  provenance: Provenance;
  severity: FindingSeverity;
  /** 指标名，如「深睡占比」 */
  metric: string;
  /** 用户实际值，如「7%」 */
  value: string;
  /** 临床参照，如「TST 目标 13–23%」 */
  reference: string;
  /** 一句话结论 */
  headline: string;
  /** 为什么会这样——引用用户自己的数据，指明最可能的原因 */
  detail: string;
  /** 具体动作，最多 3 条 */
  levers: string[];
  /** 路由用的话题关键词 */
  topics: string[];
}

export interface SleepStats {
  nights: number;
  avgDurationMin: number;
  avgDeepMin: number;
  avgRemMin: number;
  deepPct: number;
  remPct: number;
  /** 入睡潜伏期中位数——比均值更稳，少数难入睡的夜晚不会把整体拉偏 */
  medLatency: number;
  avgWakeCount: number;
  avgEfficiency: number;
  /** 就寝时间的中位数（0–24 小时制小数，跨零点已归算，如 01:10 → 25.17） */
  medBedtimeHour: number;
  /** 就寝时间的四分位距（小时）——越大越不规律 */
  bedtimeIQR: number;
  targetDurationMin: number;
  habitCounts: Record<string, number>;
}

const MIN_NIGHTS_FOR_TREND = 3;

/**
 * 「可以夸深睡」所需的平均时长下限（分钟）。低于这个值就**不产 deep_good**。
 *
 * 为什么需要这个门槛：深睡占比不是实测，而是 generateSleepStages 由**作息推演**出来的，
 * 它与睡眠时长的相关系数是 **r = −0.769**——睡得越少，这个百分比越高。
 * 实测（固定 23:00 就寝、15 分钟入睡、1 次夜醒，只改起床时间，各 7 晚）：
 *
 *     睡 4.0h → 深睡 27%      睡 7.0h → 21%      睡 10.0h → 18%
 *     睡 6.0h → 深睡 23%      睡 8.0h → 21%      睡 12.0h → 18%
 *
 * 在加这个门槛之前，**上表每一档都判 deep_good**，也就是会告诉一个只睡 4 小时的人
 * 「你的深睡已经高于目标区间，不需要再想办法提升深睡」。
 * 那不是安慰，是**由一个反向指标推出的有害建议**。
 *
 * 时长不足时该说的是时长，不是深睡——时长由用户实际记录，是真数据。
 */
const DURATION_OK_FOR_DEEP_PRAISE_MIN = 420; // 7 小时

/** 就寝时间换算到「以正午为界」的连续轴，避免 23:50 与 00:10 被算成相差 23 小时 */
export function bedtimeToAxis(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const hours = h + m / 60;
  return hours < 12 ? hours + 24 : hours;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function computeSleepStats(
  records: SleepRecord[],
  profile?: UserProfile
): SleepStats {
  const target = profile?.targetDurationHours ?? 8;
  const base: SleepStats = {
    nights: 0,
    avgDurationMin: 0,
    avgDeepMin: 0,
    avgRemMin: 0,
    deepPct: 0,
    remPct: 0,
    medLatency: 0,
    avgWakeCount: 0,
    avgEfficiency: 0,
    medBedtimeHour: 0,
    bedtimeIQR: 0,
    targetDurationMin: Math.round(target * 60),
    habitCounts: {},
  };
  if (records.length === 0) return base;

  const mean = (f: (r: SleepRecord) => number) =>
    records.reduce((a, r) => a + (f(r) || 0), 0) / records.length;

  const avgDurationMin = Math.round(mean((r) => r.durationMinutes));
  const avgDeepMin = Math.round(mean((r) => r.deepSleepMinutes));
  const avgRemMin = Math.round(mean((r) => r.remSleepMinutes));

  const bedtimes = records
    .map((r) => bedtimeToAxis(r.bedtime))
    .filter((v) => Number.isFinite(v));

  const habitCounts: Record<string, number> = {};
  for (const r of records) {
    for (const h of r.preSleepHabits || []) {
      habitCounts[h] = (habitCounts[h] || 0) + 1;
    }
  }

  return {
    nights: records.length,
    avgDurationMin,
    avgDeepMin,
    avgRemMin,
    // 占比按 TST 定义，与 SleepHypnogram / TodayTab 的「深睡阶段 xx%」同口径
    deepPct: avgDurationMin > 0 ? Math.round((avgDeepMin / avgDurationMin) * 100) : 0,
    remPct: avgDurationMin > 0 ? Math.round((avgRemMin / avgDurationMin) * 100) : 0,
    medLatency: Math.round(median(records.map((r) => r.latencyMinutes || 0))),
    avgWakeCount: Number(mean((r) => r.wakeCount).toFixed(1)),
    avgEfficiency: Math.round(mean((r) => r.sleepEfficiency)),
    medBedtimeHour: median(bedtimes),
    bedtimeIQR: quantile(bedtimes, 0.75) - quantile(bedtimes, 0.25),
    targetDurationMin: base.targetDurationMin,
    habitCounts,
  };
}

const fmtHour = (axisHour: number): string => {
  const h = Math.floor(((axisHour % 24) + 24) % 24);
  const m = Math.round((axisHour - Math.floor(axisHour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const hhmm = (min: number): string =>
  `${Math.floor(min / 60)}小时${String(min % 60).padStart(2, '0')}分`;

/**
 * 从用户自己的记录里找出「最可能解释这个指标」的那一个原因。
 *
 * 这是本模块和固定稿的分界线：固定稿会同时列出所有可能原因（泡澡、光照、酒精…），
 * 等于没告诉你该先动哪一个。这里只挑一条，而且是**数据支持的那一条**。
 */
function dominantCause(candidates: { test: boolean; cause: string }[]): string | null {
  for (const c of candidates) {
    if (c.test) return c.cause;
  }
  return null;
}


export interface HabitSpec {
  key: string;
  label: string;
  topics: string[];
  metric: string;
  unit: string;
  higherIsWorse: boolean;
  /** 完整的动作句。不能拿 label 去拼——"睡前避免" + "睡前使用屏幕" 会叠字 */
  avoid: string;
  compare: (r: SleepRecord) => number;
}

const HABIT_SPECS: HabitSpec[] = [
  { key: 'caffeine', label: '咖啡因（咖啡/茶/奶茶）', topics: ['caffeine', 'diet'],

    avoid: '把咖啡因截止时间提前到睡前 8 小时（约下午 2 点前）',    metric: '入睡用时', unit: '分钟', higherIsWorse: true, compare: (r) => r.latencyMinutes || 0 },
  { key: 'alcohol', label: '饮酒', topics: ['alcohol', 'diet'],

    avoid: '睡前 3 小时不饮酒',    metric: '夜醒次数', unit: '次', higherIsWorse: true, compare: (r) => r.wakeCount || 0 },
  { key: 'screen_time', label: '睡前使用屏幕', topics: ['screen', 'habit'],

    avoid: '睡前 1 小时放下手机，把屏幕换成纸质阅读',    metric: '入睡用时', unit: '分钟', higherIsWorse: true, compare: (r) => r.latencyMinutes || 0 },
  { key: 'workout', label: '睡前运动', topics: ['workout', 'exercise'],

    avoid: '把运动安排在睡前 3 小时以前',    metric: '睡眠效率', unit: '%', higherIsWorse: false, compare: (r) => r.sleepEfficiency || 0 },
];

/** 差距要超过 15% 才算"看得出来"，否则只是噪声——不拿巧合当结论 */
const HABIT_REL_THRESHOLD = 0.15;

export function computeHabitFindings(records: SleepRecord[]): Finding[] {
  const out: Finding[] = [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  for (const h of HABIT_SPECS) {
    const withH = records.filter((r) => (r.preSleepHabits || []).includes(h.key));
    const withoutH = records.filter((r) => !(r.preSleepHabits || []).includes(h.key));
    const nWith = withH.length;
    const round = (v: number) => (h.unit === '%' ? Math.round(v) : Math.round(v * 10) / 10);

    if (nWith === 0) {
      out.push({
        id: `habit_${h.key}_nodata`,
        provenance: 'measured',
        severity: 'watch',
        metric: `${h.label}的影响`,
        value: '尚无记录',
        reference: '需要 ≥2 晚有、≥2 晚无',
        headline: `还没有记录过「${h.label}」，无法判断它对你有没有影响`,
        detail:
          `这里不做通用科普式的断言——${h.label}会不会影响睡眠，取决于你自己的代谢速度和摄入时间。` +
          `如果你在「记录昨夜睡眠」里勾选它，攒够几晚之后就能拿你有该习惯的夜晚和没有的夜晚直接对比，结论会比任何通用建议都准。`,
        levers: [`下次记录睡眠时勾选「${h.label}」`],
        topics: h.topics,
      });
      continue;
    }

    const vWith = avg(withH.map(h.compare));
    const vWithout = withoutH.length ? avg(withoutH.map(h.compare)) : null;

    if (vWithout === null || nWith < 2 || withoutH.length < 2) {
      out.push({
        id: `habit_${h.key}_thin`,
        provenance: 'measured',
        severity: 'watch',
        metric: `${h.label}的影响`,
        value: `${nWith} 晚有记录`,
        reference: '需要 ≥2 晚有、≥2 晚无',
        headline: `「${h.label}」的样本还太少，先不下结论`,
        detail:
          `你有 ${nWith} 晚记录了${h.label}，这些夜晚的${h.metric}平均是 ${round(vWith)}${h.unit}。` +
          `但对照的夜晚不够，现在比较会得出不可靠的结论——不给你一个可能是巧合的答案。再记几晚就可以了。`,
        levers: [],
        topics: h.topics,
      });
      continue;
    }

    const delta = vWith - vWithout;
    const rel = vWithout !== 0 ? Math.abs(delta) / vWithout : 0;
    const worse = h.higherIsWorse ? delta > 0 : delta < 0;
    const pair = `有${h.label}的 ${nWith} 晚，${h.metric}平均 ${round(vWith)}${h.unit}；没有的 ${withoutH.length} 晚是 ${round(vWithout)}${h.unit}`;

    if (rel >= HABIT_REL_THRESHOLD && worse) {
      out.push({
        id: `habit_${h.key}_bad`,
        provenance: 'measured',
        severity: 'act',
        metric: `${h.label}的影响`,
        value: `${round(vWith)} → ${round(vWithout)}${h.unit}`,
        reference: `有 / 无「${h.label}」时你的${h.metric}`,
        headline: `有「${h.label}」的夜晚，${h.metric}明显更差`,
        detail:
          `这是拿你自己的夜晚直接对比：${pair}，差了 ${Math.abs(round(delta))}${h.unit}（约 ${Math.round(rel * 100)}%）。` +
          `同一个人的前后对比排除了大部分个体差异，所以这个差距比人群平均值更值得你当真。`,
        levers: [`${h.avoid}，再记录 5–7 晚看差距是否维持`],
        topics: h.topics,
      });
    } else if (rel >= HABIT_REL_THRESHOLD) {
      out.push({
        id: `habit_${h.key}_good`,
        provenance: 'measured',
        severity: 'good',
        metric: `${h.label}的影响`,
        value: `${round(vWith)} → ${round(vWithout)}${h.unit}`,
        reference: `有 / 无「${h.label}」时你的${h.metric}`,
        headline: `有「${h.label}」的夜晚，${h.metric}反而更好`,
        detail:
          `${pair}。差距对你有利，但样本还小，别急着当因果——继续记录，如果这个方向稳定，那就是你个人的真实规律。`,
        levers: [],
        topics: h.topics,
      });
    } else {
      out.push({
        id: `habit_${h.key}_neutral`,
        provenance: 'measured',
        severity: 'good',
        metric: `${h.label}的影响`,
        value: `${round(vWith)} → ${round(vWithout)}${h.unit}`,
        reference: `有 / 无「${h.label}」时你的${h.metric}`,
        headline: `「${h.label}」对你的${h.metric}看不出明显影响`,
        detail:
          `${pair}，差距在噪声范围内。这是好消息：说明你不必为「${h.label}」这件事焦虑，把注意力放到更有影响的因素上。`,
        levers: [],
        topics: h.topics,
      });
    }
  }
  return out;
}

/**
 * @param opts.includeOnDemand 是否包含「样本还太少 / 还没记录过」这类发现。
 *
 * 展示时**不包含**（健康用户打开看到 4 条"你还没记录运动"是噪声），
 * 但**路由时必须包含**——用户明确问「下午喝茶影响睡眠吗」时，
 * "你还没记录过咖啡因，记了我就能拿你自己的夜晚对比"才是正确回答。
 * 把这两件事合成一个开关，是为了不再出现"过滤掉之后连问都问不到"。
 */

/**
 * 「最近 vs 更早」的自我基线对比。
 *
 * 为什么需要它：只有教科书阈值时，「深睡 7%」这个事实无法区分两种完全不同的情况——
 * **一直如此**（结构性，要查就寝时间、时长、饮酒）vs **最近才掉下来**（急性，要找
 * 最近发生了什么变化）。这两者给的建议方向相反，而单看一个 7% 是分不出来的。
 *
 * 所以有足够记录（≥14 晚）时，把最近 7 晚和之前的夜晚分开比。这是 Sleep as Android
 * 的「7 天 vs 60 天基线」和 HiMe「不要用硬编码正常值」的同一个思路：
 * **参照系应该主要是用户自己**，教科书阈值只在他还没有基线时兜底。
 */
export const MIN_NIGHTS_FOR_BASELINE = 14;

export function computeTrendFinding(records: SleepRecord[]): Finding | null {
  if (records.length < MIN_NIGHTS_FOR_BASELINE) return null;

  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : -1)); // 新的在前
  const recent = sorted.slice(0, 7);
  const earlier = sorted.slice(7);
  if (earlier.length < 5) return null;

  const mean = (xs: SleepRecord[], f: (r: SleepRecord) => number) =>
    xs.reduce((a, r) => a + (f(r) || 0), 0) / xs.length;
  const deepPct = (r: SleepRecord) =>
    r.durationMinutes > 0 ? (r.deepSleepMinutes / r.durationMinutes) * 100 : 0;

  const now = mean(recent, deepPct);
  const before = mean(earlier, deepPct);
  const delta = now - before;
  const dur = mean(recent, (r) => r.durationMinutes) - mean(earlier, (r) => r.durationMinutes);

  const r1 = Math.round(now);
  const r0 = Math.round(before);

  // 变化小于 3 个百分点视为持平——这个量级在只有 7 晚的窗口里区分不出信号
  if (Math.abs(delta) < 3) {
    return {
      id: 'baseline_stable',
      provenance: 'modeled',
      severity: 'good',
      metric: '深睡 vs 你自己的基线',
      value: `${r1}% ≈ ${r0}%`,
      reference: `你自己前 ${earlier.length} 晚`,
      headline: `作息推演的深睡稳定在 ${r0}% 左右`,
      // 标题必须自曝来源：provenance 只管默认清单过滤与脚注，
      // 而用户读到的第一句是标题（详见「来源标注必须出现在标题里」的教训）。
      detail:
        `最近 7 晚深睡占比 ${r1}%，你之前 ${earlier.length} 晚是 ${r0}%，基本持平。` +
        `**稳定本身就是结论**：说明这个水平是你当前的常态，不是最近出了什么状况——` +
        `所以要动就该动长期因素（就寝时间、时长），而不是去猜昨晚做错了什么。`,
      levers: [],
      topics: ['deep_sleep', 'baseline'],
    };
  }

  const falling = delta < 0;
  return {
    id: 'baseline_change',
    provenance: 'modeled',
    severity: falling ? 'act' : 'good',
    metric: '深睡 vs 你自己的基线',
    value: `${r0}% → ${r1}%`,
    reference: `你自己前 ${earlier.length} 晚`,
    // 标题也带来源标记：provenance 字段只管住了默认清单过滤与脚注，
    // 用户读到的第一句仍然是标题。这一项是推演的，标题就不能写成实测的口吻。
    headline: falling
      ? `作息推演的深睡从你的基线 ${r0}% 掉到了 ${r1}%`
      : `作息推演的深睡从你的基线 ${r0}% 回到 ${r1}%`,
    detail:
      `最近 7 晚 ${r1}%，你之前 ${earlier.length} 晚 ${r0}%，变化 ${delta > 0 ? '+' : ''}${delta.toFixed(1)} 个百分点` +
      `（同期睡眠时长${dur >= 0 ? '增加' : '减少'}了 ${Math.abs(Math.round(dur))} 分钟）。` +
      (falling
        ? `**这是变化，不是常态**——所以重点不是"怎么提升深睡"，而是回想最近两三周有什么变了：就寝时间推迟了？工作时长变了？开始服药或饮酒了？找到那个变化比任何助眠技巧都直接。`
        : `比你自己之前的水平有回升，值得留意是什么改变带来的——如果是某件具体的事，把它固定下来。`),
    levers: falling ? ['回想最近 2–3 周的生活变化，只改回其中一项，再记录 5–7 晚'] : [],
    topics: ['deep_sleep', 'baseline'],
  };
}

export function computeFindings(
  records: SleepRecord[],
  profile?: UserProfile,
  opts: { includeOnDemand?: boolean } = {}
): Finding[] {
  const s = computeSleepStats(records, profile);
  const out: Finding[] = [];
  if (s.nights === 0) return out;

  const insufficient = s.nights < MIN_NIGHTS_FOR_TREND;
  const caveat = insufficient ? `（目前只有 ${s.nights} 晚记录，趋势还不稳）` : '';

  const deepCount = s.habitCounts['alcohol'] || 0;
  const caffeineCount = s.habitCounts['caffeine'] || 0;
  const screenCount = s.habitCounts['screen_time'] || 0;
  const lateBed = s.medBedtimeHour >= 24.5; // ≥ 00:30
  const shortSleep = s.avgDurationMin < 380; // < 6h20m

  // ── 1. 深睡占比（TST 参照 13–23%；推演值，图例只标「推演·不可比」）──
  if (!insufficient) {
    if (s.deepPct < 13) {
      const cause = dominantCause([
        {
          test: lateBed,
          cause: `你的就寝时间中位数是 ${fmtHour(s.medBedtimeHour)}，这很可能是首要原因：慢波睡眠集中在前半夜的周期里，入睡越晚，第一个深睡波峰被推得越靠后，而它本该是整晚最厚的一段。`,
        },
        {
          test: shortSleep,
          cause: `你的平均睡眠只有 ${hhmm(s.avgDurationMin)}，这很可能是首要原因：深睡主要发生在前两个睡眠周期，时长短本身就是直接截断深睡。先把时长补上来，比任何技巧都有效。`,
        },
        {
          test: deepCount > 0,
          cause: `你的记录里有 ${deepCount} 晚出现饮酒。酒精能缩短入睡时间，但会明显抑制慢波睡眠并打碎后半夜——这通常比其它因素更值得先处理。`,
        },
      ]);
      out.push({
        id: 'deep_low',
        provenance: 'modeled',
        severity: 'act',
        metric: '深睡占比',
        value: `${s.deepPct}%`,
        reference: '临床分期 13–23%，推演值不可比',
        headline: `作息推演的深睡占比 ${s.deepPct}%`,
        detail:
          '这个百分比是模型按你的就寝与起床时间推算的，不是分期实测，' +
          '所以它偏低通常只说明**这套作息算出来的周期结构不理想**，不等于你的真实深睡偏少。' +
          `${cause ?? '在排除掉就寝过晚、时长不足、饮酒这几个常见因素后，剩下的通常与睡前体温、光照和压力有关。'}` +
          caveat,
        levers: cause
          ? ['先只改这一件事，连续记录 5–7 晚再看深睡占比是否回升']
          : [
              '睡前 60–90 分钟温水浴 15 分钟，让核心体温在入睡时自然回落',
              '晨起 30 分钟内接触 15 分钟自然光，把生物钟往前锚定',
              '睡前避免酒精与重油夜宵',
            ],
        topics: ['deep_sleep', 'deep'],
      });
    } else if (s.deepPct < 18) {
      out.push({
        id: 'deep_watch',
        provenance: 'modeled',
        severity: 'watch',
        metric: '深睡占比',
        value: `${s.deepPct}%`,
        reference: '临床分期 13–23%，推演值不可比',
        headline: `作息推演的深睡占比 ${s.deepPct}%`,
        detail: `这个数字落在模型区间里，但对推演值本身不必追求"更达标"。` +
          `值得做的是把就寝时间固定下来——规律性能稳定的是**总时长与入睡时刻**，` +
          `这两项是实测的；至于深睡占比会跟着变，那是模型重算了输入，不是你身体的深睡变了。${caveat}`,
        levers: ['把就寝时间的中位数固定在同一时刻，波动控制在 30 分钟内'],
        topics: ['deep_sleep', 'deep'],
      });
    } else if (s.avgDurationMin >= DURATION_OK_FOR_DEEP_PRAISE_MIN) {
      out.push({
        id: 'deep_good',
        provenance: 'modeled',
        severity: 'good',
        metric: '深睡占比',
        value: `${s.deepPct}%`,
        reference: '临床分期 13–23%，推演值不可比',
        headline: `作息推演的深睡占比 ${s.deepPct}%`,
        detail: `模型按你现在的作息算出了这个百分比，它主要反映的是**你睡够了多久**，不是你的深睡质量。` +
          `这个 App 测不到深睡，所以不要拿它去和"提升深睡"的方法比较效果——那需要一个能真正测分期的设备。` +
          `你可以控制的是时长与规律性，这两项本身就是实测的。${caveat}`,
        levers: [],
        topics: ['deep_sleep', 'deep'],
      });
    }
  }

  // ── 2. 入睡潜伏期（正常 ≤30 分钟，是失眠的临床判据之一）──
  if (!insufficient) {
    if (s.medLatency > 30) {
      const cause = dominantCause([
        {
          test: caffeineCount > 0,
          cause: `你的记录里有 ${caffeineCount} 晚睡前摄入咖啡因。咖啡因半衰期约 5–7 小时，清除 75% 需要近 10 小时——下午喝的咖啡到半夜仍在起效，这比你睡前做什么都更影响入睡。`,
        },
        {
          test: screenCount > 0,
          cause: `你的记录里有 ${screenCount} 晚睡前使用屏幕。屏幕光会推迟褪黑素分泌时相，让"困意"本身来得更晚。`,
        },
        {
          test: lateBed,
          cause: `你的就寝时间中位数是 ${fmtHour(s.medBedtimeHour)}。如果这个时间是"还睡不着才躺下"，那它其实是结果不是原因；但如果是"到这个点才允许自己睡"，把就寝提前 30 分钟通常比任何放松技巧都有效。`,
        },
      ]);
      out.push({
        id: 'latency_high',
        provenance: 'measured',
        severity: 'act',
        metric: '入睡潜伏期',
        value: `${s.medLatency} 分钟`,
        reference: '正常 ≤30 分钟',
        headline: `入睡要 ${s.medLatency} 分钟，超过正常范围`,
        detail:
          `${cause ?? '躺下后长时间无法入睡，通常与"床 = 清醒"的条件反射有关。'}` + caveat,
        levers: [
          '躺下超过 20 分钟仍无睡意就起身，到昏暗处做枯燥的事，有困意再回床（刺激控制法）',
          '固定起床时间，不要因为昨晚没睡好就赖床补觉',
        ],
        topics: ['latency', 'insomnia', 'fall_asleep'],
      });
    } else if (s.medLatency > 20) {
      out.push({
        id: 'latency_watch',
        provenance: 'measured',
        severity: 'watch',
        metric: '入睡潜伏期',
        value: `${s.medLatency} 分钟`,
        reference: '正常 ≤30 分钟',
        headline: `入睡潜伏期 ${s.medLatency} 分钟，正常范围内偏慢`,
        detail: `入睡需要 10–20 分钟是正常的，你处在正常区间的偏慢一侧，还不是失眠。${caveat}`,
        levers: ['睡前 1 小时调暗灯光，把屏幕换成纸质阅读'],
        topics: ['latency', 'insomnia', 'fall_asleep'],
      });
    } else {
      out.push({
        id: 'latency_good',
        provenance: 'measured',
        severity: 'good',
        metric: '入睡潜伏期',
        value: `${s.medLatency} 分钟`,
        reference: '正常 ≤30 分钟',
        headline: `入睡只需 ${s.medLatency} 分钟，很正常`,
        detail: `入睡速度正常，说明你的睡眠驱动力和昼夜节律配合得不错。${caveat}`,
        levers: [],
        topics: ['latency', 'insomnia', 'fall_asleep'],
      });
    }
  }

  // ── 3. 睡眠时长 vs 目标 ──
  if (!insufficient) {
    const deficit = s.targetDurationMin - s.avgDurationMin;
    if (deficit >= 60) {
      out.push({
        id: 'duration_short',
        provenance: 'measured',
        severity: 'act',
        metric: '睡眠时长',
        value: hhmm(s.avgDurationMin),
        reference: `你的目标 ${hhmm(s.targetDurationMin)}`,
        headline: `平均比目标少睡 ${Math.round(deficit / 60 * 10) / 10} 小时`,
        detail:
          `你近 ${s.nights} 晚平均睡 ${hhmm(s.avgDurationMin)}，目标是 ${hhmm(s.targetDurationMin)}，` +
          `每晚差 ${deficit} 分钟。睡眠不足会先牺牲深睡和 REM，再影响白天的注意力和情绪；` +
          `按你现在的起床时间，这个缺口不是靠"睡得更沉"能补的，只能靠提前就寝。` +
          caveat,
        levers: [
          `把就寝时间提前 ${Math.min(60, Math.round(deficit))} 分钟，起床时间保持不变`,
        ],
        topics: ['duration', 'enough', 'sleep_length'],
      });
    } else if (deficit >= 30) {
      out.push({
        id: 'duration_watch',
        provenance: 'measured',
        severity: 'watch',
        metric: '睡眠时长',
        value: hhmm(s.avgDurationMin),
        reference: `你的目标 ${hhmm(s.targetDurationMin)}`,
        headline: `比目标少睡约 ${deficit} 分钟`,
        detail: `缺口不大，提前 30 分钟就寝通常就能补平，不需要动起床时间。${caveat}`,
        levers: ['就寝提前 30 分钟'],
        topics: ['duration', 'enough', 'sleep_length'],
      });
    } else {
      out.push({
        id: 'duration_good',
        provenance: 'measured',
        severity: 'good',
        metric: '睡眠时长',
        value: hhmm(s.avgDurationMin),
        reference: `你的目标 ${hhmm(s.targetDurationMin)}`,
        headline: '睡眠时长达到目标',
        detail: `时长稳定达标，这是所有指标里最难靠技巧改善、也最值得守住的一项。${caveat}`,
        levers: [],
        topics: ['duration', 'enough', 'sleep_length'],
      });
    }
  }

  // ── 4. 夜间觉醒 ──
  if (!insufficient) {
    if (s.avgWakeCount >= 3) {
      const cause = dominantCause([
        {
          test: deepCount > 0,
          cause: `你的记录里有 ${deepCount} 晚饮酒。酒精代谢到后半夜会产生反跳性觉醒，这是"能睡着但睡不整"最常见的原因。`,
        },
        {
          test: caffeineCount > 0,
          cause: `你的记录里有 ${caffeineCount} 晚摄入咖啡因，它会在后半夜仍维持一定的中枢兴奋，让微觉醒更容易变成彻底清醒。`,
        },
      ]);
      out.push({
        id: 'awake_high',
        provenance: 'measured',
        severity: 'act',
        metric: '夜醒次数',
        value: `平均 ${s.avgWakeCount} 次`,
        reference: '≤1 次为佳',
        headline: `平均每晚醒 ${s.avgWakeCount} 次，睡眠被打断`,
        detail:
          `${cause ?? `你近 ${s.nights} 晚平均每晚醒 ${s.avgWakeCount} 次，睡眠被切成了好几段。频繁夜醒会让睡眠碎片化，即使总时长够，恢复效果也会打折。`}` +
          caveat,
        levers: [
          '卧室温度保持在 19–21℃，后半夜核心体温降到谷底时对温度最敏感',
          '醒来后不要看时间，看钟会立刻提高唤醒度',
        ],
        topics: ['awakening', 'night_wake', 'fragment'],
      });
    } else if (s.avgWakeCount > 1.5) {
      // 判级必须和写出来的参照值一致：参照写「≤1 次为佳」，
      // 那 1.9 次就不能标成 good。原先这里只有 act / good 两档，
      // 于是 2 次既够不上 3 次的门槛、又被当成"连续"。
      out.push({
        id: 'awake_watch',
        provenance: 'measured',
        severity: 'watch',
        metric: '夜醒次数',
        value: `平均 ${s.avgWakeCount} 次`,
        reference: '≤1 次为佳',
        headline: `平均每晚醒 ${s.avgWakeCount} 次，略偏多`,
        detail: `还没到影响恢复的程度，但夜间被打断两次以上，深睡更容易被切碎。多数情况下先把咖啡因和酒精排除掉就有效。${caveat}`,
        levers: ['睡前 8 小时不摄入咖啡因，睡前 3 小时不饮酒'],
        topics: ['awakening', 'night_wake', 'fragment'],
      });
    } else {
      out.push({
        id: 'awake_good',
        provenance: 'measured',
        severity: 'good',
        metric: '夜醒次数',
        value: `平均 ${s.avgWakeCount} 次`,
        reference: '≤1 次为佳',
        headline: '夜间睡眠连续',
        detail: `整夜基本没有被明显打断，这是睡眠质量里含金量很高的一项。${caveat}`,
        levers: [],
        topics: ['awakening', 'night_wake', 'fragment'],
      });
    }
  }

  // ── 6. 睡前习惯的实际影响：拿用户自己的夜晚前后对比，不做通用科普 ──
  // 这一节和其他几节的回答方式不同：不做人群对照，而是**有该习惯的夜晚
  // vs 没有该习惯的夜晚**比。同一个人的两次夜晚，混杂因素天然少得多，
  // 所以哪怕只有几晚，也比"下午喝茶会影响睡眠"这种通用结论更贴他。
  // 这也是"它真的看了我的数据"最直接的体现。
  // 「尚无记录 / 样本太少」不进默认清单：它们只在被问到时才有价值。
  // 否则一个没有记录习惯的用户打开就看到 4 条"你还没记录运动"，纯噪声。
  const habitFindings = computeHabitFindings(records);
  out.push(
    ...(opts.includeOnDemand
      ? habitFindings
      : habitFindings.filter((f) => !f.id.endsWith('_nodata') && !f.id.endsWith('_thin')))
  );

  // ── 5. 就寝规律性 ──
  if (!insufficient && s.bedtimeIQR >= 1) {
    out.push({
      id: 'irregular',
      provenance: 'measured',
      severity: s.bedtimeIQR >= 1.5 ? 'act' : 'watch',
      metric: '就寝时间波动',
      value: `±${(s.bedtimeIQR / 2).toFixed(1)} 小时`,
      reference: '波动 ≤0.5 小时为佳',
      headline: `就寝时间波动偏大（${fmtHour(s.medBedtimeHour)} 前后）`,
      detail:
        `你的就寝时间四分位距是 ${s.bedtimeIQR.toFixed(1)} 小时，也就是最规律的四分之一夜晚和最不规律的四分之一夜晚差了这么久。` +
        `生物钟靠固定信号校准，波动大时它会持续"倒时差"，这往往比总时长更影响白天的清醒度。` +
        caveat,
      levers: ['先固定起床时间——它比固定就寝时间更容易做到，也能反向拉动就寝时间'],
      topics: ['regularity', 'circadian', 'routine'],
    });
  } else if (!insufficient) {
    out.push({
      id: 'regularity_good',
      provenance: 'measured',
      severity: 'good',
      metric: '就寝时间波动',
      value: `±${(s.bedtimeIQR / 2).toFixed(1)} 小时`,
      reference: '波动 ≤0.5 小时为佳',
      headline: '就寝时间很规律',
      detail:
        `你的就寝时间中位数是 ${fmtHour(s.medBedtimeHour)}，波动很小。` +
        `所以如果早上起不来，**问题大概率不在作息规律性上**，更可能是睡眠时长不够、或起床时间本身早于你的生物钟——` +
        `这两个方向的处理方式完全不同，别去调一个本来没毛病的地方。${caveat}`,
      levers: [],
      topics: ['regularity', 'circadian', 'routine'],
    });
  }

  // 注意：这里必须显式断言。实测 TypeScript 7.0.2 在本项目的 tsconfig 下
  // 不对 `trend !== null` 收窄——它的赋值检查认为 null 不可赋给 Finding，
  // 但收窄不生效，两者行为不一致（`if (trend)`、`!== null`、三元式都不收窄，
  // 只有 `as` / `!` 能通过）。守卫本身是完整的，断言只是补上编译器这一环。
  const trend = computeTrendFinding(records);
  if (trend !== null) out.push(trend as Finding);

  // ── 7. 睡眠环境：不依赖数据，但是有明确共识的常识，问了就直说 ──
  out.push({
    id: 'environment',
    provenance: 'measured',
    severity: 'good',
    metric: '卧室环境',
    value: '18–21℃',
    reference: '睡眠环境共识区间',
    headline: '卧室温度 18–21℃，湿度 40–60%',
    detail:
      `入睡需要核心体温下降，环境太暖会阻碍这个过程；后半夜体温降到谷底时又最容易因为冷而微觉醒。` +
      `18–21℃ 是兼顾两头的区间。这一条不依赖你的记录——它是对所有人都成立的常识。`,
    levers: ['开空调或通风把卧室控制在 18–21℃，比调被褥厚度更直接'],
    topics: ['environment', 'bedroom'],
  });

  const order: Record<FindingSeverity, number> = { act: 0, watch: 1, good: 2 };

  // 兜底降级必须放在**所有发现入列之后**。曾经放在中间，漏掉了后面才 push 的
  // baseline_change（它是 modeled 且原本会是 act）——这种顺序错误不报错，
  // 只会让一条推演结论重新变成"值得先处理"。
  for (const f of out) {
    if (f.provenance === 'modeled' && f.severity === 'act') f.severity = 'watch';
  }

  // 推演值不进默认清单：它只反映推演模型，不反映用户真实情况。
  // 但保留在可路由集合里——用户明确问「深睡怎么样」时应当得到回答，
  // 只是回答里必须讲清这是推演值。
  if (!opts.includeOnDemand) {
    return out
      .filter((f) => f.provenance === 'measured')
      .sort((a, b) => order[a.severity] - order[b.severity]);
  }

  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 话题 → 关键词。提问只用来**选**发现，不用来生成内容。 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  deep_sleep: ['深睡', '慢波', '深度睡眠', '恢复体力', '深睡眠'],
  latency: ['睡不着', '入睡', '失眠', '翻来覆去', '躺很久', '难睡', '快速入睡', '多久睡'],
  awakening: ['半夜醒', '夜醒', '容易醒', '醒来好几', '起夜', '睡不整', '断断续续'],
  duration: ['睡够', '够吗', '几个小时', '睡多久', '时长', '睡得少', '睡得短', '补觉', '还是累', '不解乏', '睡不醒'],
  regularity: ['熬夜', '时差', '生物钟', '规律', '作息', '晚睡', '通宵', '昼夜', '倒班', '起不来', '早上'],
  environment: ['卧室', '房间', '温度', '多冷', '多热', '空调', '湿度'],
  caffeine: ['咖啡', '奶茶', '浓茶', '喝茶', '茶'],
  alcohol: ['喝酒', '饮酒', '酒精', '喝了酒'],
  screen: ['看手机', '刷手机', '屏幕', '手机'],
  workout: ['运动', '锻炼', '健身', '跑步'],
};

/**
 * 能力边界：这些话题**这个 App 不做判断**。
 *
 * 为什么要有这一节：把一条不相关的「发现」硬塞给一个关于用药的问题，
 * 比直接说"我答不了"更糟——它会让人以为自己在接受用药建议。
 * 医疗类产品里，"不知道"必须是可以说出口的答案。
 *
 * 但只说"答不了"是浪费一次对话，所以每条都补一句：**我能做的部分是什么**。
 * 打鼾 / 呼吸暂停 / 磨牙属于必须转诊的信号，措辞要明确，不能含糊过去。
 */
export interface ScopeBoundary {
  id: string;
  keywords: string[];
  reply: string;
}

export const SCOPE_BOUNDARIES: ScopeBoundary[] = [
  {
    id: 'medication',
    keywords: ['褪黑素', '安眠', '助眠药', '吃药', '药物', '处方', '保健品', '补剂', '镁', 'gaba', '剂量'],
    reply:
      `**这类问题我不做判断，因为我不该做。**\n\n` +
      `褪黑素、镁、GABA 这类补充剂，以及任何助眠药物，效果和风险都高度依赖个人情况（年龄、肝肾功能、正在吃的其它药、是否孕期）。` +
      `我只有你的睡眠记录，看不到这些，所以给你一个"能吃/不能吃"的答案是不负责任的。\n\n` +
      `**说点更有用的**：我不评价疗效，但可以把这件事变成一次你自己能读出结论的试验。` +
      `如果你决定试，只要在记录里写下开始的那一天，之后我会拿你**自己的**基线告诉你：` +
      `它有没有真的改变你的入睡用时或夜醒次数——而不是让你去猜。` +
      `单个人的前后对比比任何平均数据都更能说明它对**你**有没有用。\n\n` +
      `另外，如果你在考虑就诊，请挂睡眠医学中心或神经内科/精神心理科。` +
      `顺便说一句：慢性失眠的一线疗法是 CBT-I（失眠认知行为治疗），不是药物，它的长期效果通常比安眠药更持久。`,
  },
  {
    id: 'clinical_symptom',
    keywords: ['磨牙', '打呼', '打鼾', '呼吸暂停', '憋气', '梦游', '遗尿', '腿抽动', '不宁腿', '白天嗜睡'],
    reply:
      `**这个需要医生看，不是我能评估的。**\n\n` +
      `你提到的这类表现（磨牙、打鼾、呼吸暂停、腿部抽动等）属于**临床体征**，需要多导睡眠监测（PSG）或口腔科/耳鼻喉科的面诊才能判断。` +
      `尤其要说清楚：**睡眠呼吸暂停会显著增加心血管风险，而它无法靠任何手机 App 检测出来**——如果你听到伴侣说你打鼾中间有停顿、或者白天困到无法抵抗，请尽快就诊，不要等。\n\n` +
      `**我能做的**：帮你把就寝规律、时长、夜醒这些作息数据记录清楚，就诊时可以直接给医生看。`,
  },
  {
    id: 'product',
    keywords: ['枕头', '床垫', '买什么', '推荐一款', '哪个牌子', '手环', '手表', '设备'],
    reply:
      `**我不会给你推荐具体产品。**\n\n` +
      `原因不是我谦虚：没有任何枕头或床垫对所有人都是"最好"的，它取决于你的睡姿、肩宽、颈椎曲度，这些我看不到。` +
      `而且这类推荐很容易被佣金驱动，我不想让这个 App 变成那种东西。\n\n` +
      `**我能做的**：告诉你该关注什么。枕头的作用是让颈椎在侧卧时保持中立位（高度约等于你一侧肩宽），床垫的作用是让脊柱不下陷——` +
      `这两条你去实体店躺十分钟就能自己判断，比看任何评测都准。至于手环手表，本 App 的分期是模型推演，不与任何设备的数据做对照。`,
  },
];


/**
 * 常识锚点：有些问题是**有共识答案**的（成年人需要几小时、入睡多久算正常）。
 * 只给个人数据会让人无法判断自己是好是坏——"我平均 6.5 小时"没有参照系。
 * 所以先给一句有出处的常识，再叠上你自己的位置，两者合起来才是完整回答。
 */
export const ANSWER_ANCHORS: Record<string, string> = {
  duration:
    '成年人一般需要 7 小时以上（美国睡眠医学会与睡眠研究学会的共识是 7–9 小时，长期少于 7 小时与代谢和心血管风险相关）。',
  latency:
    '健康人躺下到睡着通常需要 10–20 分钟。少于 5 分钟往往说明睡眠严重不足，超过 30 分钟则达到失眠的临床判据之一。',
  environment: '对所有人成立的环境共识是 18–21℃、湿度 40–60%。',
  regularity:
    '生物钟靠固定的时间信号校准，一般建议就寝时间的波动控制在 30–60 分钟内。',
};

export interface RoutedAnswer {
  /** 是否命中了一个我们真能回答的话题 */
  covered: boolean;
  matched: Finding[];
  /** 没命中时，给用户看他最该关心的那条 */
  fallback: Finding | null;
}

export function matchBoundary(text: string): ScopeBoundary | null {
  const lower = text.toLowerCase();
  return SCOPE_BOUNDARIES.find((b) => b.keywords.some((k) => lower.includes(k))) ?? null;
}

export function routeQuestion(text: string, findings: Finding[]): RoutedAnswer {
  const lower = text.toLowerCase();
  const topicKeys = new Set<string>();

  for (const [key, words] of Object.entries(TOPIC_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) topicKeys.add(key);
  }

  if (topicKeys.size === 0) {
    return { covered: false, matched: [], fallback: findings[0] ?? null };
  }

  const matched = findings.filter((f) => f.topics.some((t) => topicKeys.has(t)));
  return {
    covered: matched.length > 0,
    matched,
    fallback: matched.length > 0 ? null : (findings[0] ?? null),
  };
}

/** 把一条发现渲染成聊天回复 */
export function renderFinding(f: Finding, opts: { prefix?: string } = {}): string {
  const icon = f.severity === 'act' ? '⚠️' : f.severity === 'watch' ? '•' : '✓';
  const head = `${icon} **${f.headline}**  （你：${f.value} · 参照：${f.reference}）`;

  // 推演值必须自曝来源。用户看到「深睡占比 21%」会以为这是测出来的，
  // 而它其实是由睡眠时长按固定周期模型推算的——不说明就等于默示它是测量值。
  const provenanceNote =
    f.provenance === 'modeled'
      ? `\n\n> 注意：这一项是**推演值**，不是实测。手机没有脑电电极，` +
        `睡眠分期无法被真正测量；这个数字是根据你的就寝、起床、入睡用时按固定周期模型推算的，` +
        `因此它主要反映睡眠时长，不反映你的真实深睡。`
      : '';

  const body = opts.prefix
    ? `${opts.prefix}\n\n${head}\n\n${f.detail}${provenanceNote}`
    : `${head}\n\n${f.detail}${provenanceNote}`;
  if (f.levers.length === 0) return body;
  return `${body}\n\n${f.levers.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
}
