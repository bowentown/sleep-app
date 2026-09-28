/**
 * 校验主题里的颜色类是否真的生成了 CSS。
 *
 * 起因：themeStyles.ts 里 cardInnerBorder 写的是 border-slate-850，
 * 而 Tailwind 4 的 slate 调色板只有 800/900——这个类名不存在，生成不出任何规则。
 * 类名静默失效后 border-color 回退成 currentColor，于是本该「几乎看不见的
 * 深色描边」在深色主题下渲染成了纯白描边。构建成功、tsc 通过、运行时也不报错，
 * 只能靠比对构建产物才能发现。
 *
 * 必须在 npm run build 之后运行（读的是 dist 里的 CSS）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = join(root, 'dist', 'assets');
const themeFile = join(root, 'src', 'utils', 'themeStyles.ts');

const failures: string[] = [];
let pass = 0;

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
const src = readFileSync(themeFile, 'utf8');

// 收集主题里出现的所有颜色类名
const tokens = new Set<string>();
const fieldOf = new Map<string, Set<string>>();
for (const m of src.matchAll(/^\s*(\w+):\s*'([^']*)'/gm)) {
  const [, field, value] = m;
  for (const t of value.split(/\s+/)) {
    if (!/^(bg|text|border|ring|from|to|via|fill|stroke|divide|outline|accent|caret|decoration|placeholder)-/.test(t)) {
      continue;
    }
    tokens.add(t);
    if (!fieldOf.has(t)) fieldOf.set(t, new Set());
    fieldOf.get(t)!.add(field);
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
