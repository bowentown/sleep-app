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
import { TrendsTab } from '../src/components/TrendsTab.js';
import { SleepHypnogram } from '../src/components/SleepHypnogram.js';
import { TodayTab } from '../src/components/TodayTab.js';
import { APP_THEMES } from '../src/utils/themeStyles.js';
import { buildSleepRecord, getInitialSleepLogs } from '../src/utils/sleepRecord.js';
import type { SleepRecord, UserProfile } from '../src/types/sleep.js';

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
      onNavigateToCoach: noop,
    }));
    const hypnoHtml = render(`SleepHypnogram(${label})`,
      React.createElement(SleepHypnogram, { record, theme }));

    // TodayTab：「深睡阶段 95分 · 21%」
    const todayPct = stripComments(todayHtml).match(/深睡阶段<\/span><span[^>]*>\d+分 · (\d+)%</)?.[1];
    // SleepHypnogram：深睡统计块里的「21% (目标>18%)」（深睡是第一个带目标的块）
    const hypnoPct = stripComments(hypnoHtml).match(/(\d+)% \(目标/)?.[1];
    const expected = record.durationMinutes > 0
      ? Math.round((record.deepSleepMinutes / record.durationMinutes) * 100)
      : 0;

    check(`深睡占比跨组件一致（${label}）`, todayPct !== undefined && todayPct === hypnoPct,
      `报告卡 ${todayPct ?? '未解析'}% vs 分期块 ${hypnoPct ?? '未解析'}%`);
    check(`深睡占比为占总睡眠（${label}）`, hypnoPct === String(expected),
      `期望 ${expected}%，实际 ${hypnoPct ?? '未解析'}%`);
  }
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
}

// ============ TrendsTab 得分曲线：日期标签必须对在数据点下方 ============
// 真实缺陷：标签行用 justify-between，把首尾标签的「边缘」贴到两端，
// 而数据点中心在 0% / 100%——实测首尾各错开 15.1px，中间的标签偏移为 0，
// 所以只看中间会以为没问题。
{
  const demoRecords = getInitialSleepLogs();
  const html = render('TrendsTab(7条演示数据·标签对齐)',
    React.createElement(TrendsTab, { records: demoRecords, theme }));

  const lefts = [...html.matchAll(/style="left:([\d.]+)%"/g)].map((m) => Number(m[1]));
  const cxs = [...html.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  // 居中不仅靠 left，还靠 -translate-x-1/2 把标签自身宽度抵消掉；
  // 只断言 left 的话，删掉居中变换不会被发现。
  const labelTags = [...html.matchAll(/<span[^>]*style="left:[\d.]+%"[^>]*>/g)].map((m) => m[0]);

  check('得分曲线日期标签数 = 记录数', lefts.length === demoRecords.length,
    `期望 ${demoRecords.length} 个，实际 ${lefts.length} 个`);
  check('得分曲线数据点数 = 记录数', cxs.length === demoRecords.length,
    `期望 ${demoRecords.length} 个，实际 ${cxs.length} 个`);
  check('得分曲线日期标签自身水平居中', labelTags.length > 0
    && labelTags.every((t) => t.includes('-translate-x-1/2')),
    '标签缺少 -translate-x-1/2：left 定位的是标签左边缘而不是中心，仍会与数据点错开半个标签宽');

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

// ============ AIAdvicePanel：无法在本层覆盖 ============
// AIAdvicePanel 静态依赖 utils/localLlmEngine，后者有
//   import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
// 「?url」是 Vite 专有语法，tsx/Node 会把它当成真模块去解析并报
// ERR_MODULE_NOT_FOUND（还会把 .wasm 当 JS 解析）。要在这里渲染它，就得把端侧
// LLM 的 wasm 改成动态导入——为一个布局断言去动推理路径不划算。
//
// 所以该面板的两处布局缺陷（快捷提问 chip 被截断、评估按钮文字换行）由
// design-review/shoot-screenshots.mjs 的真实浏览器截图覆盖，不进 CI 断言。

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
