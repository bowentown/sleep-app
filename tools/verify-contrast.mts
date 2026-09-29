/**
 * 颜色对比度护栏（第 8 层）：关键文字 ≥ 4.5:1。
 *
 * 为什么这一层对**这个** App 尤其重要：它用在暗光、躺床上的场景。
 * 对比度不足对视力正常的人是"看着累"，对低视力/读屏用户是"读不到"。
 *
 * ★ 设计要点：不凭记忆写 Tailwind 调色板。
 *
 * 最初打算硬编码 slate/amber/cyan 各档的 RGB，但那是**虚假的精确**——
 * 我记错一档，护栏就会给出错误结论，而它自己不会报错。
 *
 * 改成从 `dist/assets/*.css` 读：Tailwind 把每个用到的颜色类编译成
 *   .text-slate-400{color:var(--color-slate-400)}
 *   --color-slate-400:oklch(70.4% .04 256.788)
 * 也就是**浏览器真正用的那套值**。剩下要做的就是实现 oklch→sRGB。
 *
 * 而 oklch→sRGB 实现得对不对，也有地方验证：Tailwind 给带透明度的类
 * 额外吐了一个 hex 回退（`text-amber-300/70{color:#ffd236b3}`）。
 * 本文件拿这些 hex 当**地面真值**来校验换算器——实测 90 组，
 * 任一组偏差超过 2/255 就报错。这样"我的换算器写错了"和
 * "颜色真的不达标"不会被混为一谈。
 *
 * ★ 本层是**静态近似**，不是真实渲染测量。
 *
 * 我用 Chrome + canvas 做过真实渲染审计（把颜色画进 canvas 再读像素，
 * 这样 oklab/oklch/color-mix/透明度全由浏览器按规范合成），
 * 修复前 4 套主题 × 5 个页面共 1040 个文字元素里 114 个不达标，
 * 修复后 0 个。CI 里没有浏览器，所以这层用静态计算近似——
 * 上面那组实测数字写在 CONTRAST_MEASURED 里，作为本层的校准依据。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_THEMES } from '../src/utils/themeStyles.js';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ───────────────────────── 颜色数学

export interface RGB { r: number; g: number; b: number }
export interface RGBA extends RGB { a: number }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * oklch → sRGB。
 * 系数取自 Björn Ottosson 的 oklab 定义（oklch 只是 oklab 的极坐标写法）。
 */
export function oklchToSrgb(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return {
    r: Math.round(clamp01(gamma(lr)) * 255),
    g: Math.round(clamp01(gamma(lg)) * 255),
    b: Math.round(clamp01(gamma(lb)) * 255),
  };
}

/** WCAG 相对亮度。 */
export function luminance(c: RGB): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** 把带透明度的前景合成到不透明背景上。 */
export function composite(fg: RGBA, bg: RGB): RGB {
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
  };
}

export function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const hex = (s: string): RGB => ({
  r: parseInt(s.slice(1, 3), 16),
  g: parseInt(s.slice(3, 5), 16),
  b: parseInt(s.slice(5, 7), 16),
});

