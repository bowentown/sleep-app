/**
 * 大肥鱼桌宠悬浮窗：素材契约 + 五区域覆盖 + 三方一致性。
 *
 * 这一层存在的理由：桌宠是本仓库里**唯一一块镜像两套东西**的功能——
 * 同一批素材在 Web（`public/`）和 Android（`assets/`）各存一份，
 * 同一套枚举在 TS 和 Java 各写一遍，同一批表情在代码、素材目录、
 * 两份 NOTICE 里各记一次。四对镜像，每一对都能悄悄分叉。
 *
 * 所以这里查的不是"逻辑对不对"，而是**四方是否还在说同一件事**。
 *
 * ★ 本仓库没有 `android/` 工程，Java 编译不了。所以以下都是**静态**核对：
 * 帧数用 PNG 宽度反推（单帧 256×256、横向等分），不信任任何声明。
 * 真正编译验证要靠 APK 构建环境，这一点写在 design-review 的原生契约里。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// 不能用 `new URL('..', import.meta.url).pathname`：工作目录含中文时
// pathname 会做百分号编码（%E7%AC%AC…），路径就找不到了。
import { fileURLToPath } from 'node:url';
import { buildPetSayLines, PET_PHASE_LABEL } from '../src/utils/petOverlay.js';
import { PET_STICKERS, STICKER_FILE_RE, pickSticker } from '../src/utils/petStickers.js';
import type { PetPhase, PetMood } from '../src/utils/petOverlay.js';
import type { SleepRecord, UserProfile } from '../src/types/sleep.js';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ───────────────────────── 工具

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PET_DIR = join(ROOT, 'plugins/cap-gemma-llm/android/src/main/assets/pet');
const STICKER_NATIVE = join(PET_DIR, 'stickers');
const STICKER_WEB = join(ROOT, 'public/pet-stickers');
const JAVA = join(ROOT, 'plugins/cap-gemma-llm/android/src/main/java/com/somnacare/gemmallm');

/** 去掉注释，避免"检查匹配到解释这条检查的注释"——本仓库栽过 7 次。 */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

const read = (p: string): string => readFileSync(p, 'utf8');
/** 默认去注释；要看注释必须显式用 raw()。 */
const readStripped = (p: string): string => stripComments(read(p));
const raw = (p: string): string => readFileSync(p, 'utf8');

/**
 * 只读 PNG 头部拿宽高（IHDR 在固定偏移）。
 * 不引第三方库：这里只需要宽高两个整数，为此装个依赖不值得。
 */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // 签名 8 字节 + 长度 4 + "IHDR" 4 = 16，随后 width(4) height(4)
  if (buf.readUInt32BE(12) !== 0x49484452) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 从 `load(c, "name", frames, fps, "playback", "motion")` 抽出声明。 */
export interface SpriteDecl {
  name: string;
  frames: number;
  fps: number;
  playback: string;
  motion: string | null;
}

export function parseSpriteDecls(java: string): SpriteDecl[] {
  const out: SpriteDecl[] = [];
  const re = /load\(\s*c\s*,\s*"([a-z0-9_]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([a-z]+)"\s*,\s*(null|"[a-z]+")\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(java)) !== null) {
    out.push({
      name: m[1]!,
      frames: Number(m[2]),
      fps: Number(m[3]),
      playback: m[4]!,
      motion: m[5] === 'null' ? null : m[5]!.slice(1, -1),
    });
  }
  return out;
}

/**
 * NOTICE 表格里列出的状态/文件名（首列）。
 *
 * 两个坑：
 *   • 分隔行 `| --- | --- |` 的首列是 `---`，也在 `[a-z0-9_-]` 里，会被当成数据；
 *   • 文件名可能被反引号包着（`` `deepsleep.webp` ``）。
 * 两者都会让"表行数 == 文件数"这条核对**因为错误的原因通过或失败**。
 */
