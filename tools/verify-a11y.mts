/**
 * 无障碍护栏。
 *
 * 为什么单独一层：前八轮修的都是「界面与能力脱节」。
 * 无障碍是同一件事的另一种形态——**界面对看得见的人是完整的，
 * 对读屏用户却是一堆「按钮」**。而且这个 App 是**关灯后躺在床上用**的：
 * 视觉受限的用户比一般场景更依赖读屏。
 *
 * 这一层目前守两条最容易查错、也最不该出错的性质：
 *   1. 每个按钮都有**可访问名称**（否则读屏只会念「按钮」）；
 *   2. 开关类控件用 `role="switch"` + `aria-checked`（否则读屏不知道开还是关）。
 *
 * 不查对比度：主题类是 Tailwind 字符串，要算对比度得先解析整套色板，
 * 容易做出「看起来很精确但其实在猜」的断言——那正是本项目反复在修的东西。
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 辅助函数（与其它护栏保持同样的写法：先剥注释再查）
/**
 * 剥注释，但**保留换行**。
 *
 * ★ 第一版直接删掉注释，于是行号是在"变短了的文本"上算出来的——
 * 报出的行号和原文件**对不上**。我去核对 `PWAExportModal.tsx:168` 时，
 * 看到的根本不是那个按钮。**护栏报错指错地方，比不报还浪费时间。**
 * （这与前面几轮「在改写过的文本上算偏移」是同一类错误。）
 */
export function stripComments(src: string): string {
  const keepNewlines = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .replace(/^\s*\/\/.*$/gm, keepNewlines);
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx$/.test(f)) out.push(f);
  }
  return out;
}

/**
 * 从 `from` 开始，返回该标签开标签 `>` 的下标（跟踪 `{}` 深度与引号）。
 * `from` 应指向 `<`。
 */
export function tagEndAt(src: string, from: number): number {
  let q = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === q) q = ''; else if (c === '\\') i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') { i = skipBraces(src, i); continue; }
    if (c === '>') return i;
  }
  return -1;
}

/**
 * 按配对切出每个 `<button …>…</button>`。
 *
 * ★ 第一版用 `src.indexOf('/>', j)` 判断自闭合——**大错**。
 * 按钮内部任何一个自闭合子元素（`<Plus … />`）的 `/>` 都出现在 `</button>` 之前，
 * 于是整个按钮被截断成「只有第一个子元素」。
 * 后果：`TodayTab` 里明明写着「记录昨夜睡眠」的按钮被判成"没有名称"。
 *
 * 正确做法：先求出**开标签**的 `>`，看它前一个字符是不是 `/`。
 *
 * 这个 bug 之所以能躲过自检，是因为自检只测了辅助函数，
 * 没测 `extractButtons` 面对**真实的多子元素嵌套 JSX**（含自闭合子元素）的情形。
 * 是靠人肉抽查一个"肉眼可见有中文却被判空"的按钮才发现的。
 */
export function extractButtons(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (true) {
    const j = src.indexOf('<button', i);
    if (j < 0) break;
    const end = tagEndAt(src, j);
    if (end < 0) break;
    if (src[end - 1] === '/') {           // 真·自闭合
      out.push(src.slice(j, end + 1));
      i = end + 1;
      continue;
    }
    const close = src.indexOf('</button>', end);
    if (close < 0) {                       // 没有闭合标签，按开标签收尾
      out.push(src.slice(j, end + 1));
      i = end + 1;
      continue;
    }
    out.push(src.slice(j, close + 9));
    i = close + 9;
  }
  return out;
}

/**
 * 从 `{` 跳到配对的 `}`，返回 `}` 的下标。带引号与嵌套花括号处理。
 *
 * （不要拿它去跳 `<标签>`：`skipBalanced(src, i, '<', '>')` 会把开头的 `<`
 *  当成一次深度自增，于是**永远匹配不到第一个 `>`**，嵌套标签一个都剥不掉。
 *  我第一版就是这么复用的，结果 36 个按钮里一大批是误报。）
 */
