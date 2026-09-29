/**
 * 智能唤醒：从**活动强度**判断浅睡时刻，并在窗口内挑一个点唤醒。
 *
 * ## 为什么这个文件是纯函数、不碰任何传感器
 *
 * 真实能力边界：**原生侧只负责采样**，把「每个 epoch 的活动计数」交过来，
 * 所有判定都在这里。这样做有两个理由：
 *
 * 1. **可验证**。判定逻辑（窗口边界、去抖、兜底）是真正容易出错的地方，
 *    放在 JS 里可以用合成数据穷举验证；写成 Java 就没法在这个仓库里跑。
 * 2. **可替换**。活动→睡眠深度的算法将来换成 Cole-Kripke / Sadeh 的正式权重，
 *    只需替换 `classifyDepth`，窗口决策一行不动。
 *
 * ## ★ 关于「浅睡判定」这件事的诚实前提
 *
 * 活动记录法（actigraphy）测的是**动得多不多**，不是脑电。
 * 它**不能**区分浅睡与深睡——它只能给出「安静 / 有动静 / 明显在动」。
 * 消费级设备从活动记录推断唤醒时机的特异性只有 **0.18–0.54**
 * （Chinoy 2021, `10.1093/sleep/zsaa291`），也就是说「现在叫醒他正好在浅睡」
 * 这句话本身就是概率性的。
 *
 * 所以这里的措辞与命名一律用 `still / light / awake`（安静 / 有动静 / 在动），
 * **不用「浅睡期」「深睡期」**——那是分期术语，活动记录法给不出来。
 * 界面文案同理，见 `SMART_WAKE_DISCLOSURE`。
 *
 * 同样地：**不去引用 Cole-Kripke / Sadeh 的系数**。
 * 本轮 web_search / web_fetch 均不可用，我无法核对论文里的权重与缩放因子；
 * 凭记忆写一串数然后标注成「Cole-Kripke 算法」，
 * 就是这个项目反复在修的那类缺陷（界面/注释声称了代码做不到或没做过的事）。
 * 所以这里用**明确标为「本项目自定」的阈值法**，并在文件末尾写明
 * 换成正式权重时需要做什么。
 */

/** 原生侧要交上来的东西：一个 epoch 的活动计数。 */
export interface ActivitySample {
  /** 该 epoch 的起点（毫秒时间戳）。 */
  t: number;
  /**
   * 该 epoch 内的活动计数。单位任意，**只要在同一夜内单调**：
   * 数值越大表示动得越多。原生侧可以用加速度三轴差分的绝对值之和。
   */
  count: number;
}

/** 活动强度分档。**刻意回避「浅睡/深睡」这类分期术语**，理由见文件头。 */
export type ActivityLevel = 'still' | 'light' | 'awake';

export const EPOCH_MS = 60_000;

export interface SmartWakeConfig {
  /** 目标唤醒时刻（毫秒）。窗口是 `[targetAt - windowMs, targetAt]`，闭区间左、含 targetAt。 */
  targetAt: number;
  /** 窗口长度（毫秒）。0 表示不使用智能唤醒，等于固定时刻。 */
  windowMs: number;
  /** 平滑窗口（epoch 数）。1 表示不平滑。 */
  smoothEpochs: number;
  /** 平滑后 ≤ 此值算「安静」。 */
  stillMax: number;
  /** 平滑后 ≤ 此值（且 > stillMax）算「有动静」；超过则算「在动」。 */
  lightMax: number;
  /**
   * 连续多少个 epoch 落在「有动静」档才算一次可用的唤醒时机。
   * 这是**去抖**：单点噪声不该把人叫醒。
   */
  minConsecutiveLight: number;
}

export const DEFAULT_SMART_WAKE: Omit<SmartWakeConfig, 'targetAt' | 'windowMs'> = {
  smoothEpochs: 5,
  stillMax: 20,
  lightMax: 120,
  minConsecutiveLight: 2,
};

/** 判定结果。`null` 的 `fireAt` 表示「没找到合适时机」——**这是一个设计好的状态**。 */
export interface WakeDecision {
  /** 决定的唤醒时刻；`null` 表示应退回目标时刻（即 `targetAt`）。 */
  fireAt: number | null;
  /** 为什么是这个结果——用于断言与调试，也用于将来在界面上解释。 */
  reason:
    | 'no-data'            // 没有任何样本
    | 'window-empty'       // 窗口内没有样本
    | 'found-light'        // 找到连续「有动静」的运行段
    | 'no-light-in-window' // 窗口内有数据但全是安静或在动
    | 'window-disabled';   // windowMs <= 0
  /** 实际生效的唤醒时刻：`fireAt ?? targetAt`。 */
  effectiveAt: number;
}

/**
 * 滚动平均。返回与输入等长的数组；第 i 项是**以 i 结尾**的最近 `n` 项均值。
 *
 * 注意是「以 i 结尾」而不是「以 i 为中心」：中心平均需要未来的样本，
 * 那在实时判定里意味着延迟 `n/2` 个 epoch 才知道答案。
 * 唤醒是一个实时决策，宁可滞后也不要预知未来。
 */
export function smoothActivity(samples: ActivitySample[], n: number): number[] {
  const k = Math.max(1, Math.floor(n));
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]!.count;
    if (i >= k) sum -= samples[i - k]!.count;
    out.push(sum / Math.min(k, i + 1));
  }
  return out;
}

/** 按阈值分档。纯函数，边界取闭区间（`<=`）。 */
export function classifyLevel(smoothed: number[], cfg: Pick<SmartWakeConfig, 'stillMax' | 'lightMax'>): ActivityLevel[] {
  return smoothed.map((v) => (v <= cfg.stillMax ? 'still' : v <= cfg.lightMax ? 'light' : 'awake'));
}

