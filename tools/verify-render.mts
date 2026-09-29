/**
 * 渲染层动态自检
 *
 * verify-invariants.mts 只能检查「数据本身」自洽，检查不到「展示层把数据算错」。
 * 真实案例：TrendsTab 的睡眠结构堆叠条用总睡眠做分母去划分
 * 深睡/浅睡/REM/清醒 四段，四段之和 = 卧床/总睡眠 > 100%，
 * 溢出部分被外层 overflow-hidden 裁掉——数据是对的，图是错的。
 *
 * 这个脚本把组件树渲染成 HTML 字符串，然后直接断言渲染结果里的数值。
 *
 * 运行：npm run verify:render（或经由 npm run check）
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { TrendsTab } from '../src/components/TrendsTab.js';
import { SleepHypnogram } from '../src/components/SleepHypnogram.js';
import { TodayTab } from '../src/components/TodayTab.js';
import { AlarmManager } from '../src/components/AlarmManager.js';
import { APP_THEMES } from '../src/utils/themeStyles.js';
import {
  computeSleepRegularityIndex,
  computeSleepMidpoint,
  computeSocialJetlag,
} from '../src/utils/sleepRhythm.js';
import { buildSleepRecord, getInitialSleepLogs } from '../src/utils/sleepRecord.js';
import type { SleepRecord, UserProfile } from '../src/types/sleep.js';
import {
  computeSleepDebt,
  computeBedtimeRegularity,
  buildTargetTimeline,
  describeDelta,
  fromMinutesSinceNoon,
  minutesSinceNoon,
} from '../src/utils/sleepInsights.js';
import { formatDurationChinese } from '../src/utils/sleepScore.js';

/**
 * 去掉 lucide 图标，只保留图表自己的 SVG。
 *
 * 必要性：lucide 的每个图标都渲染成 `<svg class="lucide …">`，内部是
 * `<circle>/<path>/<line>`。「数数据点」这类断言如果扫全文档，就会把图标里的
 * 几何元素算进去——实测给卡片标题加了一个 Clock 图标（内部就是 `<circle r="10">`）
 * 之后，数据点数从 7 变成 8。
 *
 * 更麻烦的是它连带触发了下面那个守卫，让 9 项逐点对齐断言**静默跳过**，
 * 整套检查依然报「通过」。所以这里把图标剥掉：
 * 断言要数的是图表自己画的东西，不是装饰图标。
 */
function stripLucideIcons(html: string): string {
  return html.replace(/<svg[^>]*class="lucide[^"]*"[\s\S]*?<\/svg>/g, '');
}

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const theme = APP_THEMES.midnight;

/** 渲染一个组件，返回 HTML；把异常转成断言失败而不是让脚本崩掉 */
function render(label: string, element: React.ReactElement): string {
  try {
    return renderToString(element);
  } catch (e) {
    check(`${label} 渲染不抛异常`, false, String(e instanceof Error ? e.message : e));
    return '';
  }
}

function assertClean(label: string, html: string) {
  check(`${label} 无 NaN`, !html.includes('NaN'));
  check(`${label} 无 Infinity`, !html.includes('Infinity'));
  // 空值被拼进样式/坐标时会出现 "height:%;"、"cx=undefined" 之类
  check(`${label} 无 undefined 泄漏`, !/=\s*undefined|:\s*undefined|undefined%/.test(html));
  check(`${label} 无 null 泄漏`, !/=\s*null|:\s*null/.test(html));
}

/**
 * React 服务端渲染会在相邻文本节点之间插入 <!-- --> 分隔符（供 hydration 定位），
 * 例如「95分 · 21%」实际输出为 `<!-- -->95<!-- -->分 · <!-- -->21<!-- -->%`。
 * 凡是按可见文本做正则匹配的地方，都要先去掉这些注释。
 */
function stripComments(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

// ============ 构造边界记录 ============
// 极短睡眠：1 分钟卧床，含潜伏期，最容易触发除零与负值
const tiny = buildSleepRecord({
  date: '2026-09-28', bedtime: '07:00', wakeTime: '07:01',
  latencyMinutes: 0, wakeCount: 0, targetDurationMinutes: 480,
});

// 大量清醒：卧床 6h 却醒了 5h（清醒段会超过总睡眠，专门用来暴露分母错误）
const mostlyAwake = buildSleepRecord({
  date: '2026-09-27', bedtime: '23:00', wakeTime: '05:00',
  latencyMinutes: 60, wakeCount: 6, targetDurationMinutes: 480,
});

// 零清醒：四段里 awake 为 0
const noAwake = buildSleepRecord({
  date: '2026-09-26', bedtime: '23:30', wakeTime: '07:30',
  latencyMinutes: 0, wakeCount: 0, targetDurationMinutes: 480,
});

// 正常夜
const normal = buildSleepRecord({
  date: '2026-09-25', bedtime: '23:15', wakeTime: '07:10',
  latencyMinutes: 14, wakeCount: 2, targetDurationMinutes: 480,
});

const cases: ReadonlyArray<readonly [string, SleepRecord]> = [
  ['极短睡眠(1分钟)', tiny],
  ['大量清醒(卧床6h醒5h)', mostlyAwake],
  ['零清醒', noAwake],
  ['正常一夜', normal],
];

// ============ TrendsTab：空列表 ============
{
  const html = render('TrendsTab(空记录)', React.createElement(TrendsTab, { records: [], theme }));
  assertClean('TrendsTab(空记录)', html);
  check('TrendsTab(空记录) 渲染出骨架', html.length > 0, 'HTML 为空');
}

// ============ TrendsTab：逐条边界记录 ============
for (const [label, record] of cases) {
  const html = render(`TrendsTab(${label})`, React.createElement(TrendsTab, { records: [record], theme }));
  assertClean(`TrendsTab(${label})`, html);
}

// ============ TrendsTab：睡眠结构堆叠条的分母必须是卧床时长 ============
// 这是本文件存在的主要理由：四段必须恰好铺满 100%，否则一定会被裁切。
{
  const records = cases.map(([, r]) => r);
  const html = render('TrendsTab(4条边界记录)',
    React.createElement(TrendsTab, { records, theme, initialViewMode: 'stages' }));

  // 分段由 data-stage 定位。原先靠 style="height:N%" 反推，但 3.1 之后
  // 柱容器本身也带 height:%（用它编码当晚卧床时长），于是容器会被当成
  // 第 5 段，四段之和随之算成 193% 之类。属性匹配不受结构变化影响。
  const segTags = [...html.matchAll(/<div[^>]*data-stage="(deep|light|rem|awake)"[^>]*>/g)].map((m) => m[0]);
  const segHeights = segTags.map((t) => {
    const m = t.match(/height:([\d.]+)%/);
    return m ? Number(m[1]) : NaN;
  });

  check('堆叠条分段数为 4×记录数', segTags.length === records.length * 4,
    `期望 ${records.length * 4} 段，实际 ${segTags.length} 段`);

  const totalDays = Math.floor(segHeights.length / 4);
  for (let d = 0; d < totalDays; d++) {
    const group = segHeights.slice(d * 4, d * 4 + 4);
    const sum = group.reduce((a, b) => a + b, 0);
    // 浮点误差容忍 0.05%
    check(`第 ${d + 1} 天睡眠结构四段之和 = 100%`, Math.abs(sum - 100) < 0.05,
      `实际 ${sum.toFixed(2)}%（${group.map((g) => g.toFixed(1)).join(' + ')}）——分母用错会导致 >100% 被裁切`);
  }

  // ---- 柱高必须编码当晚卧床时长 ----
  // 曾经每根柱子都写死 h-20，高度完全相同，于是「哪晚睡得少」在这张图上
  // 完全看不出来。现在柱高 = 卧床时长归一，所以：最长的一晚占满 100%，
  // 且各柱高度之比必须等于各自卧床时长之比。
  const barHeights = [...html.matchAll(/<div style="height:([\d.]+)%"[^>]*class="[^"]*overflow-hidden flex flex-col-reverse/g)]
    .map((m) => Number(m[1]));
  if (barHeights.length === records.length) {
    const distinct = new Set(barHeights.map((h) => h.toFixed(1)));
    check('柱高不再恒定（高度通道用于编码时长）', distinct.size > 1,
      `出现 ${distinct.size} 种高度：${[...distinct].join(', ')}——若为 1 说明又退回等高柱`);

    // 组件会先按日期倒序取近 7 条、再 reverse 成时间正序来画，
    // 所以这里的卧床时长序列必须按同样的顺序排，否则比值对不上。
    const ordered = [...records].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const tibs = ordered.map((r) => r.durationMinutes + r.awakeMinutes);
    const maxTib = Math.max(...tibs);
    const maxBar = Math.max(...barHeights);
    check('最高的一晚柱高 = 100%', Math.abs(maxBar - 100) < 0.05, `实际 ${maxBar.toFixed(2)}%`);

    const ratiosOk = barHeights.every((h, i) => {
      const expected = Math.max(12, (tibs[i] / maxTib) * 100);
      return Math.abs(h - expected) < 0.05;
    });
    check('柱高与卧床时长成正比', ratiosOk,
      `柱高 ${barHeights.map((h) => h.toFixed(1)).join(', ')} vs 卧床 ${tibs.join(', ')} 分钟`);
  } else {
    check('柱高必须编码当晚卧床时长', false,
      `找到 ${barHeights.length} 根柱子，期望 ${records.length} 根`);
  }

  // ---- 图例顺序必须与堆叠顺序一致 ----
  // 柱子用 flex-col-reverse，DOM 里第一个子元素画在最下面，所以 DOM 顺序
  // 就是「自下而上」的顺序。图例若按另一个顺序排（曾经是 深睡/REM/浅睡/清醒），
  // 读者会以为图例是从上往下对应的，把浅睡当成 REM。
  const colorOf = (tag: string): string | null => {
    const inline = tag.match(/background-color:(#[0-9a-fA-F]{3,8})/);
    if (inline) return inline[1].toLowerCase();
    const cls = tag.match(/class="[^"]*\b(bg-[a-z]+-\d+)\b[^"]*"/);
    return cls ? cls[1] : null;
  };

  const stackTags = segTags;
  const swatchTags = [...html.matchAll(/<span[^>]*w-2\.5 h-2\.5 rounded-sm[^>]*>/g)].map((m) => m[0]);

  check('找到 4 个图例色块', swatchTags.length === 4, `实际 ${swatchTags.length} 个`);

  if (stackTags.length >= 4 && swatchTags.length === 4) {
    const stackSeq = stackTags.slice(0, 4).map(colorOf);
    const legendSeq = swatchTags.map(colorOf);
    check('图例颜色顺序与柱子堆叠顺序一致',
      JSON.stringify(stackSeq) === JSON.stringify(legendSeq),
      `柱子(自下而上) ${stackSeq.join(' → ')} vs 图例 ${legendSeq.join(' → ')}`);

    const clean = stripComments(html);
    const legendRegion = clean.slice(
      clean.indexOf('justify-center gap-3'),
      clean.indexOf('模型估算值')
    );
    const order = ['深睡', '浅睡', 'REM', '清醒'].map((l) => legendRegion.indexOf(l));
    check('图例标签顺序 = 深睡→浅睡→REM→清醒',
      order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])),
      `在界面中出现的下标为 ${order.join(', ')}，应按堆叠顺序递增且都存在`);
  }
}