function skipBraces(src: string, i: number): number {
  let depth = 0, q = '';
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === q) q = ''; else if (c === '\\') i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    // ★ 必须**先减再判**。第一版写成「先判 depth===0 再减」，
    // 于是开头的 `{` 把 depth 加到 1，配对的 `}` 只减到 0 就继续往下扫，
    // 永远不 return —— 整个函数返回 src.length，
    // 后续内容被当成「属性」一起吞掉。
    // 结果：`TodayTab` 里明明写着「记录昨夜睡眠」的按钮被判成"没有名称"。
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return src.length;
}

/**
 * 从 `<` 跳到该标签的 `>`，返回 `>` 的下标（不消耗）。
 * 属性里可能有 `{}`（其中还可能含 `>`、箭头函数、模板串），所以要按花括号深度走。
 */
function skipTag(src: string, i: number): number {
  let q = '';
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === q) q = ''; else if (c === '\\') i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') { i = skipBraces(src, i); continue; }
    if (c === '>') return i;
  }
  return src.length;
}

/**
 * 开标签 `>` 的位置。
 *
 * ★ 必须跟踪 `{}` 深度与引号，不能 `indexOf('>')`。
 * `onClick={() => f()}` 里的 `>` 会把位置切在标签中间，
 * 于是「按钮内容」变成一段属性文本——**判定结果全是噪声**。
 * 第一版就是这么写的，自检里「属性里含 => 也能正确剥掉」那条当场报错。
 */
export function openingTagEnd(blk: string): number {
  return tagEndAt(blk, 0);
}

/**
 * 取出「真正会被看到的文字」。
 *
 * ★ 这个函数是被自己的自检逼出来的。第一版直接拿 inner 找中英文，
 * 结果 `<button><X className="w-4 h-4" /></button>` 被判成"有可见文字"，
 * 因为 `className="w-4 h-4"` 里**有拉丁字母**。
 * 后果极其危险：扫描报「0 个问题」，我就会得出"无障碍没问题"的结论。
 *
 * 规则：
 *   • `<标签 …>` 整段丢掉；
 *   • `{表达式}` **只取其中的字符串字面量**——`{cond ? '停止' : '播放'}` 是文案，
 *     而 `{Icon}` / `{label}` 这种裸标识符**静态无法判定**，
 *     一律不算名称（宁可要求补 `aria-label`，也不放行一个可能只是图标的东西）；
 *   • 其余原样保留。
 */