export function noticeRows(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!/^\|/.test(t)) continue;
    const m = /^\|\s*`?([A-Za-z0-9_.\-]+)`?\s*\|/.exec(t);
    if (!m) continue;
    const cell = m[1]!;
    if (/^-+$/.test(cell)) continue;        // 分隔行
    out.push(cell);
  }
  return out;
}

/** 从 TS 的多行联合类型里取出成员，保持书写顺序。 */
export function unionMembers(src: string, typeName: string): string[] {
  const m = new RegExp(`export type ${typeName}\\s*=([^;]+);`).exec(src);
  if (!m) return [];
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

/** Java 里 `public static final int NAME = 0, NAME2 = 1;` 按值排序后的名字。 */
export function javaEnumOrder(java: string, prefix: string): string[] {
  const pairs: { name: string; value: number }[] = [];
  const re = new RegExp(`\\b${prefix}[A-Z]+\\s*=\\s*(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(java)) !== null) {
    pairs.push({ name: m[0].split('=')[0]!.trim(), value: Number(m[1]) });
  }
  return pairs.sort((a, b) => a.value - b.value).map((p) => p.name);
}

// ───────────────────────── 自检
//
// 教训：只自检工具函数、不自检"扫一遍真实文件"的那条路，等于没自检。
// 所以这里既测解析器，也测一个真实的端到端输入。

check('自检·stripComments 去掉整行注释',
  !stripComments('// 同步心肺\nconst a = 1;').includes('同步心肺'));
check('自检·stripComments 去掉行尾注释',
  !stripComments('const a = 1; // 保持透明\n').includes('保持透明'));
check('自检·stripComments 保留 ://',
  stripComments('const u = "https://x.dev";').includes('://'));

const selfPng = readFileSync(join(PET_DIR, 'idle.png'));
const selfSize = pngSize(selfPng);
check('自检·pngSize 读得出真实 PNG',
  selfSize !== null && selfSize.width === 768 && selfSize.height === 256,
  JSON.stringify(selfSize));
check('自检·pngSize 对垃圾字节返回 null', pngSize(Buffer.from('not a png at all........')) === null);

check('自检·parseSpriteDecls 抓得到多参调用',
  parseSpriteDecls('load(c, "error", 2, 8, "once", "shake");').length === 1 &&
  parseSpriteDecls('load(c, "error", 2, 8, "once", "shake");')[0]!.motion === 'shake');
check('自检·parseSpriteDecls 对 null motion 给 null',
  parseSpriteDecls('load(c, "idle", 3, 2, "blink", null);')[0]!.motion === null);

check('自检·noticeRows 只认表格首列',
  noticeRows('| idle | 3 |\n| 说明 | 不是状态 |').join(',') === 'idle',
  noticeRows('| idle | 3 |\n| 说明 | 不是状态 |').join(','));

check('自检·unionMembers 保持书写顺序',
  unionMembers("export type T = 'b' | 'a';", 'T').join(',') === 'b,a');
check('自检·javaEnumOrder 按值排序',
  javaEnumOrder('static final int P_B = 1, P_A = 0;', 'P_').join(',') === 'P_A,P_B');

// ───────────────────────── ① 精灵图契约：声明 vs 图片尺寸

// 三个 Java 文件的源码都先读出来。
// ★ 必须**在使用之前**声明：第一版把 service 放在了第 ⑤ 节，
// 而第 ④ 节就用到了它，于是 TDZ 崩溃（Cannot access 'service' before initialization）。
// 和验证脚本之前栽过的 ORPHAN_KNOWN 是同一类错误。
const whale = readStripped(join(JAVA, 'WhaleGirlView.java'));
const service = readStripped(join(JAVA, 'PetOverlayService.java'));
const decls = parseSpriteDecls(whale);
check('精灵图声明解析到 22 条', decls.length === 22, `实际 ${decls.length}`);

const pngs = readdirSync(PET_DIR).filter((f) => f.endsWith('.png'));
check('pet/ 下有 22 张 PNG', pngs.length === 22, `实际 ${pngs.length}`);

for (const d of decls) {
  const file = join(PET_DIR, `${d.name}.png`);
  if (!existsSync(file)) {
    check(`精灵图存在·${d.name}`, false, '文件缺失');
    continue;
  }
  const size = pngSize(readFileSync(file))!;
  check(`精灵图高度契约·${d.name}`, size.height === 256, `实测 ${size.height}`);
  check(`精灵图宽度可等分·${d.name}`, size.width % 256 === 0, `实测 ${size.width}`);
  const measured = size.width / 256;
  // 这一条是核心：**帧数不信任声明，用图片宽度反推**。
  check(`帧数与图片宽度一致·${d.name}`, measured === d.frames,
    `声明 ${d.frames} 帧 / 实测 ${measured} 帧`);
}

// 反向：目录里不许有没被加载的图（闲置素材白占 APK）
const loaded = new Set(decls.map((d) => d.name));
const unused = pngs.map((f) => f.replace(/\.png$/, '')).filter((n) => !loaded.has(n));
check('无闲置精灵图', unused.length === 0, `未被加载: ${unused.join(', ')}`);

// ───────────────────────── ② 精灵图 NOTICE 与实际分发一致

const petNotice = raw(join(PET_DIR, 'NOTICE.md'));
const petRows = noticeRows(petNotice).map((r) => r.replace(/\.png$/, ''));
check('精灵图 NOTICE 表格行数 == PNG 数', petRows.length === pngs.length,
  `NOTICE ${petRows.length} 行 / 目录 ${pngs.length} 张`);
check('精灵图 NOTICE 逐张列出且无多余行',
  petRows.slice().sort().join(',') === pngs.map((f) => f.replace(/\.png$/, '')).sort().join(','));

// 签名链不能丢——这是这批素材唯一的授权依据
for (const who of ['上善无形', 'ZipZipPipe', 'vlln', 'Henryang777']) {
  check(`精灵图 NOTICE 含署名·${who}`, petNotice.includes(who));
}
check('精灵图 NOTICE 写明非商业限制', petNotice.includes('禁止商业性使用'));

// ───────────────────────── ③ 贴图三方一致

const webStickers = readdirSync(STICKER_WEB).filter((f) => f.endsWith('.webp')).sort();
const nativeStickers = readdirSync(STICKER_NATIVE).filter((f) => f.endsWith('.webp')).sort();
const catalogFiles = PET_STICKERS.map((s) => `${s.file}.webp`).sort();

check('Web 贴图与 TS 目录一致', webStickers.join(',') === catalogFiles.join(','),
  `web ${webStickers.length} / 目录 ${catalogFiles.length}`);
check('原生贴图与 TS 目录一致', nativeStickers.join(',') === catalogFiles.join(','));

// 两份必须是同一批字节：允许"各自压缩"，但绝不允许悄悄换图
let byteDiff: string[] = [];
for (const f of webStickers) {
  const a = readFileSync(join(STICKER_WEB, f));
  const bf = join(STICKER_NATIVE, f);
  if (!existsSync(bf)) { byteDiff.push(`${f}:原生缺失`); continue; }
  if (!a.equals(readFileSync(bf))) byteDiff.push(`${f}:字节不同`);
}
check('Web 与原生贴图字节完全一致', byteDiff.length === 0, byteDiff.join('; '));

// 贴图体积上限：避免有人"顺手"把 29MB 原图拷进来
let stickerBytes = 0;
for (const f of webStickers) stickerBytes += statSync(join(STICKER_WEB, f)).size;
check('贴图合计 < 400KB', stickerBytes < 400 * 1024, `实际 ${(stickerBytes / 1024).toFixed(0)}KB`);

check('贴图文件名都满足白名单', PET_STICKERS.every((s) => STICKER_FILE_RE.test(s.file)),
  PET_STICKERS.filter((s) => !STICKER_FILE_RE.test(s.file)).map((s) => s.file).join(','));
check('贴图 sourceIndex 唯一', new Set(PET_STICKERS.map((s) => s.sourceIndex)).size === PET_STICKERS.length);

const stickerNotice = raw(join(STICKER_NATIVE, 'NOTICE.md'));
const stickerRows = noticeRows(stickerNotice).map((r) => r.replace(/\.webp$/, ''));
check('贴图 NOTICE 行数 == 贴图数', stickerRows.length === PET_STICKERS.length,
  `NOTICE ${stickerRows.length} / 目录 ${PET_STICKERS.length}`);
check('贴图 NOTICE 逐张列出且无多余行',
  stickerRows.slice().sort().join(',') === PET_STICKERS.map((s) => s.file).sort().join(','),
  `NOTICE [${stickerRows.slice().sort().join(',')}]`);
for (const who of ['上善无形', 'ZipZipPipe', 'EDMOK']) {
  check(`贴图 NOTICE 含署名·${who}`, stickerNotice.includes(who));
}
check('贴图 NOTICE 写明非商业限制', stickerNotice.includes('禁止商业性使用'));
check('贴图 NOTICE 说明为何不是全量', /为什么不全带上|不是 205 张全量/.test(stickerNotice));

// ───────────────────────── ④ 枚举顺序 TS ↔ Java

const overlaySrc = readStripped(join(ROOT, 'src/utils/petOverlay.ts'));
const tsPhases = unionMembers(overlaySrc, 'PetPhase');
const tsMoods = unionMembers(overlaySrc, 'PetMood');
check('TS 侧时段比 java 少写了 0 个', tsPhases.length === 6, `实际 ${tsPhases.length}`);
check('TS 侧情绪 3 个', tsMoods.length === 3, `实际 ${tsMoods.length}`);

const javaPhaseOrder = javaEnumOrder(whale, 'PHASE_').map((n) => n.replace('PHASE_', '').toLowerCase());
const javaMoodOrder = javaEnumOrder(whale, 'MOOD_').map((n) => n.replace('MOOD_', '').toLowerCase());

// 这一条是本文件最有价值的一条：TS 与 Java 各写一遍的枚举，
// 顺序错位会让"清晨"显示成"深夜"，而且**任何一侧单独看都是对的**。
check('时段枚举顺序 TS == Java', tsPhases.join(',') === javaPhaseOrder.join(','),
  `TS [${tsPhases.join(',')}] / Java [${javaPhaseOrder.join(',')}]`);
check('情绪枚举顺序 TS == Java', tsMoods.join(',') === javaMoodOrder.join(','),
  `TS [${tsMoods.join(',')}] / Java [${javaMoodOrder.join(',')}]`);
check('PET_PHASE_LABEL 覆盖全部时段', tsPhases.every((p) => p in PET_PHASE_LABEL));
// 映射写的是 `if ("dawn".equals(s)) return WhaleGirlView.PHASE_DAWN;`，
// 正则必须把 `.equals(s))` 整段吃掉——第一版漏了它，于是"缺 6 个映射"是误报。
check('时段的 Java 映射无遗漏',
  tsPhases.every((p) =>
    new RegExp(`"${p}"\\.equals\\(s\\)\\)\\s*return\\s+WhaleGirlView\\.PHASE_`).test(service)));

// ───────────────────────── ⑤ pickSticker 的取值全覆盖

const uses = new Set(PET_STICKERS.map((s) => s.use));
for (const u of ['always', 'sleepy', 'happy', 'low', 'alert', 'day'] as const) {
  // pickSticker 会去找每一类；某类在目录里缺失就会静默降级到 always
  if (u === 'always') continue;
  check(`pickSticker 的 ${u} 类有贴图`, uses.has(u), '目录里没有这一类');
}
// 穷举时段 × 情绪 × 提醒，确认一定拿得到一张目录内的贴图
const allPhases: PetPhase[] = ['dawn', 'day', 'noon', 'afternoon', 'dusk', 'night'];
const allMoods: PetMood[] = ['good', 'low', 'plain'];
let missing = 0;
const picked = new Set<string>();
for (const p of allPhases) {
  for (const m of allMoods) {
    for (const alerting of [false, true]) {
      const s = pickSticker(p, m, alerting);
      picked.add(s.file);
      if (!PET_STICKERS.some((c) => c.file === s.file)) missing++;
    }
  }
}
check('pickSticker 穷举 36 组都落在目录内', missing === 0, `${missing} 组越界`);
check('pickSticker 真的会用到多张（不是永远同一张）', picked.size >= 4,
  `只用到 ${picked.size} 张: ${[...picked].join(',')}`);

// ───────────────────────── ⑥ 五个区域覆盖（行为断言，不是注释断言）

const day = (n: number, min: number, score: number, extra: Partial<SleepRecord> = {}): SleepRecord =>
  ({
    date: `2025-01-${String(n).padStart(2, '0')}`,
    bedtime: '23:00',
    wakeTime: '07:00',
    durationMinutes: min,
    latencyMinutes: 15,
    awakeMinutes: 10,
    sleepEfficiency: 88,
    wakingMood: 'refreshed',
    sleepScore: score,
    stages: [],
    ...extra,
  } as unknown as SleepRecord);

const profile = {
  targetBedtime: '23:30',
  targetDurationHours: 8,
} as unknown as UserProfile;

// 就寝窗口内的傍晚：时段=dusk，且离目标就寝 <60 分钟 → 命中「偏好」倒计时分支
const nowDusk = new Date('2025-01-20T22:45:00');
// 深夜：命中「睡眠」的困倦问候
const nowNight = new Date('2025-01-20T02:00:00');

const rich = [day(20, 8 * 60, 52), day(19, 5 * 60, 61), day(18, 5 * 60, 70), day(17, 8 * 60, 90)];
const richSay = buildPetSayLines(rich, profile, nowDusk);
const emptySay = buildPetSayLines([], profile, nowNight);
const nightSay = buildPetSayLines(rich, profile, nowNight);

/**
 * 每个区域在文案里的"语义指纹"。
 *
 * 这里用指纹而不是行号：行号会随文案调整漂移，而"这个区域有没有开口"
 * 才是设置页那句「五个区域各至少一句」真正承诺的东西。
 */
const AREA_MARKERS: Record<string, RegExp> = {
  '睡眠': /昨晚睡了|本鱼盯着你|都几点了|午后眯|早啊鱼片|今晚也别指望|一次睡眠记录都没有/,
  '趋势': /净欠|净多睡|这一周|记录还太少/,
  'AI 顾问': /AI 那边|AI 顾问/,
  '护眼': /护眼滤镜/,
  '偏好': /目标就寝/,
};

const AREA_NAMES = Object.keys(AREA_MARKERS);
for (const [area, re] of Object.entries(AREA_MARKERS)) {
  check(`五区域覆盖·${area}`, richSay.some((l) => re.test(l)),
    `没找到含 ${re} 的一句`);
}
// 每个区域必须由**不同**的一句承担，否则一句话在冒充两个区域
const byArea = new Map<string, Set<number>>();
for (const [area, re] of Object.entries(AREA_MARKERS)) {
  byArea.set(area, new Set(richSay.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0)));
}
const firstLineOf = new Map<string, number>();
for (const [area, idxs] of byArea) firstLineOf.set(area, Math.min(...idxs));
check('五个区域分别由五句不同的话承担',
  new Set([...firstLineOf.values()]).size === AREA_NAMES.length,
  `去重后只有 ${new Set([...firstLineOf.values()]).size} 句`);

// 空数据时不许编造趋势，且 AI 区域必须给出去处
check('零记录时不说趋势', emptySay.some((l) => l.includes('记录还太少') || l.includes('一次睡眠记录都没有')));
check('零记录时不出现具体数字',
  !emptySay.some((l) => /净欠|这一周/.test(l)));
check('深夜问候命中', nightSay.some((l) => l.includes('都几点了')));

// 少于 3 晚绝不说趋势（describeWeekExtreme 要求 ≥3）
const twoNights = buildPetSayLines([day(20, 5 * 60, 55), day(19, 5 * 60, 60)], profile, nowDusk);
check('两晚样本不说趋势', twoNights.some((l) => l.includes('记录还太少')));
check('两晚样本不出现净欠', !twoNights.some((l) => l.includes('净欠')));

// ───────────────────────── ⑦ 界面承诺与门禁口径一致
//
// 设置页写着「五个区域各至少一句」。这句承诺必须和上面 AREA_MARKERS 的键**同一批词**，
// 否则改了 UI 文案而没改门禁，就成了一句没人核对的话。

const settings = readStripped(join(ROOT, 'src/components/SettingsTab.tsx'));
check('设置页声称了"五个区域各至少一句"', /五个区域各至少一句/.test(settings));
for (const area of AREA_NAMES) {
  check(`设置页提到了区域·${area}`, settings.includes(area.replace(' ', ' ')),
    `界面文案里没有「${area}」`);
}

// ───────────────────────── ⑧ 过时注释的回归护栏

// 原注释写「预留入口，当前按钮不跳转」，但 App.tsx 早已在消费 pendingTab。
//
// ★ 第一版这里查的是"源码里不许出现『当前按钮不跳转』"——结果匹配到的是
// **解释这次修改的注释本身**。这是本仓库第 8 次栽在"检查匹配到自己的注释"上。
// 改成正面断言：注释必须点出真实调用方。注释写错会被抓，写对不会被冤。
const overlayRaw = raw(join(ROOT, 'src/utils/petOverlay.ts'));
// 注释就在 `export async function consumePendingTab` **之前**，
// 所以 App.tsx 出现在它前面。第一版把方向写反了。
check('consumePendingTab 的注释点出真实调用方',
  /App\.tsx[\s\S]{0,900}?export async function consumePendingTab/.test(overlayRaw));

const appSrc = readStripped(join(ROOT, 'src/App.tsx'));
check('App.tsx 真的消费了 pendingTab', /consumePendingTab\(\)/.test(appSrc));
check('App.tsx 真的同步桌宠词库', /syncPet\(records,\s*userProfile\)/.test(appSrc));
check('App.tsx 监听 visibilitychange 补拉', /visibilitychange/.test(appSrc));

// ───────────────────────── ⑨ TAB_ORDER 与导航栏同一批分区
//
// 桌宠能把 App 拉起并跳到某个分区。跳过去的分区名若不在这张表里会被静默忽略，
// 于是"点了没反应"。所以这张表必须覆盖 NavTab 的全部成员。

const navSrc = readStripped(join(ROOT, 'src/components/BottomNavBar.tsx'));
const navTabs = unionMembers(navSrc, 'NavTab');
const appTabs = [.../TAB_ORDER:\s*NavTab\[\]\s*=\s*\[([^\]]+)\]/.exec(appSrc)![1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
check('TAB_ORDER 覆盖全部 NavTab', navTabs.slice().sort().join(',') === appTabs.slice().sort().join(','),
  `NavTab [${navTabs.join(',')}] / TAB_ORDER [${appTabs.join(',')}]`);

// ───────────────────────── ⑩ 原生侧的一次性播放与抖动真的实现了
//
// 上游 manifest 声明 error 是 `once` + `shake`。原实现只认 blink/pingpong、
// 只认 float/wiggle，于是声明为 once 的图会无限循环、声明为 shake 的图不抖——
// 典型的"配置声称了代码做不到的事"。这两条断言防止它被改回去。

check('frameIndex 处理 once', /if\s*\(\s*a\.once\s*\)/.test(whale));
check('onDraw 处理 shake', /a\.shakeMotion/.test(whale));
check('Anim 解析 once', /this\.once\s*=\s*"once"\.equals/.test(whale));
check('Anim 解析 shake', /this\.shakeMotion\s*=\s*"shake"\.equals/.test(whale));
// 原来这里写的是 `every(() => true)`——一条恒真的断言，等于没查。
// 换成有内容的核对：声明 once 的图，在 NOTICE 表里也必须记成 once。
const declaredOnce = decls.filter((d) => d.playback === 'once').map((d) => d.name).sort();
check('确实有一口气播完的图（否则 once 实现无人验证）', declaredOnce.length >= 1,
  declaredOnce.join(','));
for (const n of declaredOnce) {
  const row = new RegExp(`\\|\\s*${n}\\s*\\|[^\\n]*?\\|\\s*once\\s*\\|`).test(petNotice);
  check(`NOTICE 也把 ${n} 记成 once`, row);
}

// ───────────────────────── ⑪ 贴图路径穿越防护

check('原生侧贴图名有白名单校验', /matches\(\s*"\[a-z0-9_-\]\+"\s*\)/.test(service));
check('原生侧贴图取不到时静默跳过', /loadSticker[\s\S]{0,400}?return null;/.test(service));
check('气泡换词时也换贴图', /pet_sticker_view/.test(service));

// 参数个数：改了方法签名却漏掉某个调用点，编译器会报
// "method cannot be applied to given types"。
// CI 的 build-apk 任务能抓到，但本地先抓一次更省事——
// buildBubble 就是这么漏的（定义改成两参，showBubble 里那处仍写一参）。
const bubbleCalls = [...service.matchAll(/buildBubble\s*\(([^)]*)\)/g)]
  .map((m) => m[1]!.trim())
  .filter((args) => args !== '' && !args.startsWith('String '));
check('buildBubble 的调用点都传了两个参数',
  bubbleCalls.length > 0 && bubbleCalls.every((a) => a.split(',').length === 2),
  `实际调用: ${bubbleCalls.map((a) => `(${a})`).join(' ')}`);

// 定义与调用必须同名同参数个数（定义那处带类型声明，单独数一下）
const bubbleDefs = [...service.matchAll(/private\s+FrameLayout\s+buildBubble\s*\(([^)]*)\)/g)];
check('buildBubble 只定义一次', bubbleDefs.length === 1, `实际 ${bubbleDefs.length} 次`);
check('buildBubble 定义了两个形参',
  bubbleDefs.length === 1 && bubbleDefs[0]![1]!.split(',').length === 2,
  bubbleDefs[0]?.[1]);

// PetOverlayService 调用的 EyeCareService 方法必须真的存在。
// CI 抓到过 3 处 `EyeCareService.isActive()` —— 本仓的 EyeCareService 当时比上游旧，
// 整份替换后才有的。这类"跨文件方法不存在"本地也能先查。
const eyeSrc = readStripped(join(JAVA, 'EyeCareService.java'));
const eyeCalls = new Set(
  [...service.matchAll(/EyeCareService\.([a-zA-Z]+)\s*\(/g)].map((m) => m[1]!));
// ★ 这里原本用 new RegExp(`...\\s*\\(`) 拼正则，结果模板字符串把 `\s` 当转义
// 吃成了 `s`、`\(` 吃成了 `(`，正则直接语法错误。改成不含转义的 includes。
const eyeMissing = [...eyeCalls].filter((m) => !eyeSrc.includes(m + '('));
check('EyeCareService 的方法都存在', eyeMissing.length === 0,
  `缺失: ${eyeMissing.join(', ')}`);

// ───────────────────────── 结果

// ★ 输出格式必须与 tools/assertion-total.mjs 的锚点一致，否则总计脚本
// 会报"没解析到"（不是 0 项）。第一版少了全角括号，正是这个问题。
if (failures.length) {
  console.error(`\n❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✅ 桌宠悬浮窗（${pass} 项断言）全部通过`);
console.log(`   · 精灵图 ${decls.length} 张，帧数全部与图片宽度互相印证`);
console.log(`   · 贴图 ${PET_STICKERS.length} 张，Web/原生/目录/NOTICE 四方一致（${(stickerBytes / 1024).toFixed(0)}KB）`);
console.log(`   · 五个区域：${AREA_NAMES.join(' / ')}`);
process.exit(0);
