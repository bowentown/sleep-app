/**
 * 大肥鱼桌宠悬浮窗：Web 侧只负责开关、"播报词库"与"状态枚举"推送。
 *
 * 数据边界是刻意的：睡眠记录仍只存在 WebView 的 localStorage，原生侧一行也读不到、
 * 也不需要。快照 = 傲娇播报词库（\n 分隔）+ 播报频率 + **时段** + **情绪**。
 *
 * ★ 为什么时段与情绪也由 Web 侧算：
 * 原来的注释说"原生只读这几行字符串，不解析任何业务数据"——这条边界要保住。
 * 所以原生拿到的不是睡眠数据，而是**已经决定好的枚举**（`dawn`/`noon`/`night`…），
 * 它只负责把枚举映射成精灵图。加一个时段不需要动原生逻辑。
 *
 * 人设：DeepSeek 蓝色大肥鱼（社区共创）——聪明但懒、傲娇嘴甜、管用户叫"鱼片"、
 * 把 token 当白饭吃、被叫胖会急。语气参考 dsh-plugin-moments 的人设文档。
 */
import type { SleepRecord, UserProfile } from '../types/sleep';
import { computeSleepDebt, describeWeekExtreme } from './sleepInsights';
import { computeFindings } from './sleepFindings';
import { pickSticker } from './petStickers';

function gemma(): any | null {
  try {
    const cap = (window as any).Capacitor;
    return cap?.isNativePlatform?.() ? (cap.Plugins?.GemmaLLM ?? null) : null;
  } catch {
    return null;
  }
}

export const isPetNative = (): boolean => gemma() != null;

const ENABLED_KEY = 'somnacare_pet_enabled';

/** 每 N 次点击大肥鱼自动播报一次，其余点击弹按钮。 */
export const BUBBLE_EVERY_KEY = 'somnacare_pet_bubble_every';
export const DEFAULT_BUBBLE_EVERY = 8;

export function getBubbleEvery(): number {
  try {
    const n = Number(localStorage.getItem(BUBBLE_EVERY_KEY));
    return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.round(n) : DEFAULT_BUBBLE_EVERY;
  } catch {
    return DEFAULT_BUBBLE_EVERY;
  }
}

export function setBubbleEvery(n: number): void {
  try {
    localStorage.setItem(BUBBLE_EVERY_KEY, String(Math.round(n)));
  } catch { /* ignore */ }
}

export function isPetEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function setEnabled(v: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
  } catch { /* ignore */ }
}

export async function petPermissionGranted(): Promise<boolean> {
  const g = gemma();
  if (!g) return false;
  try {
    const res = await g.petPermission();
    return !!res?.granted;
  } catch {
    return false;
  }
}

export async function petOpenPermissionSettings(): Promise<void> {
  const g = gemma();
  if (!g) return;
  try {
    await g.petOpenPermission();
  } catch {
    // 打不开授权页就静默失败，UI 上引导用户手动前往设置
  }
}

/** "HH:mm" → 距今分钟数（跨午夜按次日算）。 */
function minutesUntil(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  const target = Number(m[1]) * 60 + Number(m[2]);
  const cur = now.getHours() * 60 + now.getMinutes();
  return target >= cur ? target - cur : target + 1440 - cur;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}

/** 今晚是否已有记录（按 date 是否为今天判断）。 */
function tonightRecord(records: SleepRecord[], now: Date): SleepRecord | undefined {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return records.find((r) => r.date === today);
}

// ─────────────────────────────────────────────────────────────
// 时段与情绪：一天时间线的编排
//
// 原生侧原本只有 `h >= 23 || h < 6` 一个二分的「困倦」开关，
// 所以一天里只有 sleep 和 idle 两张图。这里把一天切成 6 段，
// 让鲸鱼娘跟着时间走（清晨刚醒 / 午后打盹 / 深夜困倦…）。
// ─────────────────────────────────────────────────────────────

/** 一天里的时段。原生侧映射到精灵图。 */
export type PetPhase = 'dawn' | 'day' | 'noon' | 'afternoon' | 'dusk' | 'night';

/**
 * 情绪。由**数据**决定，不由时间决定。
 *
 * 只给两个非中性值，且各有明确依据：
 *   • `low`  —— 最近一晚得分 < 60，或存在 `act` 级且 `measured` 的发现；
 *   • `good` —— 最近一晚得分 ≥ 80。
 * 因为「推演量不得下判断」这条已经写进 `Finding.provenance`，
 * 所以这里只对**用户直接录入**的得分与 `measured` 发现做情绪反应。
 */
// 顺序必须与 WhaleGirlView 的 MOOD_PLAIN/MOOD_GOOD/MOOD_LOW 一致，
// verify-pet.mts 会比对两边的书写顺序。改一边不改另一边就红。
export type PetMood = 'plain' | 'good' | 'low';