export function visibleText(inner: string): string {
  let out = '', i = 0;
  while (i < inner.length) {
    const ch = inner[i]!;
    if (ch === '<') {
      const end = skipTag(inner, i);
      i = end < inner.length ? end + 1 : inner.length;
      out += ' ';
      continue;
    }
    if (ch === '{') {
      const end = skipBraces(inner, i);
      const expr = inner.slice(i + 1, end);
      i = end < inner.length ? end + 1 : inner.length;
      // 字符串字面量：里面的文字就是可见文字
      let literal = '';
      for (const m of expr.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
        literal += ' ' + (m[1] ?? m[2] ?? m[3] ?? '');
      }
      // ★ 裸标识符怎么办？`{t.label}`（值，运行时有字）与 `{Icon}`（组件）静态无法直接分辨。
      // 用 React 的**强制约定**区分：组件名必须大写，值可以小写。
      //   `{t.label}` / `{day}` / `{prompt}`  → 小写开头 → 当作值 → 算可见文字
      //   `{Icon}` / `{T.icon}`               → 大写开头 → 当作组件 → 不算文字
      // 遗留缺口：`{icon}`（小写变量，值是组件）会被当成文字而漏过。极少见，此处如实记下。
      const bare = expr.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ').trim();
      const root = bare.match(/^[A-Za-z_$][\w$]*/)?.[0] ?? '';
      if (root && /^[a-z_$]/.test(root)) literal += ' ' + bare.replace(/[^A-Za-z\u4e00-\u9fff]/g, ' ');
      out += ' ' + literal + ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 有没有可访问名称：开标签上有 aria-label/title，或者内容里有真正的可见文字。 */
export function hasAccessibleName(blk: string): boolean {
  const end = openingTagEnd(blk);
  const tag = end < 0 ? blk : blk.slice(0, end);
  if (/\baria-label(ledby)?=/.test(tag) || /\btitle=/.test(tag)) return true;
  const inner = end < 0 ? '' : blk.slice(end + 1).replace(/<\/button>/g, '');
  const text = visibleText(inner);
  return /[\u4e00-\u9fff]/.test(text) || /[A-Za-z]/.test(text);
}

// ── 自检：护栏自己的逻辑必须先被验证
// 本项目已多次出现「检查匹配到自己」「检查匹配不到任何东西」，
// 所以这里用**合成样本**先确认判定逻辑是对的，再去查真实代码。
{
  check('自检：无名称的图标按钮会被判为不合格',
    !hasAccessibleName('<button onClick={f}><X className="w-4 h-4" /></button>'));
  check('自检：有 aria-label 的通过',
    hasAccessibleName('<button aria-label="关闭"><X /></button>'));
  check('自检：中文可见文字通过',
    hasAccessibleName('<button><span>保存</span></button>'));
  check('自检：拉丁字母可见文字通过（第一版就错在这里）',
    hasAccessibleName('<button>⚡ deepseek-flash</button>'));
  // 裸标识符按 React 的大小写约定区分：小写是值，大写是组件。
  check('自检：小写裸标识符当作值（{t.label} 运行时有字）',
    hasAccessibleName('<button>{t.label}</button>'));
  check('自检：大写裸标识符当作组件（{Icon} 没有字）',
    !hasAccessibleName('<button>{Icon}</button>'));
  check('自检：{day} 这类短变量当作值',
    hasAccessibleName('<button>{day}</button>'));
  check('自检：表达式里的字符串字面量算名称',
    hasAccessibleName('<button>{done ? \'已完成\' : \'开始\'}</button>'));
  check('自检：三元表达式里的中文算可见文字',
    hasAccessibleName("<button>{on ? '停止' : '试听'}</button>"));
  check('自检：属性里的拉丁字母不算可见文字（第一版就错在这里）',
    !hasAccessibleName('<button className="w-4 h-4 flex">{Icon}</button>'));
  check('自检：属性里含 => 也能正确剥掉（openingTagEnd 不能是 indexOf(">")）',
    !hasAccessibleName('<button onClick={() => go()} disabled={a > b}>{Icon}</button>'));
  check('自检：openingTagEnd 跳过 {} 里的 >',
    openingTagEnd('<button onClick={() => go()}>x</button>') === '<button onClick={() => go()}'.length,
    String(openingTagEnd('<button onClick={() => go()}>x</button>')));
  check('自检：属性里的 title="…" 算名称',
    hasAccessibleName('<button title="关闭">x</button>'));
  // ★ 这条自检是补写的：上面的 skipBraces bug 是靠**人工抽查**发现的
  //（`TodayTab` 里那个按钮肉眼可见有中文却被判成空），自检当时并没有抓住它。
  // 现在把那个形状固化下来：嵌套标签 + 模板串属性 + 后面还有中文文案。
  check('自检：模板串属性之后的中文仍能被读到（skipBraces 必须先减再判）',
    hasAccessibleName('<button><Plus className={`w-4 ${t.accentText}`} /><span>记录昨夜睡眠</span></button>'));
  check('自检：深层嵌套后的中文也能读到',
    hasAccessibleName('<button><span className="a"><span className="b">助眠音景</span></span></button>'));
  // ★ 这条自检是补写的：`extractButtons` 用 `indexOf('/>')` 判断自闭合，
  // 含自闭合子元素的按钮会被**截断**成第一个子元素。上面所有自检当时全绿。
  {
    const multi = '<button onClick={f}>\n  <Plus className={x} />\n  <span>记录昨夜睡眠</span>\n</button>';
    const got = extractButtons(multi);
    check('自检：含自闭合子元素的按钮不会被截断',
      got.length === 1 && /记录昨夜睡眠/.test(got[0]!), `切出 ${got.length} 段，内容=${got[0]?.slice(0, 40)}`);
    check('自检：截断问题会直接导致误判（端到端）',
      hasAccessibleName(multi), 'hasAccessibleName 对多子元素按钮返回了 false');
  }
  check('自检：切分函数能切出两个按钮',
    extractButtons('<button>a</button><button>b</button>').length === 2,
    String(extractButtons('<button>a</button><button>b</button>').length));
  check('自检：自闭合按钮也能切出',
    extractButtons('<button onClick={f} />').length === 1);
}

// ── 真实代码
const files = walk('src');
check('自检：确实扫到了组件文件（不为 0，否则整层空跑）', files.length >= 20, String(files.length));

let buttonCount = 0;
const nameless: string[] = [];
const switchesWithoutSemantics: string[] = [];

for (const f of files) {
  const src = stripComments(readFileSync(f, 'utf8'));
  const rel = f.replace(/^src[\\/]/, '');
  for (const blk of extractButtons(src)) {
    buttonCount++;
    const line = src.slice(0, src.indexOf(blk)).split('\n').length;
    if (!hasAccessibleName(blk)) {
      nameless.push(`${rel}:${line}`);
      // DBG_A11Y=1 时打印「剥掉标签与属性之后剩下什么」——
      // 判断是真·图标按钮还是解析残留，必须看得见中间结果。
      // DBG_A11Y=<文件:行> 时打印该按钮的中间结果——
      // 解析器一连串 bug 全靠看得见中间结果才定位得住。
      const dbgTarget = process.env.DBG_A11Y;
      if (dbgTarget && dbgTarget !== '1' && `${rel}:${line}` === dbgTarget) {
        const end = openingTagEnd(blk);
        console.log(`\n===== ${rel}:${line} =====`);
        console.log(`openingTagEnd = ${end}`);
        console.log(`开标签 = [${blk.slice(0, end + 1)}]`);
        console.log(`内容   = [${JSON.stringify(blk.slice(end + 1, end + 260))}]`);
        console.log(`可见文字 = [${visibleText(blk.slice(end + 1).replace(/<\/button>/g, ''))}]`);
      }
      if (process.env.DBG_A11Y === '1') {
        const end = openingTagEnd(blk);
        const inner = end < 0 ? '' : blk.slice(end + 1).replace(/<\/button>/g, '');
        console.log(`   · ${rel}:${line} 剩=[${visibleText(inner).replace(/\s+/g, ' ').trim()}]`);
      }
    }

    // 开关：靠「一个圆点在里面对称位移」实现的自绘开关，通常是 rounded-full + w-12 h-6
    const looksLikeSwitch = /rounded-full/.test(blk) && /\bw-1[0-9]\b/.test(blk) && /\bh-[567]\b/.test(blk);
    if (looksLikeSwitch && !/role="switch"/.test(blk)) {
      switchesWithoutSemantics.push(`${rel}:${line}`);
    }
  }
}

check('扫到的按钮数量合理（不是 0，也不是因为切分失败而漏掉）',
  buttonCount >= 60, `只有 ${buttonCount} 个`);

check('每个按钮都有可访问名称（读屏不该只念出「按钮」）',
  nameless.length === 0,
  nameless.length ? `这些按钮没有名称：${nameless.join('、')}` : '');

check('自绘开关带 role="switch"（否则读屏读不出开/关）',
  switchesWithoutSemantics.length === 0,
  switchesWithoutSemantics.length ? `缺少开关语义：${switchesWithoutSemantics.join('、')}` : '');

// ─────────────────────────────────────────────────────────────
// 弹窗的键盘与读屏支持。
//
// 修之前：`Escape` 在 `src/` 里出现 **0 次**（没有任何弹窗能用键盘关掉），
// 没有任何 `.focus()`（焦点从不进入弹窗，键盘用户 Tab 一遍还在被遮住的背景里），
// `role="dialog"` 只加在 2 个弹窗上且**都没有可访问名称**。
//
// 规则不是「有 role 就行」，而是**必须走共用的 hook**——
// 否则焦点与 Escape 会被逐个遗忘（本项目的「睡前习惯」缺陷就是各写一份分叉出来的）。
// ─────────────────────────────────────────────────────────────
{
  const HOOK = 'useModalA11y';
  /**
   * 弹窗判据：受控（`isOpen`）+ 铺满全屏 + **会接收交互**。
   *
   * ★ 第三项不能少。`App.tsx` 里有四个 `fixed inset-0 z-[70]` 的**护眼滤镜层**
   * （`pointer-events-none`），它们不是弹窗。
   * 少了这一条，规则会把滤镜层也要求成对话框——**误报会让护栏失去信任**。
   */
  const isModalFile = (f: string): boolean => {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/\bisOpen\b/.test(src)) return false;
    const hits = [...src.matchAll(/fixed inset-0/g)];
    if (hits.length === 0) return false;
    // 只要有一个覆盖层不是 pointer-events-none，就算弹窗
    return hits.some((m) => !/pointer-events-none/.test(src.slice(m.index!, m.index! + 200)));
  };
  const modalFiles = files.filter(isModalFile);
  check('自检：确实识别出弹窗（不为 0，否则整段空跑）',
    modalFiles.length >= 4, `只认出 ${modalFiles.length} 个`);

  const noHook: string[] = [];
  const noLabel: string[] = [];
  for (const f of modalFiles) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const rel = f.replace(/^src[\\/]/, '');
    if (!src.includes(HOOK + '(')) { noHook.push(rel); continue; }
    // label 必须是非空字符串字面量，且不能是模板串里塞变量（读屏要念得出来）
    const call = src.slice(src.indexOf(HOOK + '('), src.indexOf(HOOK + '(') + 400);
    if (!/label:\s*'[^']+'/.test(call) && !/label:\s*"[^"]+"/.test(call)) noLabel.push(rel);
  }
  check('铺满全屏的受控弹窗都走 useModalA11y（否则焦点与 Escape 会被逐个遗忘）',
    noHook.length === 0, noHook.length ? `没走 hook：${noHook.join('、')}` : '');
  check('每个弹窗都有非空的可访问名称（读屏要能说清是哪一个）',
    noLabel.length === 0, noLabel.length ? `缺名称：${noLabel.join('、')}` : '');

  // 反向：不许有原生 role="dialog" 绕开 hook（那样就没有焦点与 Escape）
  const rawDialog = files
    .filter((f) => /role="dialog"/.test(stripComments(readFileSync(f, 'utf8'))))
    .map((f) => f.replace(/^src[\\/]/, ''));
  check('没有弹窗手写 role="dialog" 绕开 hook（绕过就等于没有焦点管理）',
    rawDialog.length === 0, rawDialog.join('、'));

  // ★ 例外必须配反向自检，并且必须仍然「出得去」。
  // 睡眠会话代表一段未保存的会话，误按 Escape 会丢掉它，所以不绑 Escape；
  // 但必须有关闭按钮，否则键盘用户被关在里面。
  // ★★ 第六次「检查匹配到自己的注释」：
  // 这段说明的注释里**也写着** `closeOnEscape: false`，
  // 所以第一版用原文查代码，注释里的字被当成了代码——
  // 我把真正的 `closeOnEscape: false` 删掉做反向验证时，护栏**没有报错**。
  // 凡是「查源码里有没有某段代码」，必须先剥注释。这条已经是第六次了。
  const sleepRaw = readFileSync('src/components/ActiveSleepModal.tsx', 'utf8');
  const sleepCode = stripComments(sleepRaw);
  check('睡眠会话仍显式声明 closeOnEscape: false（例外不能悄悄消失）',
    /closeOnEscape:\s*false/.test(sleepCode), '例外没了，请一并撤销这段断言');
  check('睡眠会话的例外写了理由（否则以后会被当成笔误删掉）',
    /误按 Escape|尚未保存/.test(sleepRaw), '缺少说明');
  check('睡眠会话有关闭按钮（不绑 Escape 就必须给别的出口，否则键盘用户被困）',
    /aria-label="关闭"/.test(sleepCode), '没有带标签的关闭按钮');
  // 自检：确认「剥注释」这一步真的必要——注释里的同名文字不该被当成代码
  check('自检：注释里的 closeOnEscape: false 不算代码（否则反向验证会假通过）',
    /closeOnEscape:\s*false/.test(sleepRaw) && !/closeOnEscape:\s*false/.test(stripComments('// closeOnEscape: false\nconst x = 1;')));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  扫描 ${files.length} 个 .tsx，共 ${buttonCount} 个按钮`);
if (failures.length === 0) {
  console.log(`✅ 无障碍护栏全部通过（${pass} 项断言）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