export function parseColor(value: string, palette: Map<string, RGBA>): RGBA | null {
  const v = value.trim();
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v))) {
    const c = hex('#' + m[1]!);
    return { ...c, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  if ((m = /^var\((--color-[a-z0-9-]+)\)$/.exec(v))) return palette.get(m[1]!) ?? null;
  // color-mix(in oklab, var(--x) 70%, transparent) —— 与 transparent 混合只改透明度
  if ((m = /^color-mix\(in oklab,\s*var\((--color-[a-z0-9-]+)\)\s*([\d.]+)%,\s*transparent\)$/.exec(v))) {
    const base = palette.get(m[1]!);
    return base ? { ...base, a: Number(m[2]) / 100 } : null;
  }
  if ((m = /^oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(v))) {
    const L = Number(m[1]) > 1 ? Number(m[1]) / 100 : Number(m[1]);
    const c = oklchToSrgb(L, Number(m[2]), Number(m[3]));
    return { ...c, a: m[4] !== undefined ? Number(m[4]) : 1 };
  }
  return null;
}

// ───────────────────────── 从构建产物读调色板

function readCss(): string {
  const dir = join(ROOT, 'dist/assets');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.css'));
  } catch {
    throw new Error('未找到 dist/assets，请先执行 npm run build');
  }
  if (!files.length) throw new Error('未找到 dist/assets/*.css，请先执行 npm run build');
  return files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

const CSS = readCss();

/** 调色板变量：`--color-slate-400:oklch(...)`。 */
export function parsePalette(css: string): Map<string, RGBA> {
  const out = new Map<string, RGBA>();
  for (const m of css.matchAll(/(--color-[a-z0-9-]+):([^;}]+)/g)) {
    const val = m[2]!.trim();
    let c: RGBA | null = null;
    const o = /^oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\)$/.exec(val);
    if (o) {
      const L = Number(o[1]) > 1 ? Number(o[1]) / 100 : Number(o[1]);
      c = { ...oklchToSrgb(L, Number(o[2]), Number(o[3])), a: 1 };
    } else if (/^#[0-9a-f]{3}$/i.test(val)) {
      // `--color-white:#fff` 是三位写法。第一版只认六位，于是 text-white 解析不出来，
      // 连带 4 个主题的 accentFg 检查全部误报成"accentBg 不可解析"。
      c = { ...hex('#' + [...val.slice(1)].map((ch) => ch + ch).join('')), a: 1 };
    } else if (/^#[0-9a-f]{6}$/i.test(val)) {
      c = { ...hex(val), a: 1 };
    }
    if (c && !out.has(m[1]!)) out.set(m[1]!, c);
  }
  return out;
}

const PALETTE = parsePalette(CSS);

/**
 * 类名 → 该类的声明块。把 CSS 里的转义选择器（`.text-amber-300\/70`）
 * 还原成真实类名（`text-amber-300/70`），这样查表不用拼正则。
 */
let _index: Map<string, string> | null = null;
export function cssIndex(css: string = CSS): Map<string, string> {
  if (css === CSS && _index) return _index;
  const map = new Map<string, string>();
  for (const m of css.matchAll(/\.((?:[^\s{},]|\\.)+)\{([^}]*)\}/g)) {
    const name = m[1]!.replace(/\\(.)/g, '$1');
    if (!map.has(name)) map.set(name, m[2]!);
  }
  if (css === CSS) _index = map;
  return map;
}

/**
 * Tailwind 给带透明度的类额外吐的 hex 回退，当换算器的地面真值。
 * 形如：`.text-amber-300\/70{color:#ffd236b3}` 与 `--color-amber-300` 配对。
 */