// ============ SleepHypnogram：逐条边界记录 ============
for (const [label, record] of cases) {
  const html = render(`SleepHypnogram(${label})`, React.createElement(SleepHypnogram, { record, theme }));
  assertClean(`SleepHypnogram(${label})`, html);
  check(`SleepHypnogram(${label}) 有分期图元`, html.includes('<svg'), '未渲染出 SVG');
}

// ============ SleepHypnogram：无分期数据也不能崩 ============
{
  const noStages: SleepRecord = { ...normal, stages: [] };
  const html = render('SleepHypnogram(无分期)', React.createElement(SleepHypnogram, { record: noStages, theme }));
  assertClean('SleepHypnogram(无分期)', html);
}

// ============ SleepHypnogram：推演的分期值不得对照临床目标数值 ============
// 真实缺陷（第五轮漏掉、靠截图才发现）：图例的深睡格写着「目标 18%」、REM 格写着「目标 20%」。
// 这两个百分比来自 sleepRecord.ts 的**推演分期**（先造分期再倒推总时长），
// 拿它们去对照临床目标数值，就是「界面声称了代码做不到的事」的同一形状。
//
// 为什么放在**渲染层**查：文案护栏按字符串字面量/JSX 文本节点提取，
// 「深睡」和「目标 18%」是同一个 <div> 里两个独立文本节点，按字符串根本配不到一起。
// 只有把组件渲染出来，才能看到屏幕上真正并排的是什么。
{
  const withStages: SleepRecord = { ...normal, stages: normal.stages, deepSleepMinutes: 95, remSleepMinutes: 96 };
  const html = render('SleepHypnogram(推演值标注)', React.createElement(SleepHypnogram, { record: withStages, theme }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  check('图例不再给推演的分期值标临床目标数值', !/目标\s*\d+(\.\d+)?%/.test(text),
    `渲染文本里出现了「目标 NN%」：${(text.match(/目标\s*\d+(\.\d+)?%/g) || []).join('、')}`);
  check('深睡格标注了推演性质', /深睡[\s\S]{0,120}?推演/.test(text), text.slice(0, 200));
  check('REM 格标注了推演性质', /REM[\s\S]{0,120}?推演/.test(text), text.slice(0, 200));
  // 反向：这条检查不能是空跑——图例里必须真的有深睡和 REM 两格
  check('图例确实渲染了深睡与 REM（否则上面的检查空跑）',
    text.includes('深睡') && text.includes('REM'), '');
}

// ============ TodayTab × SleepHypnogram：深睡占比必须同口径 ============
// 真实缺陷：报告卡以「总睡眠」为分母显示 21%，下方统计块以「卧床」为分母显示 20%——
// 同一屏同一个指标出现两个数；而统计块还拿这个数去对照「目标 >18%」，
// 可临床目标区间（深睡约 13–23%）是按总睡眠定义的。口径不一直接毁掉数据可信度。
{
  const profile = {
    name: '体验用户',
    targetBedtime: '23:30',
    targetDurationHours: 8,
  } as unknown as UserProfile;
  const noop = () => {};

  for (const [label, record] of cases) {
    const todayHtml = render(`TodayTab(${label})`, React.createElement(TodayTab, {
      records: [record],
      userProfile: profile,
      theme,
      onOpenActiveSleep: noop,
      onOpenManualLog: noop,
    }));
    const hypnoHtml = render(`SleepHypnogram(${label})`,
      React.createElement(SleepHypnogram, { record, theme }));

    // TodayTab：「深睡阶段 推演 95分 · 21%」
    // 注意：标签后多了一个「推演」来源标记的 span，所以这里不能再用
    // `深睡阶段</span>` 这种紧邻匹配——那是断言写法，不是被测结构的一部分。
    const todayPct = stripComments(todayHtml)
      .match(/深睡阶段[\s\S]{0,240}?<\/span><span[^>]*>\d+分 · (\d+)%</)?.[1];
    // 深睡是推演值而不是实测值，首页必须在指标处自曝来源。
    // 只在页脚写一句「模型估算值」不够：那一行看起来和上面的实测指标完全一样。
    check(
      `首页在深睡指标处标注来源（${label}）`,
      /深睡阶段[\s\S]{0,200}?推演/.test(stripComments(todayHtml)),
      '深睡行没有「推演」标记，用户会以为这是测出来的'
    );
    // SleepHypnogram 的深睡统计块：占比与来源标记是两个 span——
    // 大字「21%」+ 小字「推演·不可比」（原来写成一串「21% (目标>18%)」，四列窄格里必定折行）。
    //
    // ★★ 这里原本有一条断言**要求「目标 18%」必须存在**：
    //      check(`分期块写明深睡临床目标`, hypnoTarget === '18',
    //        `…但它是「21% 算不算好」的唯一依据`);
    //    这是第四轮那条教训的**第二次出现——断言把实现的 bug 锁住了**。
    //    深睡是推演值（sleepRecord.ts 先造分期再倒推总时长），
    //    「21% 算不算好」这个问题本身就不该由临床目标回答；
    //    那条断言不是在保护一个性质，而是在保护一个缺陷，连报错文案都复述了错误前提。
    //
    //    发现方式：**先删掉被测代码，再看有没有断言变红**。
    //    （删之前永远先问一句：有没有哪条断言正在撑着我删的东西？）
    const hypnoMatch = stripComments(hypnoHtml)
      .match(/>([\d.]+)%<\/span><span[^>]*>(推演·不可比)</);
    const hypnoPct = hypnoMatch?.[1];
    const hypnoMark = hypnoMatch?.[2];
    check(`分期块自曝深睡是推演值（${label}）`, hypnoMark === '推演·不可比',
      `实际 ${hypnoMark ?? '未解析'}——推演值必须在指标处说明来源，不能看起来像实测`);
    check(`分期块不拿推演值对照临床目标（${label}）`,
      !/目标\s*\d+(\.\d+)?%/.test(stripComments(hypnoHtml)),
      '深睡是两个数字里唯一带「临床目标」的那个块，但它测不到');
    const expected = record.durationMinutes > 0
      ? Math.round((record.deepSleepMinutes / record.durationMinutes) * 100)
      : 0;

    check(`深睡占比跨组件一致（${label}）`, todayPct !== undefined && todayPct === hypnoPct,
      `报告卡 ${todayPct ?? '未解析'}% vs 分期块 ${hypnoPct ?? '未解析'}%`);
    check(`深睡占比为占总睡眠（${label}）`, hypnoPct === String(expected),
      `期望 ${expected}%，实际 ${hypnoPct ?? '未解析'}%`);
  }
}

// ============ TodayTab：按时段状态卡 / 真实月相 / 一句话总结必须真的渲染出来 ============
// 这三项的逻辑在 verify-insights 里已单独测过，但没人验证界面真的把它们显示出来
// ——组件里漏接一个 prop、或者干脆忘了渲染，逻辑层全绿也照样是空白。
{
  // OneTapSleepTracker 初始化时要读 localStorage，Node 里没有这个全局对象。
  // 垫一个最小实现，只为让这张卡能渲染出来，不改变组件行为。
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };

  const noop = () => {};
  const one = [getInitialSleepLogs()[0]];

  const renderToday = (label: string, targetBedtime: string) =>
    render(label, React.createElement(TodayTab, {
      records: one,
      userProfile: {
        name: '体验用户', targetBedtime, targetWakeTime: '07:30', targetDurationHours: 8,
      } as unknown as UserProfile,
      theme,
      onOpenActiveSleep: noop,
      onOpenManualLog: noop,
      onSaveRecord: noop,
    }));

  // 把目标就寝沿「距正午」轴整圈扫一遍（每小时一个）。这样无论测试在什么
  // 时候跑，diff = 目标 − 当前 都会覆盖 白天 / 倒计时 / 已超过 三个档位。
  //
  // 原先用 `now − 25 分钟` 构造超时态，只在傍晚成立：正午跑的时候，往回 25 分钟
  // 会跨过「距正午」轴的间断点、落到 23.6 小时之后，于是走白天分支，测试变红。
  // 那是**测试自己的缺陷**——正午前后本来就不存在「刚刚超过目标就寝」这个状态。
  // 状态机本身没问题，verify-insights 用模拟钟点覆盖了全部档位与单向推进。
  const sinceNoonNow = ((new Date().getHours() - 12 + 24) % 24) * 60 + new Date().getMinutes();
  /** 距正午的分钟数 → HH:MM。注意 noon=0（不是午夜=0），别和 hhmm 混用。 */
  const hhmmFromNoon = (m: number) => {
    const x = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${String((Math.floor(x / 60) + 12) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  const headlineOf = (h: string) => /<h3[^>]*>([^<]*)<\/h3>/.exec(h)?.[1] ?? '';
  const sweep = Array.from({ length: 24 }, (_, i) =>
    renderToday(`TodayTab(目标扫描 ${i})`, hhmmFromNoon(sinceNoonNow + i * 60)));
  const headlines = sweep.map(headlineOf);
  const findState = (kw: string) => headlines.find((h) => h.includes(kw));

  // 渲染层在这里**只断言与挂钟无关的性质**。
  //
  // 为什么不断言「三档都出现」：状态用的是「距正午」轴，这条轴在正午有断点。
  // 正午时「最近 4 分钟」会绕进下一周期被算成约 24 小时之后，所以那一刻
  // 根本不存在「刚刚超过目标就寝」；反过来 11 点前后又不存在「临近就寝」。
  // 实测扫过 24 个钟点：三档同时出现只在其中 23 个成立，总有一个钟点缺一档。
  // 三档的完整覆盖由 verify-insights 用**模拟钟点**负责（直接喂 now，与真实
  // 时间无关），那才是它该待的层。这里只验证「组件真的把状态接了进去」。
  check('就寝卡文案随目标时间变化（不是静态文案）', new Set(headlines).size >= 2,
    `24 个目标只渲染出 ${new Set(headlines).size} 种文案：${[...new Set(headlines)].join(' / ')}`);
  // 每一档文案都必须来自状态机，不能是拼出来的野字符串
  const DUR = '\\d+(?:分钟|小时(?:\\d+分)?)?';  // 「30分钟」「1小时」「1小时30分」
  const VALID_HEADLINE = new RegExp(`^(?:已超过目标就寝 ${DUR}|到目标就寝时间了|距目标就寝 ${DUR}|今晚目标 \\d{2}:\\d{2} 就寝|今晚准备入睡)$`);
  const invalid = headlines.filter((h) => !VALID_HEADLINE.test(h));
  check('每一档文案都来自状态机（无野字符串、无空标题）', invalid.length === 0,
    `异常文案：${invalid.map((h) => `「${h}」`).join(' ')}`);
  // 正好到点时不能说「已超过 0 分钟」
  check('不会出现「已超过目标就寝 0分钟」', !headlines.some((h) => /已超过目标就寝\s*0(分钟|分)?$/.test(h)),
    `出现了：${headlines.find((h) => /已超过目标就寝\s*0/.test(h))}`);
  check('超时态写出了具体超出多少分钟',
    /已超过目标就寝\s*[1-9]\d*/.test(findState('已超过目标就寝') ?? '')
      || findState('已超过目标就寝') === undefined,
    `超时态文案：「${findState('已超过目标就寝') ?? '(本次钟点未出现该档，属预期)'}」`);
  check('白天态写出了目标就寝钟点',
    /今晚目标\s*\d{2}:\d{2}\s*就寝/.test(findState('今晚目标') ?? ''),
    `白天态没写出钟点：「${findState('今晚目标') ?? '(无)'}」`);

  // 月相与目标时间无关，取两份渲染结果即可
  const overdue = sweep[0];
  const daytime = sweep[12];

  // 真实月相：与日期同步，必须带月相名与月龄
  check('就寝卡显示真实月相与月龄',
    /今夜(新月|娥眉月|上弦月|盈凸月|满月|亏凸月|下弦月|残月) · 月龄 [\d.]+ 天/.test(overdue),
    '未渲染出月相名与月龄');
  check('月相不是画死的（含按日期算出的月龄数字）',
    /月龄 [\d.]+ 天/.test(overdue) && /月龄 [\d.]+ 天/.test(daytime),
    '两处都没有月龄数字');

  // 一句话总结：报告卡顶部先给判断，再给数据表。
  // 它只该说表格里没有的东西（与目标的差值、本周极值）。原来把总睡眠和效率
  // 也复述进来，正下方数据表里就有同样的两个数字，读者要对照两组相同的数。
  const summarySeg = /(睡得不错|整体还可以|睡得一般|睡得偏少)[^<]*/.exec(overdue)?.[0] ?? '';
  check('报告卡顶部渲染了一句话总结', summarySeg.length > 0,
    '未渲染出总结句的开场判断');
  check('总结句不复述正下方数据表里的数字',
    summarySeg.length > 0
      && summarySeg.length <= 52
      && !summarySeg.includes('效率')
      && !summarySeg.includes('总睡眠'),
    `总结句 ${summarySeg.length} 字：「${summarySeg}」——复述表格里的数字会让这一行变长一倍`);
  check('总结句出现在数据表之前（先给判断）',
    overdue.indexOf(summarySeg) >= 0 && overdue.indexOf(summarySeg) < overdue.indexOf('总睡眠时长'),
    '总结句被排在数据表之后，读者仍要先读数字');

  // 目标时间脏数据不能崩，也不能显示假的比较
  const dirty = renderToday('TodayTab(目标时间非法)', '不是时间');
  check('目标就寝时间非法时仍能渲染且给出回退文案',
    dirty.includes('今晚准备入睡'),
    '目标时间非法时应回退为静态文案而不是崩掉或算出假数字');

  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

// ============ SleepHypnogram：清醒占比必须写明分母 ============
// 清醒不属于总睡眠。若与深睡/浅睡/REM 并排显示却不标分母，
// 读者会以为四者同基准，而实际上四段之和只会等于卧床。
{
  const html = render('SleepHypnogram(分母标注)',
    React.createElement(SleepHypnogram, { record: normal, theme }));
  check('清醒占比写明了「占卧床」分母', html.includes('占卧床'),
    '清醒占比未标注分母，会与占总睡眠的三个占比混淆');
  check('睡眠结构说明了两种分母并存',
    html.includes('总睡眠时长') && html.includes('卧床时长'),
    '未在界面上说明各占比分别以什么为分母');
  // 堆叠条已被「昨夜 vs 目标」时间轴取代，脚注不能再提「上方堆叠条」
  check('脚注不再引用已删除的堆叠条', !html.includes('上方堆叠条'),
    '堆叠条已换成时间轴，脚注仍说「上方堆叠条」会指向不存在的东西');
}

// ============ SleepHypnogram：给了目标时间就必须画时间轴而不是堆叠条 ============
// 原先泳道图下面那条四色堆叠条与泳道图、阶段方块三方重复。
{
  const tl = buildTargetTimeline(normal.bedtime, normal.wakeTime, '23:30', '07:30')!;
  const withTargets = render('SleepHypnogram(带目标时间)',
    React.createElement(SleepHypnogram, {
      record: normal, theme, targetBedtime: '23:30', targetWakeTime: '07:30',
    }));
  const withoutTargets = render('SleepHypnogram(无目标时间·回退堆叠条)',
    React.createElement(SleepHypnogram, { record: normal, theme }));

  const stackedBarTag = /h-2\.5 w-full bg-slate-800 rounded-full overflow-hidden flex/;

  check('带目标时间时渲染时间轴', withTargets.includes('昨夜 vs 目标'),
    '未出现时间轴标题');
  check('带目标时间时不再渲染堆叠条', !stackedBarTag.test(withTargets),
    '时间轴与堆叠条同时出现，信息重复');
  check('不带目标时间时回退到堆叠条（组件仍可单独使用）', stackedBarTag.test(withoutTargets),
    '无目标时间时应回退，而不是留一块空白');

  // 就寝/起床各一根刻度 + 一段实际区间
  const tickPositions = [...withTargets.matchAll(/title="目标(就寝|起床) (\d{2}:\d{2})"/g)];
  check('时间轴上目标就寝与起床各一根刻度', tickPositions.length === 2,
    `实际 ${tickPositions.length} 根`);
  check('刻度标注了目标钟点',
    withTargets.includes('目标就寝 23:30') && withTargets.includes('目标起床 07:30'),
    '刻度缺少钟点说明');

  // 关键几何：实心条左端必须在目标就寝刻度之前（本用例实际比目标早睡）
  const barLeft = /left:([\d.]+)%;width:([\d.]+)%;background-color/.exec(withTargets);
  check('实际睡眠区间用 left/width 定位', barLeft !== null, '未找到实心条');
  if (barLeft) {
    check('实际区间左端位置与计算一致',
      Math.abs(Number(barLeft[1]) - tl.actualStartPct) < 0.01,
      `渲染 ${barLeft[1]}% vs 计算 ${tl.actualStartPct.toFixed(2)}%`);
    check('实际区间宽度与计算一致',
      Math.abs(Number(barLeft[2]) - (tl.actualEndPct - tl.actualStartPct)) < 0.01,
      `渲染 ${barLeft[2]}% vs 计算 ${(tl.actualEndPct - tl.actualStartPct).toFixed(2)}%`);
    check('实心条不贴轨道边缘（两侧留白）',
      Number(barLeft[1]) > 0 && Number(barLeft[1]) + Number(barLeft[2]) < 100,
      `left ${barLeft[1]}% + width ${barLeft[2]}% = ${(Number(barLeft[1]) + Number(barLeft[2])).toFixed(1)}%`);
  }

  check('时间轴写明就寝与起床相对目标的早晚',
    withTargets.includes(describeDelta(tl.bedDeltaMinutes))
    && withTargets.includes(describeDelta(tl.wakeDeltaMinutes)),
    `期望出现「${describeDelta(tl.bedDeltaMinutes)}」与「${describeDelta(tl.wakeDeltaMinutes)}」`);

  // 时间非法时必须回退，而不是画一条错的时间轴
  const dirtyTargets = render('SleepHypnogram(目标时间非法)',
    React.createElement(SleepHypnogram, {
      record: normal, theme, targetBedtime: '不是时间', targetWakeTime: '07:30',
    }));
  check('目标时间非法时回退到堆叠条而不是画错的时间轴',
    stackedBarTag.test(dirtyTargets) && !dirtyTargets.includes('昨夜 vs 目标'),
    '脏数据应回退，不能渲染出位置错误的时间轴');
}

// ============ TrendsTab 得分曲线：日期标签必须对在数据点下方 ============
// 真实缺陷：标签行用 justify-between，把首尾标签的「边缘」贴到两端，
// 而数据点中心在 0% / 100%——实测首尾各错开 15.1px，中间的标签偏移为 0，
// 所以只看中间会以为没问题。
{
  const demoRecords = getInitialSleepLogs();
  const html = render('TrendsTab(7条演示数据·标签对齐)',
    React.createElement(TrendsTab, { records: demoRecords, theme }));

  const cxs = [...stripLucideIcons(html).matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  // 居中不仅靠 left，还靠 -translate-x-1/2 把标签自身宽度抵消掉；
  // 只断言 left 的话，删掉居中变换不会被发现。
  const labelTags = [...html.matchAll(/<span[^>]*style="left:[\d.]+%"[^>]*>/g)].map((m) => m[0]);
  // 日期标签就是这些带 left 的 <span>。不能再用「全文档里所有 style="left:N%"」
  // 来计数：就寝规律性卡也用 left 绝对定位（分布带、均值线、每晚一个点），
  // 会把那些一起数进来（实测从 7 变成 16）。
  const lefts = labelTags.map((t) => Number(/style="left:([\d.]+)%"/.exec(t)![1]));

  check('得分曲线日期标签数 = 记录数', lefts.length === demoRecords.length,
    `期望 ${demoRecords.length} 个，实际 ${lefts.length} 个`);
  check('得分曲线数据点数 = 记录数', cxs.length === demoRecords.length,
    `期望 ${demoRecords.length} 个，实际 ${cxs.length} 个`);
  check('得分曲线日期标签自身水平居中', labelTags.length > 0
    && labelTags.every((t) => t.includes('-translate-x-1/2')),
    '标签缺少 -translate-x-1/2：left 定位的是标签左边缘而不是中心，仍会与数据点错开半个标签宽');

  // 前置条件必须显式断言。原来只在 if 里判断，条件不成立时下面 9 项断言
  // 会整块消失，而输出仍然是「通过」——检查器失效最难发现的就是这种形态。
  check('数据点与日期标签数量齐备（逐点对齐断言的前提）',
    lefts.length === demoRecords.length && cxs.length === demoRecords.length,
    `标签 ${lefts.length} / 数据点 ${cxs.length} / 记录 ${demoRecords.length}：数量不齐会让下面 ${demoRecords.length + 2} 项断言整块跳过`);

  if (lefts.length === demoRecords.length && cxs.length === demoRecords.length) {
    // 相邻标签间距必须一致（不硬编码具体百分比，只要求等距，
    // 这样调整两侧留白不会误报）
    const gaps = lefts.slice(1).map((v, i) => +(v - lefts[i]).toFixed(4));
    const gapOk = gaps.every((g) => Math.abs(g - gaps[0]) < 0.01);
    check('得分曲线日期标签等距排布', gapOk,
      `各间距 ${gaps.join(', ')} 不相等`);

    for (let i = 0; i < lefts.length; i++) {
      const pointPct = (cxs[i] / 280) * 100;
      check(`第 ${i + 1} 个日期标签与数据点同列`, Math.abs(lefts[i] - pointPct) < 0.01,
        `标签 ${lefts[i]}% vs 数据点 ${pointPct.toFixed(4)}%`);
    }

    // 首尾标签必须留出自身一半宽度，否则会跨出图表内框边框（实测曾溢出 2.1px）
    check('首尾日期标签不贴边', lefts[0] >= 3 && lefts[lefts.length - 1] <= 97,
      `首 ${lefts[0]}% / 末 ${lefts[lefts.length - 1]}%：贴边会让居中的标签跨出内框边框`);
  }
}

// ============ TrendsTab 得分曲线：参考线位置必须真的等于它标注的分数 ============
// 真实缺陷：参考线用 CSS 的 top-4 / top-18 硬定位，数据却走 scoreY() 映射到
// viewBox 的 y∈[10,70]。两套坐标互不相干，换算后「90分」线落在坐标轴顶边之上、
// 「75分」线落在约 69 分处——标注与位置完全对不上。
{
  const demoRecords = getInitialSleepLogs();
  const html = render('TrendsTab(7条演示数据·参考线)',
    React.createElement(TrendsTab, { records: demoRecords, theme }));

  const axis = stripComments(html).match(/纵轴 (\d+)[–-](\d+) 分/);
  check('得分曲线标注了纵轴范围', axis !== null, '未能从渲染结果解析出纵轴范围');

  if (axis) {
    const axisLo = Number(axis[1]);
    const axisHi = Number(axis[2]);
    const span = Math.max(1, axisHi - axisLo);
    const yOf = (s: number) =>
      80 - ((Math.max(axisLo, Math.min(axisHi, s)) - axisLo) / span) * 60 - 10;

    // 按描边颜色定位参考线，而不是靠「标签前面最近的一个 y1」。
    // 后者原本能用，但标签挪到最后绘制后就取到了另一条线——断言会报出误导性的值。
    const lineYByColor = (hex: string): number | null => {
      const tag = html.match(new RegExp(`<line[^>]*stroke="${hex}"[^>]*>`))?.[0];
      if (!tag) return null;
      const y = tag.match(/y1="(-?[\d.]+)"/);
      return y ? Number(y[1]) : null;
    };

    for (const [score, label, hex] of [
      [90, '90分 达标线', '#10b981'],
      [75, '75分 警戒线', '#64748b'],
    ] as const) {
      const inRange = score >= axisLo && score <= axisHi;
      const actual = lineYByColor(hex);

      check(`${label} 只在轴范围内渲染`,
        inRange ? actual !== null : actual === null,
        inRange
          ? `纵轴 ${axisLo}–${axisHi} 包含 ${score}，参考线缺失`
          : `纵轴 ${axisLo}–${axisHi} 不含 ${score}，不应渲染参考线`);

      if (inRange && actual !== null) {
        check(`${label} 的位置等于 ${score} 分`, Math.abs(actual - yOf(score)) < 0.01,
          `y1=${actual}，按当前纵轴应为 ${yOf(score).toFixed(2)}`);
      }
    }
  }
}

// ============ TrendsTab：睡眠负债与就寝规律性卡的数值必须与计算一致 ============
// 这两块是新加的信息，算错了不会有任何报错——只会安静地显示一个错数字。
{
  const demoRecords = getInitialSleepLogs();
  const html = render('TrendsTab(7条演示数据·负债与规律性)',
    React.createElement(TrendsTab, { records: demoRecords, theme, targetDurationMinutes: 480 }));

  const debt = computeSleepDebt(demoRecords, 480);
  const reg = computeBedtimeRegularity(demoRecords);
  const deficitNights = demoRecords.filter((r) => r.durationMinutes < 480).length;

  check('负债卡显示累计缺口', html.includes(formatDurationChinese(debt.shortfallMinutes)),
    `期望出现「${formatDurationChinese(debt.shortfallMinutes)}」，缺口 ${debt.shortfallMinutes} 分钟`);
  check('负债写明有几晚没睡够', html.includes(`${deficitNights} 晚没睡够目标`),
    `期望出现「${deficitNights} 晚没睡够目标」`);
  check('负债卡说明盈余不能抵扣缺口', html.includes('不抵扣缺口'),
    '缺口与盈余必须分开说，否则读者会以为多睡一晚能抵掉欠的觉');

  check('规律性卡显示波动幅度', reg !== null && html.includes(`±${Math.round(reg.stdDevMinutes)} 分钟`),
    `期望「±${reg ? Math.round(reg.stdDevMinutes) : '?'} 分钟」`);
  check('规律性卡显示平均就寝时间', reg !== null && html.includes(reg.meanBedtime),
    `期望出现平均就寝时间 ${reg?.meanBedtime}`);
  check('规律性卡标出最早与最晚就寝', reg !== null
    && html.includes(fromMinutesSinceNoon(reg.minMinutes))
    && html.includes(fromMinutesSinceNoon(reg.maxMinutes)),
    '分布带两端必须有钟点标注，否则那些点没有参照');
  check('规律性卡给出可执行的建议', /继续保持|固定就寝时间|先把就寝时间固定下来/.test(html),
    '只给数字不给建议，读者不知道该怎么办');

  // 分布带上每个点的位置。只数点是不够的：位置算错不会有任何报错。
  // 这里断言一个与实现无关的性质——点的左右顺序必须与就寝时间的先后一致。
  // 跨午夜处理一旦出错（把 01:05 当成 65 而不是 785 分钟），01:05 的点会跳到
  // 最左边，这个顺序立刻崩掉。
  const dotPairs = [...html.matchAll(/style="left:([\d.]+)%"[^>]*title="(\d{2}-\d{2} \d{2}:\d{2})"/g)]
    .map((m) => ({ pct: Number(m[1]), label: m[2], time: m[2].slice(6) }));
  check('能解析出分布带上的点及其对应日期', dotPairs.length === demoRecords.length,
    `解析到 ${dotPairs.length} 个，期望 ${demoRecords.length}`);

  if (dotPairs.length >= 2) {
    check('所有点都在 0%–100% 之间', dotPairs.every((d) => d.pct >= 0 && d.pct <= 100),
      dotPairs.map((d) => `${d.time}=${d.pct}`).join(' '));

    // 关键：这里的「睡前时刻」键必须在测试侧独立实现，绝不能复用被测代码的
    // minutesSinceNoon —— pct 就是那个函数的仿射变换，用它来排序与按 pct 排序
    // 恒等，这条断言会永远通过（我第一版就是这么写的，去掉跨午夜处理后
    // 它照样全绿，等于没测）。下面这个键把凌晨算成 24 点之后，是另一套实现。
    const sleepOrderKey = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return (h >= 12 ? h : h + 24) * 60 + m;
    };
    // 渲染顺序是记录顺序（与位置无关），所以两边各自排序再比。
    const byPct = [...dotPairs].sort((a, b) => a.pct - b.pct).map((d) => d.time);
    const byOrder = [...dotPairs]
      .sort((a, b) => sleepOrderKey(a.time) - sleepOrderKey(b.time))
      .map((d) => d.time);
    check('按位置排序与按睡前时刻排序结果一致（跨午夜也成立）',
      byPct.join(',') === byOrder.join(','),
      `按位置 ${byPct.join(' ')} / 按睡前时刻 ${byOrder.join(' ')}`);

    // 再补一条更直白的：01:05 在墙钟上晚于 23:00，它的点必须更靠右。
    // 跨午夜一错，这两点会左右颠倒。
    const lateDot = dotPairs.find((d) => d.time === '01:05');
    const earlyDot = dotPairs.find((d) => d.time === '23:00');
    if (lateDot && earlyDot) {
      check('凌晨 01:05 的点比 23:00 的点更靠右',
        lateDot.pct > earlyDot.pct,
        `01:05 在 ${lateDot.pct}%，23:00 在 ${earlyDot.pct}%——凌晨被当成了一天里最早的时刻`);
    }

    // 平均线必须落在最早与最晚之间，否则带子画反了
    // 平均线是唯一同时带 left 与 background-color 的元素（色带用 className 上色）
    const meanPct = Number(/style="left:([\d.]+)%;background-color/.exec(html)?.[1] ?? NaN);
    check('能找到平均就寝线', Number.isFinite(meanPct), '未匹配到 left+background-color 的组合');
    if (Number.isFinite(meanPct)) {
      const minPct = Math.min(...dotPairs.map((d) => d.pct));
      const maxPct = Math.max(...dotPairs.map((d) => d.pct));
      check('平均就寝线落在最早与最晚之间', meanPct >= minPct && meanPct <= maxPct,
        `平均线 ${meanPct}% 不在 ${minPct}%–${maxPct}% 之间`);
    }
  }
}

// 全部达标时不应显示负债数字，而要明确说「无负债」
{
  const demoRecords = getInitialSleepLogs();
  const html = render('TrendsTab(目标宽松·无负债)',
    React.createElement(TrendsTab, { records: demoRecords, theme, targetDurationMinutes: 300 }));
  check('无缺口时显示「无负债」而不是 0 分钟', html.includes('无负债'),
    '目标 300 分钟时演示数据应无缺口');
}

// 记录不足时不能把「算不出波动」显示成「波动为 0」（那会被读成非常规律）
{
  const one = [getInitialSleepLogs()[0]];
  const html = render('TrendsTab(仅1条记录)', React.createElement(TrendsTab, { records: one, theme }));
  check('记录不足时明确提示，而不是显示 ±0 分钟',
    html.includes('记录不足') && !html.includes('±0 分钟'),
    '一晚算不出波动，显示 ±0 会被读成「非常规律」');
}

// ============ AIAdvicePanel：无法在本层覆盖 ============
// AIAdvicePanel 静态依赖 utils/localLlmEngine，后者有
//   import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
// 「?url」是 Vite 专有语法，tsx/Node 会把它当成真模块去解析并报
// ERR_MODULE_NOT_FOUND（还会把 .wasm 当 JS 解析）。要在这里渲染它，就得把端侧
// LLM 的 wasm 改成动态导入——为一个布局断言去动推理路径不划算。
//
// 所以该面板的两处布局缺陷（快捷提问 chip 被截断、评估按钮文字换行）由
// design-review/shoot-screenshots.mjs 的真实浏览器截图覆盖，不进 CI 断言。

// ============ 作息节律卡：SRI / 睡眠中点 / 社交时差 ============
// 指标本身的算法正确性由 verify:rhythm 用独立 oracle 兜底（那里有 88 项断言，
// 包括「与参考文献公式的直接实现逐个比对」）。这里管的是**接线**：
// 算出来的数有没有正确送到 DOM、口径说明有没有被悄悄删掉、
// 算不出来时有没有明说而不是显示 0。
{
  const demoRecords = getInitialSleepLogs(); // 7 晚连续：09-16 … 09-22
  const html = render('TrendsTab(作息节律卡)',
    React.createElement(TrendsTab, { records: demoRecords, theme }));

  const sri = computeSleepRegularityIndex(demoRecords);
  check('演示数据能算出 SRI（连续 7 晚）', sri !== null);
  if (sri) {
    check('SRI 以一位小数显示（与文献报法一致）', html.includes(sri.sri.toFixed(1)),
      `期望出现 ${sri.sri.toFixed(1)}`);
    check('SRI 标记位置与数值一致',
      html.includes(`calc(${Math.max(0, Math.min(100, sri.sri))}% - 1.5px)`),
      '刻度条上的标记没跟数值对齐');
    check('写明了已比较多少个相邻日对', html.includes(`${sri.comparedDayPairs} 个相邻日对`),
      '不写日对数，用户无法判断这个数字有多少数据支撑');
  }

  // 参考区间必须画在队列的 IQR 位置（73.8–86.3），而不是随便一条带子
  // React 的 SSR 输出是 style="left:73.8%;width:12.5%"，冒号后没有空格，
  // 按带空格的写法断言会永远失败。
  check('参考区间按队列 IQR 定位', html.includes('left:73.8%;width:12.5%'),
    '参考带位置与 Windred 2024 报告的 IQR 73.8–86.3 不一致');

  // 口径差异说明是这张卡的诚实性底线：删掉它，用户就会拿自报数值
  // 去跟加速度计队列直接比，得出错误结论。
  check('明确标注 SRI 按自报卧床区间估算', html.includes('自报卧床区间'),
    '缺了这句，数值会被当成与队列同口径');
  check('给出参考区间的出处', html.includes('Windred') && html.includes('Phillips'),
    '引用了外部数值就必须能追溯到出处');
  check('说明两者测量方式不同、请以自身变化为准', html.includes('测量方式不同'),
    '缺少这句会让人直接与队列横向比较');

  const midpoint = computeSleepMidpoint(demoRecords);
  check('演示数据能算出睡眠中点', midpoint !== null);
  if (midpoint) {
    const m = ((midpoint.midpointMinutes % 1440) + 1440) % 1440;
    const c = (m + 720) % 1440;
    const clock = `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(Math.round(c % 60)).padStart(2, '0')}`;
    check('睡眠中点以钟点显示', html.includes(clock), `期望出现 ${clock}`);
    check('写出集中度（用于判断均值是否有代表性）',
      html.includes(midpoint.resultantLength.toFixed(2)),
      `期望出现集中度 ${midpoint.resultantLength.toFixed(2)}`);
  }

  // 演示数据的自由夜来自周五(09-18)与周六(09-19)：按「起床日」归类才对
  const jetlag = computeSocialJetlag(demoRecords);
  check('演示数据的自由夜为 2 晚（周五、周六）', jetlag?.freedayNights === 2,
    `实际 ${jetlag?.freedayNights} 晚`);
  check('社交时差用统一时长口径显示',
    jetlag !== null && html.includes(formatDurationChinese(jetlag.jetlagMinutes)),
    '时长显示应与项目其它位置口径一致');
  check('写明自由日按起床日归类', html.includes('自由夜按「起床日」算'),
    '不写清楚，用户会把周日晚也算成自由夜');
  check('说明轮班作息不适用', html.includes('轮班作息不适用'),
    '只按星期几判断，必须声明这个限制');
}

// 断档时必须明说算不出，而不是给一个数
{
  // 09-16 与 09-18 之间缺了 09-17 → 两侧日对全部失效
  const all = getInitialSleepLogs();
  const gapped = [all[0], all[2]];
  const html = render('TrendsTab(作息记录断档)',
    React.createElement(TrendsTab, { records: gapped, theme }));
  check('断档时 SRI 返回 null（不硬凑数字）', computeSleepRegularityIndex(gapped) === null,
    '断档应让两侧日对整体失效');
  check('断档时提示需要连续记录', html.includes('连续') && html.includes('规律性指数'),
    '算不出来时要说明原因，不能留空白或显示 0');
  check('断档时不显示参考区间刻度条', !html.includes('队列 IQR'),
    '算不出 SRI 却仍画出参考刻度条会误导');
}

// 只有一晚时同理
{
  const one = [getInitialSleepLogs()[0]];
  const html = render('TrendsTab(作息仅1条)', React.createElement(TrendsTab, { records: one, theme }));
  check('仅一晚时不显示 SRI 数值', computeSleepRegularityIndex(one) === null && !html.includes('队列 IQR'),
    '一晚没有可比较的日对');
  check('仅一晚时仍能显示睡眠中点（只需一晚）', computeSleepMidpoint(one) !== null);
}

// ——首页的视觉权威分配：分数被降级，自指对照被提前。
// 为什么单独断言层级：这个改动不改任何数值，唯一效果就是"谁更显眼"。
// 没有断言的话，日后有人把分数环调回去，测试全绿，而问题原样复现。
{
  // 上面那段用过 localStorage 后把它 delete 了（见 "delete globalThis.localStorage"），
  // 所以这里要重新垫一个——OneTapSleepTracker 初始化时会读它。
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };

  const renderWith = (label: string, records: ReturnType<typeof getInitialSleepLogs>) =>
    render(label, React.createElement(TodayTab, {
      records,
      userProfile: {
        name: '体验用户', targetBedtime: '23:00', targetWakeTime: '07:00', targetDurationHours: 8,
      } as unknown as UserProfile,
      theme,
      onOpenActiveSleep: () => {},
      onOpenManualLog: () => {},
      onSaveRecord: () => {},
    }));

  // 低分提示只在 sleepScore < 75 时出现（演示数据里 60 / 74 那两晚）。
  // 少了这个用例，上面三条关于提示的断言会在**提示根本没渲染**时空跑通过。
  const demoAll = getInitialSleepLogs();
  const lowScored = demoAll.find((r) => r.sleepScore < 75);
  if (lowScored) {
    const lowHtml = stripComments(renderWith('TodayTab(低分提示)', [lowScored, ...demoAll.filter((r) => r.id !== lowScored.id)]));
    check('低分时确实渲染出了提示（否则下面的断言是空跑）',
      /💡|提示/.test(lowHtml), '低分用例没渲染出提示');
    check('低分提示不再断言无法显示的生理代偿',
      !lowHtml.includes('自动通过增加深睡代偿'),
      '又出现了那个 App 自己都显示不出来的代偿承诺');
    check('低分提示不给无依据的安心承诺',
      !lowHtml.includes('无需担忧'),
      '"无需担忧"是安心承诺，没有证据支持这类说法');
    check('低分提示给出可执行动作',
      /先固定起床时间/.test(lowHtml),
      '只宽慰不给动作，正是低效能感那一种配方');
  } else {
    check('演示数据里存在低分夜晚（低分提示的测试前提）', false, '找不到 sleepScore<75 的演示记录');
  }

  const html = render('TodayTab(自指对照)', React.createElement(TodayTab, {
    records: getInitialSleepLogs(),
    userProfile: {
      name: '体验用户', targetBedtime: '23:00', targetWakeTime: '07:00', targetDurationHours: 8,
    } as unknown as UserProfile,
    theme,
    onOpenActiveSleep: () => {},
    onOpenManualLog: () => {},
    onSaveRecord: () => {},
  }));
  const clean = stripComments(html);

  check('首页渲染出自指对照',
    clean.includes('比你自己'),
    '自指对照没渲染出来——这是本页唯一被实测验证有效的反馈形式');
  check('自指对照出现在分数环之前（先给相对变化，再给绝对分数）',
    clean.indexOf('比你自己') < clean.indexOf('tabular-nums'),
    '顺序反了：分数又回到最前面');
  // 曾经写成「对比你自己：比你自己最近 6 晚…」——前缀与正文重复了"你自己"。
  // 关键词断言抓不到这种重复，所以单独钉一次。
  check('自指对照没有重复的「你自己」',
    (clean.match(/你自己/g) ?? []).length === 1,
    `出现了 ${(clean.match(/你自己/g) ?? []).length} 次`);
  check('自指对照引用的是用户自己的晚数，不是临床阈值',
    /最近 \d+ 晚/.test(clean),
    '没有引用自己的基线');

  // 分数环必须保持降级：数字不再是 text-2xl，容器不再是 w-20 h-20
  check('分数数字已降级（不再是 text-2xl）',
    !clean.includes('text-2xl'),
    '分数又变回整张卡最大的字号');
  check('分数环容器已缩小（w-16 而非 w-20）',
    clean.includes('w-16 h-16') && !clean.includes('w-20 h-20'),
    '分数环尺寸被调回去了');
  // 低分提示原写作「身体今夜会自动通过增加深睡代偿，无需担忧」，两个问题：
  // ①它断言的生理代偿，依据是 App 自己推演出的深睡值，而这个值实测是"睡得越少越高"，
  //   App 永远显示不出它承诺的那个代偿；
  // ②「无需担忧」是安心承诺，无证据支持——且 Witte & Allen 2000 指出
  //   "高威胁 + 低效能感"才是反效果配方，一句不给动作的宽慰正是低效能感那一种。
  // 现在改成给一个用户做得到的动作（沿用发现引擎里已有的杠杆）。
  check('页脚说明评分里含推演成分',
    clean.includes('40 分的推演分期'),
    '只说了深睡是推演，没说分数里有多少是推演');
}

// ——闹钟：不得声称一个代码做不到的唤醒行为。
// `checkAlarm` 只做 `alarm.time === 当前分钟` 的精确匹配，
// `smartWakeEnabled` / `smartWakeWindowMinutes` 从未参与响铃判定；
// 原生插件里也没有任何传感器代码。而界面原来写的是「于设定时刻 ±20 分钟内**平缓唤醒**」
// 和徽标「浅睡唤醒 ±20m」——读者会以为它已经在工作。
// 属于和「深睡是推演值」同一类问题：UI 声称了一件代码做不到的事。
{
  // AlarmManager 依赖 audioSynth，后者的构造函数会读 window（浏览器音频上下文）。
  // Node 里没有，垫一个最小实现，只为让它能渲染出来，不改变组件行为。
  (globalThis as unknown as { window: unknown }).window = globalThis;
  const store2: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store2[k] ?? null,
    setItem: (k: string, v: string) => { store2[k] = String(v); },
    removeItem: (k: string) => { delete store2[k]; },
    clear: () => { for (const k of Object.keys(store2)) delete store2[k]; },
  };

  const alarm = {
    id: 'a1', time: '07:00', label: '唤醒闹钟', enabled: true, repeatDays: [1, 2, 3, 4, 5],
    tone: 'gentle_chime', vibrate: true, smartWakeEnabled: true, smartWakeWindowMinutes: 20,
  } as unknown as Parameters<typeof AlarmManager>[0]['alarms'][number];

  const html = render('AlarmManager(浅睡唤醒)', React.createElement(AlarmManager, {
    alarms: [alarm], onUpdateAlarms: () => {}, theme,
  }));
  const clean = stripComments(html);

  check('开启了浅睡唤醒的闹钟确实渲染出徽标（否则下面的断言是空跑）',
    clean.includes('浅睡唤醒'), '徽标没渲染出来');
  // 必须锚定在徽标上，不能只 contains('尚未生效')：
  // InfoNote 的标题「为什么尚未生效」也含这三个字，只查关键词会匹配到错误的元素，
  // 于是删掉徽标上的标记断言依然全绿（这是反向验证抓出来的）。
  check('徽标上明确标注尚未生效',
    /浅睡唤醒 ±\d+m[\s\S]{0,160}?尚未生效/.test(clean),
    '徽标读起来仍像是一个正在工作的功能');
  // JSX 里的 Markdown 语法不会渲染成粗体，会**原样显示星号**。
  // 我第一版就写了 `闹钟只做**精确到分钟**的匹配`，DOM 里真的带着两个星号。
  check('说明里没有漏渲染的 Markdown 星号',
    !clean.includes('**'),
    'JSX 里的 ** 会原样显示成星号');
  check('说明里点明「还不会改变响铃时刻」',
    clean.includes('还不会改变响铃时刻'),
    '没有告诉用户它到底会不会提前响');
  check('说明里点明了原因（没有采集体动或声音）',
    /没有采集任何一项/.test(clean),
    '只说了没生效，没说为什么');
  check('不再声称「平缓唤醒」（那是做不到的承诺）',
    !clean.includes('平缓唤醒'),
    '又出现了"于设定时刻 ±N 分钟内平缓唤醒"这类承诺');

  // 反向：没开这个功能的闹钟不该被贴上标记，否则标记失去意义
  const offHtml = render('AlarmManager(未开浅睡唤醒)', React.createElement(AlarmManager, {
    alarms: [{ ...alarm, smartWakeEnabled: false } as typeof alarm],
    onUpdateAlarms: () => {}, theme,
  }));
  check('未开启时徽标上不做任何「尚未生效」标注',
    !/浅睡唤醒[\s\S]{0,160}?尚未生效/.test(stripComments(offHtml)),
    '未开启也被标注了，说明标注挂错了条件');
}

// ——首页要显示「分数与你自己记录的感受对不上」。
// wakingMood 此前被录入却从未被读取；现在用起来了，就必须两侧都测：
// 矛盾时要出现，一致时**必须不出现**（JITAI：显式设计"不提供任何东西"）。
{
  const store3: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store3[k] ?? null,
    setItem: (k: string, v: string) => { store3[k] = String(v); },
    removeItem: (k: string) => { delete store3[k]; },
    clear: () => { for (const k of Object.keys(store3)) delete store3[k]; },
  };

  const renderTodayWith = (label: string, records: ReturnType<typeof getInitialSleepLogs>) =>
    stripComments(render(label, React.createElement(TodayTab, {
      records,
      userProfile: {
        name: '体验用户', targetBedtime: '23:00', targetWakeTime: '07:00', targetDurationHours: 8,
      } as unknown as UserProfile,
      theme,
      onOpenActiveSleep: () => {},
      onOpenManualLog: () => {},
      onSaveRecord: () => {},
    })));

  // 一致：演示数据里"优/良 配 refreshed/neutral、差 配 groggy"本来就自洽
  const demo = getInitialSleepLogs();
  const consistentHtml = renderTodayWith('TodayTab(感受一致)', demo);
  check('一致时首页不出现「以你的感受为准」',
    !consistentHtml.includes('以你的感受为准'),
    '一致时也出面对照，首页一打开就在制造噪声');

  // 矛盾：把最新一晚改成"分数 99 但记录昏沉困倦"
  const conflicted = [{ ...demo[0], sleepScore: 99, wakingMood: 'groggy' as const }, ...demo.slice(1)];
  const conflictHtml = renderTodayWith('TodayTab(感受矛盾)', conflicted);
  check('矛盾时首页确实渲染出对照（否则下面的断言是空跑）',
    conflictHtml.includes('以你的感受为准'), '矛盾了却没出面对照');
  check('对照里引用了用户记录的原话',
    conflictHtml.includes('昏沉困倦'), '没引用用户自己记录的感受');
  check('对照出现在分数环之前（先给"以你为准"，再给分数）',
    conflictHtml.indexOf('以你的感受为准') < conflictHtml.indexOf('tabular-nums'),
    '顺序反了：分数压在"以你的感受为准"前面');
}

// ——一键记录不得根据时长编造主观感受。
// 原来是 `timeInBed < 30 ? 'tired' : 'refreshed'`：用时长替用户说他醒来什么感觉，
// 而且方向必然与分数一致，等于把"感受"变成分数的回声。
// 这是源码级护栏（该分支需要交互才能触发），刻意写窄：只钉这一条推导。
{
  // 必须剥掉 JS 行注释。`stripComments` 是给渲染出的 HTML 用的（剥 <!-- -->），
  // 不处理 `//`；而我在改动处正好保留了一句「这里原来是 `timeInBed < 30 ? 'tired' : 'refreshed'`」
  // 作为改动理由，不剥掉它这条断言会匹配到自己的注释而永远为红。
  const src = readFileSync(
    new URL('../src/components/OneTapSleepTracker.tsx', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  check('一键记录不再由时长推导醒来感受',
    !/timeInBed\s*<\s*\d+\s*\?\s*'tired'/.test(src),
    "又出现了用 timeInBed 编造 'tired' 的写法");
  check('一键记录写入的是"没说"的中性值',
    /wakingMood:\s*'neutral'/.test(src),
    'wakingMood 的取值又变成了一个主观断言');
}

// ============ Markdown 粗体渲染 ============
console.log('\n══ 渲染层：**粗体** 必须变成 <strong>，不能带星号显示给用户 ══');
{
  // 起因：项目里有 79 处用户可见文案写了 Markdown 粗体，而 JSX 不解析它。
  // 最严重的是危机求助文案（`**请珍重您的生命，您并不孤单！**`）——
  // 它在聊天气泡里就是一个纯文本节点，于是星号会显示给一个正在痛苦中的用户。
  const { renderEmphasis } = await import('../src/utils/richText.js');

  const html1 = renderToString(React.createElement('div', null, renderEmphasis('A **B** C')));
  check('成对的 ** 渲染成 <strong>', /<strong[^>]*>B<\/strong>/.test(html1), html1);
  check('粗体之外的文字保持原样', html1.includes('A ') && html1.includes(' C'), html1);

  // 不成对的星号必须原样保留，否则 2**10 之类的内容会被吃掉
  const html2 = renderToString(React.createElement('div', null, renderEmphasis('2**10 与 **未闭合')));
  check('不成对的 ** 原样输出（不吞内容）', !/<strong/.test(html2), html2);

  const html3 = renderToString(React.createElement('div', null, renderEmphasis('没有标记的普通文字')));
  check('无标记时原样返回', html3.includes('没有标记的普通文字') && !/<strong/.test(html3), html3);

  // ★ 真正的验收：真实文案渲染后**一个星号都不剩**
  const { computeFindings } = await import('../src/utils/sleepFindings.js');
  const { getInitialSleepLogs } = await import('../src/utils/sleepRecord.js');
  const demo = getInitialSleepLogs();
  const profile = { targetBedtime: '23:00', targetWakeTime: '07:00', targetDurationHours: 8 } as never;
  const findings = computeFindings(demo, profile, { includeOnDemand: true }) as unknown as Array<Record<string, string>>;
  check('演示数据确实产出了带粗体的结论（否则下面的检查是空跑）',
    findings.some((f) => (f.detail ?? '').includes('**')), `共 ${findings.length} 条结论`);

  let withMd = 0;
  for (const f of findings) {
    for (const key of ['headline', 'detail'] as const) {
      const v = f[key];
      if (!v || !v.includes('**')) continue;
      withMd++;
      const out = renderToString(React.createElement('div', null, renderEmphasis(v)));
      check(`结论 ${f.id ?? ''} 的 ${key} 渲染后不含字面星号`, !/\*\*/.test(out), out.slice(0, 80));
    }
  }
  check('确实检查到了带粗体的结论（不是空跑）', withMd >= 1, `检查到 ${withMd} 条`);

  // 危机求助文案：全 App 最敏感的一段，单独钉一次
  const { generateLocalChatReply } = await import('../src/utils/clinicalSleepEngine.js');
  const crisis = generateLocalChatReply('我不想活了', demo[0]!, demo, profile) as string;
  check('危机求助文案确实被触发（否则下面的检查是空跑）',
    crisis.includes('生命') || crisis.includes('求助'), crisis.slice(0, 40));
  const crisisOut = renderToString(React.createElement('div', null, renderEmphasis(crisis)));
  check('危机求助文案渲染后不含字面星号', !/\*\*/.test(crisisOut),
    crisisOut.replace(/<[^>]+>/g, '').slice(0, 100));
  check('危机求助文案保留了求助热线号码', crisisOut.includes('400-161-9995'), crisisOut.slice(0, 80));
}

// ============ 睡前呼吸练习（第十六轮接入，此前是从未挂上入口的孤儿组件）============
{
  const { BreathingExercise, RECOMMENDED_ROUNDS } = await import('../src/components/BreathingExercise.js');
  const html = renderToString(React.createElement(BreathingExercise));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  check('呼吸练习能渲染', html.length > 400, `只有 ${html.length} 字符`);
  check('未开始时显示「点击开始」', text.includes('点击开始'), text.slice(0, 80));
  check('初始为 0 轮', text.includes('已完成 0 轮'), text.slice(0, 120));
  check('推荐轮数是 4', RECOMMENDED_ROUNDS === 4, String(RECOMMENDED_ROUNDS));

  // 这几条防的是**回归**：组件原来写着「源自哈佛睡眠医学研究，快速平息心率入眠」，
  // 而它此前没有任何入口，所以那句从没被人看见过。现在它可见了，必须钉住。
  check('不声称机构研究出处', !/哈佛|斯坦福|梅奥|约翰霍普金斯|牛津|剑桥|耶鲁/.test(text), text.slice(0, 120));
  check('不承诺疗效', !/快速平息|彻底排解|治愈|疗效/.test(text), text.slice(0, 120));
  check('给出的是机制而不是疗效', text.includes('副交感神经'), text.slice(0, 160));

  // 「屏气 7 秒不是硬指标」只出现在 hold 阶段的文案里，服务端渲染停在 idle 状态、
  // 到不了那个分支，所以这一条只能查源码。**真正的验证靠截图**：
  // 跑起来走到屏气阶段，看那句话是不是真的显示出来。
  const beSrc = readFileSync('src/components/BreathingExercise.tsx', 'utf8');
  check('屏气阶段说明了 7 秒不是硬指标（源码级，运行时见截图）',
    beSrc.includes('7 秒不是硬指标'), '');
  check('满 4 轮后提示可以停下（而不是催促继续）',
    beSrc.includes('想停就停'), '');
}

// 入口必须真的存在：组件写好了但没入口，就是本轮开头那个「孤儿组件」问题。
{
  const todaySrc = readFileSync('src/components/TodayTab.tsx', 'utf8');
  check('睡眠页有呼吸练习的入口行', todaySrc.includes('睡前呼吸练习'), '');
  check('入口是可展开的（默认收起，不增加首屏密度）',
    /showBreathing/.test(todaySrc) && /aria-expanded/.test(todaySrc), '');
  check('入口默认收起', /useState\(false\)/.test(todaySrc), '');
}

// ============ 汇总 ============
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 渲染层全部通过（${pass} 项断言）`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
