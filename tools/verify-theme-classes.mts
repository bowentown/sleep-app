/**
 * 校验颜色类是否真的生成了 CSS。
 *
 * 起因：themeStyles.ts 里 cardInnerBorder 写的是 border-slate-850，
 * 而 Tailwind 4 的 slate 调色板只有 800/900——这个类名不存在，生成不出任何规则。
 * 类名静默失效后 border-color 回退成 currentColor，于是本该「几乎看不见的
 * 深色描边」在深色主题下渲染成了纯白描边。构建成功、tsc 通过、运行时也不报错，
 * 只能靠比对构建产物才能发现。
 *
 * 扫描范围包含 sleepStageColors.ts：分期配色同样是一串写死的类名
 * （bg-pink-600 / bg-orange-300 之类），写错一位就会静默失效，
 * 而且在那里失效意味着图表某一段直接没有背景色。
 *
 * 必须在 npm run build 之后运行（读的是 dist 里的 CSS）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = join(root, 'dist', 'assets');
// 存放颜色类名清单的源文件
const sourceFiles = [
  join(root, 'src', 'utils', 'themeStyles.ts'),
  join(root, 'src', 'utils', 'sleepStageColors.ts'),
];

import { APP_THEMES } from '../src/utils/themeStyles.js';

const failures: string[] = [];
let pass = 0;
/** 与文件顶部的 failures/pass 同构：这里也要能累计通过数 */
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

if (!existsSync(distAssets)) {
  console.error('❌ 未找到 dist/assets，请先执行 npm run build');
  process.exit(1);
}

const cssFiles = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
if (cssFiles.length === 0) {
  console.error('❌ dist/assets 下没有 CSS 文件，请先执行 npm run build');
  process.exit(1);
}
const css = cssFiles.map((f) => readFileSync(join(distAssets, f), 'utf8')).join('\n');

// 收集颜色类名。两份来源的写法不同，分别解析：
//   themeStyles.ts     field: 'bg-slate-900 border-slate-700/80 ...'
//   sleepStageColors.ts  deep: { hex: '#4f46e5', className: 'bg-indigo-600', ... }
const tokens = new Set<string>();
const fieldOf = new Map<string, Set<string>>();
const collect = (value: string, field: string) => {
  for (const t of value.split(/\s+/)) {
    if (!/^(bg|text|border|ring|from|to|via|fill|stroke|divide|outline|accent|caret|decoration|placeholder)-/.test(t)) {
      continue;
    }
    tokens.add(t);
    if (!fieldOf.has(t)) fieldOf.set(t, new Set());
    fieldOf.get(t)!.add(field);
  }
};

for (const file of sourceFiles) {
  const src = readFileSync(file, 'utf8');
  const short = file.slice(root.length + 1);
  // 按文件用锚定的精确模式，避免把注释里提到的类名（比如解释旧 bug 时
  // 写的 border-slate-850）当成真实使用而误报。
  const patterns: [RegExp, number, number][] = [
    // themeStyles.ts:  cardBg: 'bg-slate-900/80 border-slate-700/80'
    [/^[ \t]*(\w+):[ \t]*'([^']*)'/gm, 1, 2],
    // sleepStageColors.ts:  deep: { hex: '#4f46e5', className: 'bg-indigo-600', ... }
    [/^[ \t]*(\w+):[ \t]*\{[^}]*className:[ \t]*'([^']*)'/gm, 1, 2],
  ];
  for (const [re, labelGroup, valueGroup] of patterns) {
    for (const m of src.matchAll(re)) {
      collect(m[valueGroup], `${short}:${m[labelGroup]}`);
    }
  }
}

// Tailwind 写进 CSS 时会把 [ ] # . / % 等字符转义
const escapeForCss = (cls: string) => cls.replace(/[^a-zA-Z0-9-]/g, (c) => '\\' + c);

// 逐个前缀也顺带校验：hover:/focus: 变体同样会被转义
for (const t of [...tokens].sort()) {
  if (css.includes('.' + escapeForCss(t))) {
    pass++;
  } else {
    failures.push(`${t}  ← ${[...(fieldOf.get(t) ?? [])].join(', ')}`);
  }
}