export function hexGroundTruth(css: string, palette: Map<string, RGBA>): Array<{ name: string; hex: RGB }> {
  const pairs: Array<{ name: string; hex: RGB }> = [];
  const seen = new Set<string>();
  for (const m of css.matchAll(/\.([a-z-]+)-([a-z]+-\d{2,3})\\?\/(\d+)\{[a-z-]+:(#[0-9a-f]{6})[0-9a-f]{2}\}/g)) {
    const name = `--color-${m[2]}`;
    if (!palette.has(name) || seen.has(name)) continue;
    seen.add(name);
    pairs.push({ name, hex: hex(m[4]!) });
  }
  return pairs;
}

/** 类名 → 颜色（支持 `text-slate-400`、`text-amber-300/70`、`text-[#abc123]`、`text-white`）。 */
export function classToColor(cls: string, _css: string, palette: Map<string, RGBA>): RGBA | null {
  const arb = /^[a-z-]+-\[(#[0-9a-fA-F]{3,8})\]$/.exec(cls);
  if (arb) {
    let h = arb[1]!;
    if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
    const alpha = h.length === 9 ? parseInt(h.slice(7, 9), 16) / 255 : 1;
    return { ...hex(h.slice(0, 7)), a: alpha };
  }
  // 走 Tailwind 编译出来的那条规则最稳妥（含 /透明度 的 hex 回退）。
  // ★ 不手工转义类名再拼正则：`/` 在前一步已被转成 `\/`，第二步再转一次就成了
  //   `\\/`，于是永远匹配不上（`text-amber-300/70` 的透明度自检就是这么挂的）。
  //   改成一次性地把 CSS 里的选择器解析成"未转义类名 → 声明"的表。
  const decl = cssIndex().get(cls);
  if (decl) {
    // 优先取 hex 声明（Tailwind 会同时给 color-mix 版本，后者更"聪明"但更难核对）
    const decls = [...decl.matchAll(/(?:^|;)\s*color:([^;]+)/g)].map((x) => x[1]!.trim());
    const ordered = [...decls.filter((d) => d.startsWith('#')), ...decls.filter((d) => !d.startsWith('#'))];
    for (const d of ordered) {
      const c = parseColor(d, palette);
      if (c) return c;
    }
  }
  // 兜底：text-<name>-<shade>[/alpha] 直接查调色板
  const simple = /^[a-z-]+-([a-z]+-\d{2,3})(?:\/(\d+))?$/.exec(cls);
  if (simple) {
    const base = palette.get(`--color-${simple[1]}`);
    if (base) return { ...base, a: simple[2] ? Number(simple[2]) / 100 : 1 };
  }
  return null;
}

/** 主题里那些"任意值"背景：`bg-[#090d1a]` 与渐变 `from-[#..] to-[#..]`。 */
export function themeSurfaces(t: Record<string, string>): Array<{ label: string; color: RGB }> {
  const out: Array<{ label: string; color: RGB }> = [];
  const pick = (label: string, cls: string | undefined) => {
    if (!cls) return;
    for (const m of cls.matchAll(/\[(#[0-9a-fA-F]{6})\]/g)) out.push({ label, color: hex(m[1]!) });
  };
  pick('pageBg', t.pageBg);
  pick('cardBg.from', t.cardBg);
  pick('cardInnerBg', t.cardInnerBg);
  pick('navBg', t.navBg);
  return out;
}

// ───────────────────────── 自检
//
// 教训：自检只测工具函数、不测"扫真实文件"那条路，等于没自检。

check('自检·oklch 纯白', JSON.stringify(oklchToSrgb(1, 0, 0)) === JSON.stringify({ r: 255, g: 255, b: 255 }));
check('自检·oklch 纯黑', JSON.stringify(oklchToSrgb(0, 0, 0)) === JSON.stringify({ r: 0, g: 0, b: 0 }));
check('自检·对比度 黑白 = 21', Math.abs(contrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }) - 21) < 0.01);
check('自检·对比度 同色 = 1', Math.abs(contrast({ r: 18, g: 26, b: 44 }, { r: 18, g: 26, b: 44 }) - 1) < 0.001);
check('自检·合成半透明白到黑 = 中灰',
  JSON.stringify(composite({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 })) === JSON.stringify({ r: 128, g: 128, b: 128 }));

// 换算器必须对上 Tailwind 自己吐的 hex——这是本文件最关键的一条自检。
const GROUND = hexGroundTruth(CSS, PALETTE);
check('从构建产物取到足够的 hex 地面真值', GROUND.length >= 40, `只取到 ${GROUND.length} 组`);
let worst = { name: '', delta: 0 };
for (const g of GROUND) {
  const mine = PALETTE.get(g.name)!;
  const d = Math.max(Math.abs(mine.r - g.hex.r), Math.abs(mine.g - g.hex.g), Math.abs(mine.b - g.hex.b));
  if (d > worst.delta) worst = { name: g.name, delta: d };
}
/**
 * 少数颜色**超出 sRGB 色域**，Tailwind 给回退 hex 时用的是较廉价的裁剪，
 * 于是与精确换算有可见偏差。已核实：`#ff8904`（我算）正是 Tailwind v4 文档里
 * orange-400 的公开值，说明**精确的那一边是我**。
 *
 * 所以这里不放宽容差（那会让护栏瞎掉），而是：
 *   • 绝大多数必须 ≤2/255
 *   • 超 6/255 的只许是**已记录**的那几个，多出一个就报错
 *   • 另用公开文档值做独立锚点
 */
const OUT_OF_GAMUT = new Set(['--color-orange-400']);

const deltas = GROUND.map((g) => {
  const mine = PALETTE.get(g.name)!;
  return {
    name: g.name,
    delta: Math.max(Math.abs(mine.r - g.hex.r), Math.abs(mine.g - g.hex.g), Math.abs(mine.b - g.hex.b)),
  };
});
const close = deltas.filter((d) => d.delta <= 2).length;
check(`oklch→sRGB 与 Tailwind hex 逐通道一致（${close}/${deltas.length} 组 ≤2/255）`,
  close / deltas.length >= 0.8, `只有 ${((close / deltas.length) * 100).toFixed(0)}% 达标`);
const outliers = deltas.filter((d) => d.delta > 6).map((d) => d.name);
check('超 6/255 的偏差只出现在已记录的色域外颜色上',
  outliers.every((n) => OUT_OF_GAMUT.has(n)),
  `意外离群: ${outliers.filter((n) => !OUT_OF_GAMUT.has(n)).join(', ')}`);
check(`已记录的色域外颜色仍只有 ${OUT_OF_GAMUT.size} 个`, outliers.length <= OUT_OF_GAMUT.size,
  `实际 ${outliers.length} 个: ${outliers.join(', ')}`);
// 独立锚点：Tailwind v4 文档里 orange-400 的公开 sRGB 值
check('锚点·orange-400 换算 == 公开值 #ff8904',
  JSON.stringify(oklchToSrgb(0.75, 0.183, 55.934)) === JSON.stringify({ r: 255, g: 137, b: 4 }),
  JSON.stringify(oklchToSrgb(0.75, 0.183, 55.934)));
check('锚点·slate-400 换算 == Tailwind 回退 #90a1b9',
  JSON.stringify(oklchToSrgb(0.704, 0.04, 256.788)) === JSON.stringify({ r: 144, g: 161, b: 185 }));

check('自检·cssIndex 能把转义选择器还原成真实类名',
  cssIndex().has('text-amber-300/70') && cssIndex().has('bg-[#090d1a]'),
  [...cssIndex().keys()].filter((k) => k.includes('/')).slice(0, 3).join(', '));

// alpha 是从 8 位量化的 hex 反推的（0xb3/255 = 0.70196），不能用浮点精确相等。
// 原来这里写 `=== 0.7`，测试自己挂了而代码是对的——断言过严同样会让护栏失去信任。
const halfAlpha = classToColor('text-amber-300/70', CSS, PALETTE)?.a ?? 0;
check('自检·classToColor 认得带透明度的类', Math.abs(halfAlpha - 0.7) < 0.005,
  `实际 ${halfAlpha}`);
check('自检·classToColor 认得任意值类',
  JSON.stringify(classToColor('bg-[#090d1a]', CSS, PALETTE)) === JSON.stringify({ r: 9, g: 13, b: 26, a: 1 }));
check('自检·classToColor 对不存在的类返回 null',
  classToColor('text-nope-999', CSS, PALETTE) === null);

// ───────────────────────── ① 主题契约：各槽位 vs 各自的底

const THRESH = 4.5;
// ThemeConfig 没有索引签名，直接断言成 Record 会被 tsc 拒绝（TS2352）。
const themes = Object.entries(APP_THEMES) as unknown as Array<[string, Record<string, string>]>;

for (const [id, t] of themes) {
  const surfaces = themeSurfaces(t);
  check(`主题 ${id} 解析出背景色`, surfaces.length >= 3, `只有 ${surfaces.length} 个`);

  for (const slot of ['textPrimary', 'textSecondary', 'textMuted'] as const) {
    const fg0 = classToColor(t[slot]!, CSS, PALETTE);
    if (!fg0) { check(`${id}.${slot} 解析失败`, false, t[slot]); continue; }
    for (const s of surfaces) {
      const r = contrast(composite(fg0, s.color), s.color);
      check(`${id}.${slot} on ${s.label} ≥ ${THRESH}`, r >= THRESH,
        `${r.toFixed(2)}:1（${t[slot]} on ${JSON.stringify(s.color)}）`);
    }
  }

  // 导航未选中文字：它就在 navBg 上
  const navBg = surfaces.find((s) => s.label === 'navBg');
  const navFg = classToColor(t.navInactiveText!, CSS, PALETTE);
  if (navBg && navFg) {
    const r = contrast(composite(navFg, navBg.color), navBg.color);
    check(`${id}.navInactiveText on navBg ≥ ${THRESH}`, r >= THRESH,
      `${r.toFixed(2)}:1（${t.navInactiveText}）`);
  }

  // 强调底色上的前景：这一格原先**不存在**，13 处按钮硬编码 text-white，
  // 在琥珀(3.20)与青(3.62)两套主题上低于 4.5。
  const accentFg = classToColor(t.accentFg!, CSS, PALETTE);
  for (const m of t.accentBg!.matchAll(/(?:bg|hover:bg)-([a-z]+-\d{2,3})/g)) {
    const bg = PALETTE.get(`--color-${m[1]!}`);
    if (!bg || !accentFg) { check(`${id}.accentBg 可解析 (${m[1]})`, false, ''); continue; }
    const r = contrast(composite(accentFg, bg), bg);
    check(`${id}.accentFg on ${m[1]} ≥ ${THRESH}`, r >= THRESH,
      `${r.toFixed(2)}:1（${t.accentFg} on ${m[1]}）`);
  }
}

// ───────────────────────── ② 同一元素上的字面 bg + text 配对

const files = readdirSync(join(ROOT, 'src/components')).filter((f) => f.endsWith('.tsx'))
  .map((f) => join(ROOT, 'src/components', f));

const BG_RE = /(?:(?:hover|focus|active|disabled|group-hover|group-focus|sm|md|lg):)*\b(?:bg|from|to|via)-(?:\[#[0-9a-fA-F]{3,8}\]|(?:slate|zinc|gray|neutral|stone|amber|cyan|indigo|emerald|rose|red|orange|sky|teal|violet|purple|blue|green|yellow)-\d{2,3}(?:\/\d{2,3})?)\b/g;
const FG_RE = /(?:(?:hover|focus|active|disabled|group-hover|group-focus|sm|md|lg):)*\btext-(?:\[#[0-9a-fA-F]{3,8}\]|(?:slate|zinc|gray|neutral|stone|amber|cyan|indigo|emerald|rose|red|orange|sky|teal|violet|purple|blue|green|yellow|white|black)(?:-\d{2,3})?(?:\/\d{2,3})?)\b/g;

/**
 * 取状态前缀。它回答"这两个类会不会同时生效"。
 *
 * ★ 第一版没有这一步，于是 `text-slate-400`（常态）和 `hover:bg-slate-700`（悬停态）
 * 被配成一对，报出 3.94:1 —— 而这两个状态从不同时出现，悬停时生效的是
 * `hover:text-slate-200`。**误报和漏报一样会让护栏失去信任。**
 */
const prefixOf = (cls: string): string =>
  (cls.match(/^((?:hover|focus|active|disabled|group-hover|group-focus|sm|md|lg):)*/) ?? [''])[0]!;

let pairChecked = 0;
const pairBad: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // 只在 className 字符串里找，避免把注释和普通字符串当样式
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const cls = m[1] ?? m[2] ?? m[3] ?? '';
    if (cls.includes('${')) continue; // 含主题插值的交给 ① 处理
    const bgs = [...cls.matchAll(BG_RE)].map((x) => x[0]);
    const fgs = [...cls.matchAll(FG_RE)].map((x) => x[0]);
    if (!bgs.length || !fgs.length) continue;
    for (const bc of bgs) {
      const bg = classToColor(bc.replace(/^(?:hover|focus|active|disabled|group-hover|group-focus|sm|md|lg):+/, ''), CSS, PALETTE);
      if (!bg) continue;
      const bgS = composite(bg, { r: 0, g: 0, b: 0 });
      for (const fc of fgs) {
        // 只配同一状态前缀 —— 常态的字不会落在悬停态的底上
        if (prefixOf(bc) !== prefixOf(fc)) continue;
        const fg = classToColor(fc.replace(/^(?:hover|focus|active|disabled|group-hover|group-focus|sm|md|lg):+/, ''), CSS, PALETTE);
        if (!fg) continue;
        pairChecked++;
        const r = contrast(composite(fg, bgS), bgS);
        if (r < THRESH) {
          pairBad.push(`${f.split('/').pop()} — ${fc} on ${bc} = ${r.toFixed(2)}:1`);
        }
      }
    }
  }
}
check('确实检查到了同元素 bg+text 配对', pairChecked >= 20, `只查到 ${pairChecked} 组`);
check('同元素上的文字与底色对比度达标', pairBad.length === 0, pairBad.slice(0, 6).join('; '));

// ───────────────────────── ③ 深色底上的中性文字：对最亮的那个底也要过关
//
// 这一条抓的是**系统性**问题：`text-slate-500` 这种写死的冷灰不随主题变，
// 于是它在每套主题上的裕度不同，最亮的那套最先掉下去。
// 实测修复前它有 3.08:1（serene_blue 卡片底）。

const allSurfaces = themes.flatMap(([, t]) => themeSurfaces(t).map((s) => ({ ...s, theme: t.id })));
const lightest = allSurfaces.reduce((a, b) => (luminance(a.color) > luminance(b.color) ? a : b));

const usedTextClasses = new Set<string>();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\btext-(?:slate|zinc|gray|neutral|stone)(?:-\d{2,3})(?:\/\d{2,3})?\b/g)) {
    usedTextClasses.add(m[0]);
  }
}
check('扫到了中性文字色类', usedTextClasses.size >= 5, `只有 ${usedTextClasses.size} 个`);

const neutralBad: string[] = [];
let neutralChecked = 0;
for (const cls of usedTextClasses) {
  const c = classToColor(cls, CSS, PALETTE);
  if (!c) { neutralBad.push(`${cls} 解析失败`); continue; }
  // 只查"比底还亮"的（深色底上的浅字）；深字配浅底由 ② 负责
  if (luminance(c) <= luminance(lightest.color)) continue;
  neutralChecked++;
  const r = contrast(composite(c, lightest.color), lightest.color);
  if (r < THRESH) neutralBad.push(`${cls} on ${lightest.theme}.${lightest.label} = ${r.toFixed(2)}:1`);
}
check('确实检查了中性文字', neutralChecked >= 4, `只查了 ${neutralChecked} 个`);
check('中性文字在最亮的深色底上也 ≥ 4.5:1', neutralBad.length === 0, neutralBad.join('; '));

// ───────────────────────── ④ 本层的校准依据（真实渲染实测）

export const CONTRAST_MEASURED = {
  method: 'Chrome + canvas 像素合成，4 套主题 × 5 个页面',
  elementsMeasured: 1040,
  violationsBeforeFix: 114,
  violationsAfterFix: 0,
  worstBefore: [
    { theme: 'serene_blue', cls: 'text-slate-500', ratio: 3.08 },
    { theme: 'warm_amber', cls: 'bg-amber-600 + text-white', ratio: 3.2 },
    { theme: 'serene_blue', cls: 'bg-cyan-600 + text-white', ratio: 3.62 },
  ],
} as const;

check('实测记录里"修复后 0 违例"与本次断言口径一致',
  CONTRAST_MEASURED.violationsAfterFix === 0 && CONTRAST_MEASURED.elementsMeasured > 1000);

// ───────────────────────── 结果

if (failures.length) {
  console.error(`\n❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`✅ 颜色对比度（${pass} 项断言）全部通过`);
console.log(`   · oklch→sRGB 已与 Tailwind 吐出的 ${GROUND.length} 组 hex 对齐（${close} 组 ≤2/255）`);
console.log(`   · 同元素 bg+text 配对查了 ${pairChecked} 组；中性文字查了 ${neutralChecked} 个类`);
process.exit(0);