export function petPhaseOf(now: Date): PetPhase {
  const h = now.getHours();
  if (h >= 5 && h < 9) return 'dawn';
  if (h >= 9 && h < 13) return 'day';
  if (h >= 13 && h < 15) return 'noon';
  if (h >= 15 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'dusk';
  return 'night';
}

/** 时段的中文名，用于捎报词与护栏核对。 */
export const PET_PHASE_LABEL: Record<PetPhase, string> = {
  dawn: '清晨',
  day: '白天',
  noon: '午后',
  afternoon: '下午',
  dusk: '傍晚',
  night: '深夜',
};

export function petMoodOf(records: SleepRecord[], profile?: UserProfile): PetMood {
  const latest = records[0];
  if (!latest) return 'plain';
  if (latest.sleepScore >= 80) return 'good';
  if (latest.sleepScore < 60) return 'low';
  try {
    const act = computeFindings(records, profile).find(
      (f) => f.severity === 'act' && f.provenance === 'measured'
    );
    if (act) return 'low';
  } catch { /* 发现算不出来就当无情绪 */ }
  return 'plain';
}

/**
 * 由当前数据生成傲娇播报词库。没有的数据绝不编；
 * 每行一条，原生侧逐条轮播。
 *
 * ★ **五个区域各至少一条**，顺序刻意固定，并由 `tools/verify-pet.mts` 核对：
 *   睡眠 → 趋势 → AI 顾问 → 护眼 → 偏好
 * 这样"鲸鱼娘集成了五个区域"就不是一句宣传，而是可被门禁反查的事实。
 */
export function buildPetSayLines(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): string[] {
  const bedtime = profile?.targetBedtime ?? '23:30';
  const tonight = tonightRecord(records, now);
  const until = minutesUntil(bedtime, now);
  const phase = petPhaseOf(now);
  const say: string[] = [];

  // ── ① 睡眠：按时段开口 ──
  if (phase === 'night') {
    say.push('喂，鱼片！都几点了还不睡？本、本鱼才没担心你，只是明天有你好看。');
  } else if (phase === 'dusk') {
    say.push('哼，今晚也别指望本鱼催你睡……才怪，到点就给我上床！');
  } else if (phase === 'noon') {
    say.push('鱼片，午后眯十五分钟，效率翻倍——这可是本鱼的恩赐。');
  } else if (phase === 'dawn') {
    say.push('早啊鱼片。昨晚睡得怎么样？不许糊弄本鱼。');
  } else {
    say.push('本鱼盯着你呢。今天也给我好好过，晚上别熬夜。');
  }

  if (tonight) {
    say.push(`昨晚睡了 ${fmtDuration(tonight.durationMinutes)}，${tonight.sleepScore} 分。勉、勉强不算辜负本鱼的看守。`);
    if (tonight.sleepEfficiency >= 85) {
      say.push(`睡眠效率 ${tonight.sleepEfficiency}%？哼，算你识相，有按本鱼说的做嘛。`);
    }
    if (tonight.latencyMinutes >= 30) {
      say.push(`躺了 ${fmtDuration(tonight.latencyMinutes)} 才睡着？你是不是又躲被窝里玩手机了，鱼片！`);
    }
    if (tonight.awakeMinutes >= 30) {
      say.push('半夜醒那么多次……记住，睡前少喝水！本鱼可绕不了你。');
    }
  } else if (until != null && until > 0 && (phase === 'dusk' || phase === 'night')) {
    if (until <= 60) {
      say.push(`${until} 分钟后就到 ${bedtime} 了！放下手机！这是命令……类的。`);
    } else {
      say.push(`还有 ${fmtDuration(until)} 就到 ${bedtime} 了。事已至此，先睡觉吧！`);
    }
  } else if (records.length === 0) {
    say.push('一次睡眠记录都没有，本鱼管谁去？喂，今晚给我按开始！');
  }

  // ── ② 趋势：只在样本够的时候说（`describeWeekExtreme` 要求 ≥3 晚）──
  // 少于 3 晚绝不说趋势，否则就是拿两晚编规律。
  if (records.length >= 3) {
    const debt = computeSleepDebt(records.slice(0, 7), (profile?.targetDurationHours ?? 8) * 60);
    if (Math.abs(debt.netMinutes) >= 60) {
      say.push(
        debt.netMinutes > 0
          ? `这 ${debt.days} 晚净欠 ${fmtDuration(debt.netMinutes)}……本鱼都替你心疼。今晚早点躺！`
          : `这 ${debt.days} 晚居然净多睡了 ${fmtDuration(-debt.netMinutes)}？哼，别得意，规律比多睡重要。`
      );
    }
    if (tonight) {
      const extreme = describeWeekExtreme(tonight, records.slice(0, 7));
      if (extreme === '本周最佳') say.push('昨晚是这一周里最好的一晚。本鱼准你得意一下。');
      if (extreme === '本周最差') say.push('昨晚是这一周里最差的一晚……不许糊弄，今晚给我补回来。');
    }
  } else {
    say.push('记录还太少，本鱼不瞎编趋势。再攒几晚，我再给你算。');
  }

  // ── ③ AI 顾问：把已经算好的发现转述一句，并带上它的来源 ──
  // `provenance` 必须一起说出来：推演出来的指标不能冒充实测。
  let topFinding: string | null = null;
  try {
    const found = computeFindings(records, profile);
    const top = found.find((f) => f.severity === 'act') ?? found.find((f) => f.severity === 'watch') ?? found[0];
    if (top) {
      topFinding =
        top.provenance === 'modeled'
          ? `AI 那边提到「${top.metric} ${top.value}」，不过这是推演值，别当体检报告。`
          : `AI 那边说了：${top.metric} ${top.value}（${top.reference}）。本鱼替你记着了。`;
    }
  } catch { /* 算不出就不说 */ }
  say.push(topFinding ?? '想听正经建议就去「AI 顾问」页问一句，本鱼只负责提醒你别糊弄自己。');

  // ── ④ 护眼 ──
  say.push('天黑了就把护眼滤镜点上……本鱼才不会替你按，按钮就在那儿！');

  // ── ⑤ 偏好：人设与目标就寝 ──
  say.push('陪睡服务可是很费 token 的哦。今晚加两碗白饭，不过分吧？');
  say.push(`你的目标就寝是 ${bedtime}。别忘了你亲口跟本鱼保证过的。`);
  say.push('我去睡了，明早起来应该就……喂！要去睡的是你！');

  return say;
}

/** 原生侧需要的完整快照。 */
export interface PetSnapshot {
  say: string;
  bubbleEvery: number;
  phase: PetPhase;
  mood: PetMood;
  /** 气泡旁的表情贴图文件名（不含扩展名）。原生只按名取图，不认识语义。 */
  sticker: string;
}

export function buildPetSnapshot(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): PetSnapshot {
  const phase = petPhaseOf(now);
  const mood = petMoodOf(records, profile);
  // 就寝到点 15 分钟内算"在提醒"，这时用瞪眼那张。
  const until = minutesUntil(profile?.targetBedtime ?? '23:30', now);
  const alerting =
    until != null && until <= 15 && (phase === 'dusk' || phase === 'night');
  return {
    say: buildPetSayLines(records, profile, now).join('\n'),
    bubbleEvery: getBubbleEvery(),
    phase,
    mood,
    sticker: pickSticker(phase, mood, alerting).file,
  };
}

/** 启动桌宠（幂等：已运行则只刷新词库）。 */
export async function startPet(
  records: SleepRecord[],
  profile: UserProfile,
): Promise<{ ok: boolean; needPermission?: boolean }> {
  const g = gemma();
  if (!g) return { ok: false };
  const payload = buildPetSnapshot(records, profile);
  try {
    if (isPetEnabled()) await g.petSync(payload);
    else await g.petStart(payload);
    setEnabled(true);
    return { ok: true };
  } catch (e: any) {
    if (String(e?.message ?? e).includes('OVERLAY_PERMISSION_REQUIRED')) {
      setEnabled(false);
      return { ok: false, needPermission: true };
    }
    setEnabled(false);
    return { ok: false };
  }
}

/** 只刷新词库与状态，不改变开关状态。 */
export async function syncPet(
  records: SleepRecord[],
  profile: UserProfile,
): Promise<void> {
  const g = gemma();
  if (!g || !isPetEnabled()) return;
  try {
    await g.petSync(buildPetSnapshot(records, profile));
  } catch { /* 桌宠没开或服务已停，忽略 */ }
}

export async function stopPet(): Promise<void> {
  const g = gemma();
  if (!g) return;
  try {
    await g.petStop();
  } catch { /* ignore */ }
  setEnabled(false);
}

/**
 * 读取桌宠写入的"目标分区"并清除。
 *
 * ★ 这里原先写着「预留入口，当前按钮不跳转」——**那条注释已经过期**：
 * `App.tsx` 早已在 `visibilitychange` 时消费它并切分区。
 */
export async function consumePendingTab(): Promise<string | null> {
  const g = gemma();
  if (!g) return null;
  try {
    const res = await g.petConsumePendingTab();
    const tab = res?.tab;
    return typeof tab === 'string' && tab ? tab : null;
  } catch {
    return null;
  }
}
