/**
 * 动画与定位的冲突检查。
 *
 * 背景（真实缺陷，实际发生过两次）：
 * CSS 动画里的 `transform` 会**覆盖**元素的内联 `transform`。一个元素如果
 * 靠 `transform: translateX(-50%)` 做水平居中，同时又挂着动画，而动画的关键帧
 * 只写了 `translateY` 或 `scale`，那么：
 *   1. 动画期间元素失去水平居中；
 *   2. `animation-fill-mode: both` 让终态（例如 `translateY(0)`）**永久**留在
 *      元素上，动画结束后居中也不会恢复。
 *
 * 实测（390px 视口，开屏组件）：
 *   - 涟漪层用 left:50% + translateX(-50%) 居中并挂 splash-rise，
 *     结果中心 X = 310（视口中心 195），偏右 115px，右半截直接跑出屏幕；
 *   - 宣传词同样写法，文字中心 X = 267.5，偏右 72.5px。
 * 评审把它看成「图案飘在月亮右下角、像渲染故障」——是审美直觉对了一次
 * 真实的布局缺陷。
 *
 * 规则：
 *   收集 index.css 里所有会设置 transform 的关键帧；
 *   若某个关键帧的 transform **不含**水平位移（没有 translate(-50% / translateX(-50%)），
 *   则任何「内联写了 translateX(-50%) 居中」又「引用该关键帧」的元素都是错的。
 *   反例说明：splash-zoom 的关键帧自带 translate(-50%,-50%) scale(...)，
 *   所以月亮用它是对的，不报。
 *
 * 修法：不要用 transform 居中。改成 left:0 / right:0 配 flex 居中或 text-align，
 * 让动画独占 transform。
 *
 * 运行：npm run verify:animation
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CSS_PATH = join(ROOT, 'src/index.css');

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}


/** 剥掉注释，保留字符串内容。检查规则时不能把注释里写的反例当成真违规。 */
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
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { if (source[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 找出「用 !important 去改一个正在被动画驱动的属性」的规则。
 *
 * 为什么必须禁掉：CSS 层叠里 !important 的作者声明**优先于动画**。
 * 也就是说一条看起来只是「清掉阴影」的规则，会连带把用 box-shadow 做的
 * 入场/呼吸动画整个压掉，而且不报错、不警告。
 * 真实案例：.theme-pure_dark .shadow-lg { box-shadow: none !important }
 * 把 CTA 的 .animate-cta-breathe 在纯黑主题下压成了 box-shadow: none，
 * 另外三套主题正常——只有切到那一个主题才会发现。
 */
function collectAnimatedProps(source: string): Set<string> {
  const css = stripComments(source);
  const animated = new Set<string>();
  const kfRe = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let k: RegExpExecArray | null;
  while ((k = kfRe.exec(css)) !== null) {
    let depth = 1;
    let i = kfRe.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(kfRe.lastIndex, i - 1);
    for (const d of body.matchAll(/([a-z-]+)\s*:/g)) animated.add(d[1]);
  }
  return animated;
}

/**
 * animated 必须由调用方传入（来自真实的 index.css），不能在函数内部从
 * 待查文本里现算——自测样本里没有关键帧，现算会得到空集，
 * 于是「一条都抓不到」而被误判为代码干净。
 */
function findImportantOverAnimations(source: string, animated: Set<string>): string[] {
  const css = stripComments(source);
  const found: string[] = [];
  for (const m of css.matchAll(/([a-z-]+)\s*:[^;{}]*!important/g)) {
    const prop = m[1];
    if (!animated.has(prop)) continue;
    // 取所在选择器，便于定位
    const before = css.slice(0, m.index);
    const sel = (before.match(/([^{}]+)\{(?![^{}]*\})[^{}]*$/) || [])[1]?.trim() ?? '(未知选择器)';
    const line = before.split('\n').length;
    found.push(`第 ${line} 行 ${sel.replace(/\s+/g, ' ')} → ${prop}: … !important`);
  }
  return found;
}


/**
 * 检查「减弱动效」块是否真的能生效。
 *
 * 坑：@media (prefers-reduced-motion: reduce) 里的 .animate-X { animation: none }
 * 与文件末尾的 .animate-X { animation: ... } 特异性相同，**后者胜**。
 * 也就是说，只要把动画类定义写在减弱动效块之后，那条 none 就被静默覆盖，
 * 用户在系统里打开「减弱动效」也不会有任何变化——不报错、构建也通过。
 * 实测踩过一次：.animate-cta-breathe 追加在文件末尾，动画照跑。
 *
 * 规则：减弱动效块里提到的每个 .animate-* 类，其定义必须出现在该块之前。
 */
function findReducedMotionOrderBugs(source: string): string[] {
  const css = stripComments(source);

  // 第一步：先把减弱动效块的范围量出来。块内部的 .animate-X { animation: none }
  // 也是"带 animation 的定义"，如果不排除，它会被当成最后一次定义，
  // 于是顺序正确的写法反而被报成违规（自测抓到过这个假阳性）。
  const rmRanges: { start: number; end: number }[] = [];
  const blockRe = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let b: RegExpExecArray | null;
  while ((b = blockRe.exec(css)) !== null) {
    let depth = 1;
    let i = blockRe.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    rmRanges.push({ start: b.index, end: i });
  }
  const inRmBlock = (pos: number) => rmRanges.some((r) => pos >= r.start && pos < r.end);

  // 第二步：块外每个 .animate-X 的定义位置。取**最后一次**出现的位置——
  // 同特异性下后者胜，决定最终生效的是最后那条，取第一次会漏报。
  const defs = new Map<string, number>();
  for (const m of css.matchAll(/\.(animate-[A-Za-z0-9_-]+)\s*\{[^}]*animation\s*:/g)) {
    if (inRmBlock(m.index)) continue;
    defs.set(m[1], m.index);
  }

  // 第三步：减弱动效块里提到的类，其（块外）定义必须在该块之前
  const bugs: string[] = [];
  for (const r of rmRanges) {
    const body = css.slice(r.start, r.end);
    for (const c of body.matchAll(/\.(animate-[A-Za-z0-9_-]+)/g)) {
      const cls = c[1];
      const defPos = defs.get(cls);
      if (defPos !== undefined && defPos > r.start) {
        const defLine = css.slice(0, defPos).split('\n').length;
        const rmLine = css.slice(0, r.start).split('\n').length;
        bugs.push(`.${cls} 定义在第 ${defLine} 行，位于第 ${rmLine} 行的减弱动效块之后 —— 同特异性后者胜，none 会被覆盖`);
      }
    }
  }
  return bugs;
}

// ---- 1. 解析 index.css 里的关键帧 ----
const css = readFileSync(CSS_PATH, 'utf8');

/** name → 该关键帧里出现过的所有 transform 值 */
function parseKeyframes(source: string): Map<string, string[]> {
  const frames = new Map<string, string[]>();
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    // 花括号配平，取出整段关键帧
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(re.lastIndex, i - 1);
    const transforms = [...body.matchAll(/transform\s*:\s*([^;}]+)/g)].map((t) => t[1].trim());
    frames.set(name, transforms);
  }
  return frames;
}

const keyframes = parseKeyframes(css);
console.log(`\n=== 解析到 ${keyframes.size} 个关键帧 ===`);
for (const [name, transforms] of keyframes) {
  if (transforms.length) console.log(`  ${name}: ${transforms.join(' | ')}`);
}

// 只写竖向位移/缩放、不含水平位移的关键帧 —— 用它们就不能靠 transform 居中
const HORIZONTAL_TRANSLATE = /translate(?:X)?\(\s*-?50%|translate\(\s*-50%/;
const verticalOnly = new Set<string>();
for (const [name, transforms] of keyframes) {
  if (transforms.length === 0) continue;
  const hasHorizontal = transforms.some((t) => HORIZONTAL_TRANSLATE.test(t));
  if (!hasHorizontal) verticalOnly.add(name);
}

check('识别出「只动竖向」的关键帧', verticalOnly.size > 0,
  '一个都没识别到，说明解析规则失效了（这类检查失效时最危险，因为它会一直「通过」）');

for (const name of verticalOnly) {
  check(`关键帧 ${name} 确实不含水平位移`,
    !HORIZONTAL_TRANSLATE.test(keyframes.get(name)!.join(' ')),
    '解析结果自相矛盾');
}

// ---- 2. 扫描所有组件 ----
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(join(ROOT, 'src'));
console.log(`\n=== 扫描 ${files.length} 个源文件 ===`);

/**
 * 检测器本体。抽成函数是为了能用内置样本自测：
 * 真实代码修好之后就不该再有违规，光靠扫描真实代码无法证明规则仍然有效。
 */
function findOffenders(source: string, rel: string): string[] {
  const found: string[] = [];
  const styleRe = /style=\{\{([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(source)) !== null) {
    const styleBody = m[1];
    if (!/translateX\(\s*-50%\s*\)/.test(styleBody)) continue;

    // 该 style 对象里引用的动画名
    const animMatch = /animation:\s*[`'"]([^`'"]+)[`'"]/.exec(styleBody);
    if (!animMatch) continue;

    // 形如 "splash-rise 650ms ease-out 1950ms both" → 取第一个 token 作为名字
    const animName = animMatch[1].trim().split(/\s+/)[0];
    if (!verticalOnly.has(animName)) continue;

    const line = source.slice(0, m.index).split('\n').length;
    found.push(
      `${rel}:${line} 用 translateX(-50%) 居中，却挂着关键帧 ${animName}（该关键帧只动竖向位移）`
    );
  }
  return found;
}

const offenders = files.flatMap((file) =>
  findOffenders(readFileSync(file, 'utf8'), file.slice(ROOT.length + 1))
);

check('所有用 transform 居中的元素都不与「竖向动画」冲突', offenders.length === 0,
  offenders.length
    ? `\n     ${offenders.join('\n     ')}\n     动画的 transform 会覆盖内联 transform，且 fill-mode:both 会让终态永久生效，居中不会恢复。请改用 left:0/right:0 配 flex 或 text-align。`
    : '');

// ---- 2.5 !important 不得压掉动画属性 ----
const animatedProps = collectAnimatedProps(css);
check('能从关键帧里解析出被动画驱动的属性', animatedProps.size > 0,
  '一个属性都没解析到，说明关键帧解析失效了');
const importantConflicts = findImportantOverAnimations(css, animatedProps);
check('没有用 !important 去改被动画驱动的属性', importantConflicts.length === 0,
  importantConflicts.length
    ? `\n     ${importantConflicts.join('\n     ')}\n     !important 在层叠里优先于动画，会把动画静默压掉。请改用 :not() 精确排除带动画的元素。`
    : '');

// 自测：真实代码修好后就没了违规样本，用内置样本证明规则仍有效
const IMP_BAD = `.theme-pure_dark .shadow-lg { box-shadow: none !important; }`;
const IMP_GOOD = `.theme-pure_dark .shadow-lg:not(.animate-cta-breathe) { box-shadow: none; }`;
check('自测：能抓出 !important 压动画属性的写法',
  findImportantOverAnimations(IMP_BAD, animatedProps).length === 1,
  `实际抓到 ${findImportantOverAnimations(IMP_BAD, animatedProps).length} 条——为 0 说明这条检查已失效`);
check('自测：不误报不用 !important 的写法',
  findImportantOverAnimations(IMP_GOOD, animatedProps).length === 0,
  '正确写法被误报会让人绕过这条检查');

// ---- 2.6 减弱动效块必须晚于它所关闭的动画定义 ----
const rmBugs = findReducedMotionOrderBugs(css);
check('减弱动效块晚于它关闭的动画定义（否则会被静默覆盖）', rmBugs.length === 0,
  rmBugs.length ? `\n     ${rmBugs.join('\n     ')}` : '');

const RM_BAD = `.animate-foo { animation: foo 1s; }\n@media (prefers-reduced-motion: reduce) { .animate-foo { animation: none; } }\n.animate-foo { animation: foo 2s; }`;
const RM_GOOD = `.animate-foo { animation: foo 1s; }\n@media (prefers-reduced-motion: reduce) { .animate-foo { animation: none; } }`;
check('自测：能抓出动画定义写在减弱动效块之后的写法',
  findReducedMotionOrderBugs(RM_BAD).length === 1,
  `实际抓到 ${findReducedMotionOrderBugs(RM_BAD).length} 条——为 0 说明这条检查已失效`);
check('自测：不误报顺序正确的写法',
  findReducedMotionOrderBugs(RM_GOOD).length === 0,
  '正确写法被误报会让人绕过这条检查');

// ---- 3. 检测器自测 ----
// 真实代码修好之后就没有违规样本了，此时「扫到 0 条」既可能是代码干净，
// 也可能是规则写歪了。用内置样本证明它仍然抓得住——开屏那两个 bug 的原样代码。
const BAD_SAMPLE = `
const A = () => (
  <div className="absolute left-1/2"
    style={{ top: 'calc(38% + 118px)', transform: 'translateX(-50%)',
      opacity: 0, animation: 'splash-rise 650ms ease-out 1950ms both' }}>
    <svg />
  </div>
);
`;
const GOOD_SAMPLE_FLEX = `
const B = () => (
  <div className="absolute left-0 right-0 flex justify-center"
    style={{ top: 'calc(38% + 71px)', opacity: 0,
      animation: 'splash-rise 650ms ease-out 1950ms both' }}>
    <svg />
  </div>
);
`;
const GOOD_SAMPLE_KEYFRAME_HAS_TRANSLATE = `
const C = () => (
  <div style={{ transform: 'translate(-50%,-50%)',
    animation: 'splash-zoom 1500ms ease-out 500ms both' }}>
    <svg />
  </div>
);
`;

check('自测：能抓出「translateX(-50%) + 竖向动画」的写法',
  findOffenders(BAD_SAMPLE, '样本').length === 1,
  `实际抓到 ${findOffenders(BAD_SAMPLE, '样本').length} 条——若为 0，说明这个检查已经完全失效，会放过真实的错位缺陷`);

check('自测：不误报 flex 居中 + 竖向动画',
  findOffenders(GOOD_SAMPLE_FLEX, '样本').length === 0,
  '正确写法被误报，会让人把这条检查当成噪声而绕过');

check('自测：不误报关键帧自带水平位移的写法',
  findOffenders(GOOD_SAMPLE_KEYFRAME_HAS_TRANSLATE, '样本').length === 0,
  'splash-zoom 的关键帧含 translate(-50%,-50%)，用它居中是对的');

// ---- 4. 正向确认 ----

// ---- 3. 正向确认：自带水平位移的关键帧必须被放行 ----
check('splash-zoom 因自带 translate(-50%,-50%) 而不被判定为「只动竖向」',
  !verticalOnly.has('splash-zoom'),
  'splash-zoom 的关键帧包含 translate(-50%,-50%)，用它居中是正确的，不应报错');

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 动画与定位无冲突（${pass} 项断言）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