// ===== 运行期拼接变体前缀：Tailwind 扫不到，规则根本不会生成 =====
// Tailwind 4 是在构建时静态扫描源码文本里出现的类名字符串来生成 CSS 的。
// `focus:${theme.accentBorder}` 这种写法，扫描器看到的字面量是
// "focus:${theme.accentBorder}"，它拼不出也扫不到 focus:border-indigo-400，
// 于是这条规则根本不存在——输入框聚焦时描边色不变，而且不报错、不警告、
// tsc 也通过。（实测用户源码 7 处这样的写法，构建产物里 focus:border-* 出现 0 次，
// 而非 focus 版本出现 3 次，两者对照说明就是这个原因。）
const VARIANT_INTERP = /(?:^|[\s"'`])((?:hover|focus|focus-visible|focus-within|active|visited|target|first|last|odd|even|group-hover|group-focus|peer-hover|peer-focus|disabled|enabled|checked|required|invalid|valid|selection|placeholder|file|marker|before|after|dark|motion-safe|motion-reduce|print|sm|md|lg|xl|2xl):\$\{)/g;

/**
 * 剥掉注释，但**保留字符串与模板字符串的内容**。
 *
 * 必要性：这些检查工具的说明性注释里必须能写出反例本身（比如
 * 「不能写成 focus:${theme.accentBorder}」），否则注释没法解释清楚。
 * 不剥注释就会把这些示例当成真实违规，报一堆假阳性。
 * 而字符串内容恰恰是要扫的地方（违规就写在模板字符串里），所以不能一起剥掉。
 *
 * 做法：逐字符走一遍，用一个「当前是否在 ' " ` 里」的状态决定 // 和 /* 是不是注释。
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += source[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue; // 不吞掉换行，行号才不会漂
    }
    if (c === '/' && source[i + 1] === '*') {
      // 块注释跨行时补回等量换行，否则后面所有行号都会漂
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function findInterpolatedVariants(source: string): string[] {
  const found: string[] = [];
  // 保留注释里的行号：剥注释时不删换行，所以行号仍然对得上
  const clean = stripComments(source);
  for (const m of clean.matchAll(VARIANT_INTERP)) {
    const line = clean.slice(0, m.index).split('\n').length;
    found.push(`第 ${line} 行 ${m[1]}…}`);
  }
  return found;
}

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkSrc(full));
    else if (/\.(tsx|ts)$/.test(full)) out.push(full);
  }
  return out;
}

const interpOffenders: string[] = [];
for (const file of walkSrc(join(root, 'src'))) {
  const found = findInterpolatedVariants(readFileSync(file, 'utf8'));
  for (const f of found) interpOffenders.push(`${file.slice(root.length + 1)} ${f}`);
}
check('没有「变体前缀 + 运行期拼接」的类名', interpOffenders.length === 0,
  interpOffenders.length
    ? `\n     ${interpOffenders.join('\n     ')}\n     这类类名 Tailwind 静态扫描不到，规则不会生成，样式静默失效。请把完整类名写成字面量 token（如 accentFocusBorder: 'focus:border-indigo-400'）。`
    : '');

// 检测器自测：真实代码干净之后，「0 条」既可能是对的也可能是规则写歪了，
// 用一段必然违规的样本证明它仍然有效。
const INTERP_BAD = `const a = \`\${bg} rounded focus:\${theme.accentBorder} px-2\`;\nconst b = \`hover:\${theme.accentBg}\`;`;
const INTERP_GOOD = `const c = \`focus:border-indigo-400 px-2\`;\nconst d = \`\${theme.accentFocusBorder}\`;`;
check('自测：能抓出 focus:/hover: 拼接的写法', findInterpolatedVariants(INTERP_BAD).length === 2,
  `实际抓到 ${findInterpolatedVariants(INTERP_BAD).length} 条——为 0 说明这条检查已失效`);
check('自测：不误报写成字面量的正确写法', findInterpolatedVariants(INTERP_GOOD).length === 0,
  '正确写法被误报会让人绕过这条检查');

// 正向确认：accentFocusBorder 必须是字面量，且真的生成了 CSS
for (const [mode, cfg] of Object.entries(APP_THEMES)) {
  const cls = cfg.accentFocusBorder;
  check(`${mode}.accentFocusBorder 是字面量而非拼接`, !cls.includes('${'),
    `值是 ${cls}`);
  check(`${mode}.accentFocusBorder 生成了 CSS`, css.includes('.' + escapeForCss(cls)),
    `${cls} 在构建产物里找不到`);
}

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 主题颜色类全部可用（${pass} 项）`);
} else {
  console.log(`❌ ${failures.length} 个类生成不出 CSS / 共 ${pass + failures.length} 个：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  console.log(
    '\n这类类名不存在时会静默失效，border-color 会回退成 currentColor（常常是白色）。\n' +
      '请改用调色板里真实存在的档位（如 slate-800）或任意值 bg-[#0c1222]。'
  );
  process.exit(1);
}
