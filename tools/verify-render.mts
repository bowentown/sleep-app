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
import { APP_THEMES } from '../src/utils/themeStyles.js';
import { buildSleepRecord } from '../src/utils/sleepRecord.js';
import type { SleepRecord } from '../src/types/sleep.js';

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

  // 堆叠条是唯一输出 height:N% 的地方（折线图用 SVG 坐标，不是百分比高度）
  const heights = [...html.matchAll(/height:([\d.]+)%/g)].map((m) => Number(m[1]));

  check('堆叠条分段数为 4×记录数', heights.length === records.length * 4,
    `期望 ${records.length * 4} 段，实际 ${heights.length} 段`);

  const totalDays = Math.floor(heights.length / 4);
  for (let d = 0; d < totalDays; d++) {
    const group = heights.slice(d * 4, d * 4 + 4);
    const sum = group.reduce((a, b) => a + b, 0);
    // 浮点误差容忍 0.05%
    check(`第 ${d + 1} 天睡眠结构四段之和 = 100%`, Math.abs(sum - 100) < 0.05,
      `实际 ${sum.toFixed(2)}%（${group.map((g) => g.toFixed(1)).join(' + ')}）——分母用错会导致 >100% 被裁切`);
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