/**
 * 找出第一个长度 ≥ `minRun` 的**连续满足 `match`** 的运行段，返回其**起点下标**。
 *
 * 取起点而不是终点：运行段的起点就是「刚开始动」的时刻，
 * 此时人最接近可唤醒状态；等到终点，动势可能已经过去了。
 *
 * `match` 用谓词而不是单个档位：判定条件是「不安静」，
 * 而「不安静」包含 `light` 与 `awake` 两档，写死一个档位会漏掉一半情况。
 */
export function firstRunStart(
  levels: ActivityLevel[],
  minRun: number,
  match: (level: ActivityLevel) => boolean,
  from = 0
): number | null {
  const need = Math.max(1, Math.floor(minRun));
  let run = 0;
  for (let i = from; i < levels.length; i++) {
    if (match(levels[i]!)) {
      run++;
      if (run >= need) return i - need + 1;
    } else {
      run = 0;
    }
  }
  return null;
}

/**
 * 「不安静」= 有动静 或 在动。
 *
 * ★ 为什么 `awake` 也算：一个人明显在动的时候，**他已经不在沉睡里了**。
 * 这时叫醒的代价远小于从沉睡里把人拽出来。
 * 如果窗口里只有 `awake` 没有 `light`（比如他一直在翻身），
 * 只认 `light` 会导致「明明有更容易醒的时刻，却偏偏按原时间叫」——比不做智能唤醒更差。
 */
export const isNotStill = (level: ActivityLevel): boolean => level !== 'still';

/**
 * 决定唤醒时刻。
 *
 * 语义（每一条都有断言）：
 * - `windowMs <= 0` → 不用智能唤醒，`effectiveAt = targetAt`
 * - 没有任何样本 → 退回 `targetAt`（**绝不因为没数据就不叫醒**）
 * - 只在 `[targetAt - windowMs, targetAt]` 内找时机
 * - **只会提前，不会推后**：`effectiveAt <= targetAt` 恒成立
 * - 找不到合适时机 → 退回 `targetAt`，而不是「再等等」
 *
 * 「找不到就按原时间叫醒」是这个函数最重要的性质：
 * 智能唤醒是**锦上添花**，不能变成「闹钟有时候不响」。
 */
export function decideWake(samples: ActivitySample[], cfg: SmartWakeConfig): WakeDecision {
  const { targetAt, windowMs } = cfg;
  if (!(windowMs > 0)) {
    return { fireAt: null, reason: 'window-disabled', effectiveAt: targetAt };
  }
  if (samples.length === 0) {
    return { fireAt: null, reason: 'no-data', effectiveAt: targetAt };
  }

  const windowStart = targetAt - windowMs;
  // 窗口内、且按时间升序。调用方给的顺序不保证，这里自己排。
  const inWindow = samples
    .filter((s) => s.t >= windowStart && s.t <= targetAt)
    .slice()
    .sort((a, b) => a.t - b.t);

  if (inWindow.length === 0) {
    return { fireAt: null, reason: 'window-empty', effectiveAt: targetAt };
  }

  const smoothed = smoothActivity(inWindow, cfg.smoothEpochs);
  const levels = classifyLevel(smoothed, cfg);
  const idx = firstRunStart(levels, cfg.minConsecutiveLight, isNotStill);

  if (idx === null) {
    return { fireAt: null, reason: 'no-light-in-window', effectiveAt: targetAt };
  }

  // 夹紧一次，作为兜底：即使将来窗口过滤条件被改坏，也不会给出窗口外的时刻。
  const fireAt = Math.min(targetAt, Math.max(windowStart, inWindow[idx]!.t));
  return { fireAt, reason: 'found-light', effectiveAt: fireAt };
}

/**
 * ★ 界面必须原样呈现的说明。**不要改写这段文字**——
 * 它是「智能唤醒」这个功能对自己能力边界的声明，删掉它就变成了一句空承诺。
 */
export const SMART_WAKE_DISCLOSURE = {
  /** 徽标旁边的一行短说明。 */
  short: '仅在 App 运行期间生效',
  /** 展开后的完整说明。 */
  full:
    '手机靠加速度计判断「动得多不多」，它测不到脑电，因此**分不出浅睡和深睡**——' +
    '只能说「现在有动静」。消费级设备用这种方式挑唤醒时机的准确率并不高，' +
    '所以它只是**尽量**挑一个你比较容易醒的时刻，不保证正好在浅睡。' +
    '窗口内找不到合适时机，就按你设的时间照常叫醒。',
} as const;

// ─────────────────────────────────────────────────────────────
// 换成正式活动记录算法（Cole-Kripke / Sadeh）时需要做的事
//
// 1. **先拿到论文原文的权重与缩放因子**。本仓库没有引用系统，
//    凭记忆写一串系数再标上作者名字，是无法被反向验证的声明。
// 2. 只替换 `classifyLevel`（活动 → 档位），其余函数与所有断言不动。
// 3. 正式权重需要**前后各几个 epoch 的上下文**；`smoothActivity` 是
//    「以 i 结尾」的单侧平均，改成双侧时要注意实时性会滞后，
//    唤醒窗口的边界语义要重新断言一遍。
// 4. Sadeh 算法对 epoch 长度（通常 1 分钟）与计数单位敏感：
//    换算法时 `EPOCH_MS` 与原生采样率必须一起改，并重新标定阈值。
// ─────────────────────────────────────────────────────────────
