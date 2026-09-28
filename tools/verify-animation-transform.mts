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
