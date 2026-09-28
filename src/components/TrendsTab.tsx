import React, { useState } from 'react';
import {
  TrendingUp,
  Activity,
  Layers,
  Clock,
  Sparkles,
  Calendar,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ShieldCheck,
  Award,
  Zap,
  Trash2,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { SleepRecord } from '../types/sleep';
import { formatDurationChinese } from '../utils/sleepScore';
import { SLEEP_STAGE_COLORS } from '../utils/sleepStageColors';
import {
  computeSleepDebt,
  computeBedtimeRegularity,
  minutesSinceNoon,
  fromMinutesSinceNoon,
} from '../utils/sleepInsights';
import { ThemeConfig } from '../utils/themeStyles';

interface TrendsTabProps {
  records: SleepRecord[];
  onDeleteRecord?: (id: string) => void;
  theme: ThemeConfig;
  /** 目标时长（分钟）。负债要跟目标比，缺省按 8 小时。 */
  targetDurationMinutes?: number;
  /** 初始视图。默认「趋势与结构」，可让调用方直接落到某个视图（也便于渲染层自检） */
  initialViewMode?: MetricViewMode;
}

export type MetricViewMode = 'quality' | 'stages' | 'circadian';

export const TrendsTab: React.FC<TrendsTabProps> = ({
  records,
  onDeleteRecord,
  theme,
  targetDurationMinutes = 480,
  initialViewMode = 'quality',
}) => {
  const innerBg = theme?.cardInnerBg || 'bg-[#0a0f1d]';
  const innerBorder = theme?.cardInnerBorder || 'border-slate-700/80';
  const accentText = theme?.accentText || 'text-indigo-400';
  const textMuted = theme?.textMuted || 'text-slate-400';
  const textSecondary = theme?.textSecondary || 'text-slate-300';
  const accentBg = theme.accentBg;
  const [viewMode, setViewMode] = useState<MetricViewMode>(initialViewMode);
  const [hoveredRecord, setHoveredRecord] = useState<SleepRecord | null>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  // 记录「按日期新→旧」是所有写入路径的约定，但这里是读取侧：不假设上游
  // 已经排好序（更早版本存下的数据可能是旧→新），自己排一遍再取最近 7 条。
  const sortedRecords = [...records].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const last7Records = sortedRecords.slice(0, 7).reverse(); // 转为时间正序，供画图
  const weekCount = last7Records.length;

  // 分期比例的柱高按卧床时长归一。至少取 1 避免除零；
  // 全部为 0 时每根都会是 0/1 → 触发展示层 12% 的下限，不会消失。
  const maxStageTotal = Math.max(
    1,
    ...last7Records.map((r) => r.durationMinutes + r.awakeMinutes)
  );

  // 睡眠负债与就寝规律性。两者都由纯函数算出（见 utils/sleepInsights），
  // 那边有断言覆盖跨午夜与「盈余不抵扣缺口」这两条容易错的规则。
  const debt = computeSleepDebt(last7Records, targetDurationMinutes);
  const deficitNights = last7Records.filter((r) => r.durationMinutes < targetDurationMinutes).length;
  const regularity = computeBedtimeRegularity(last7Records);
  // 本周最佳一晚。与上面的数字同口径，只取最近 7 晚，避免拿几十天前的
  // 一次高分来代表「本周」。
  // 注意 last7Records 是 reverse() 过的**时间正序**（oldest → newest），
  // 所以这里要用 >= 而不是 >：同分时让更近的那一晚胜出，
  // 否则并列最高分会一直停在最早的那天。
  const bestNight = last7Records.length
    ? last7Records.reduce((a, r) => (r.sleepScore >= a.sleepScore ? r : a), last7Records[0])
    : null;

  const regularityClass = !regularity
    ? ''
    : regularity.stdDevMinutes < 30
      ? 'text-emerald-400'
      : regularity.stdDevMinutes < 60
        ? 'text-amber-400'
        : 'text-rose-400';
  const bedtimePoints = last7Records
    .map((r) => ({ m: minutesSinceNoon(r.bedtime), label: `${r.date.slice(5)} ${r.bedtime}` }))
    .filter((p) => Number.isFinite(p.m));

  // 概览数字必须与「近7日」这个标签同口径：此前用的是全部记录，
  // 于是攒了 30 天数据后这里显示的是 30 天均值，标签与数据不符。
  const weekSum = (pick: (r: SleepRecord) => number) =>
    last7Records.reduce((acc, r) => acc + pick(r), 0);

  const avgDuration = weekCount > 0 ? Math.round(weekSum((r) => r.durationMinutes) / weekCount) : 0;
  const avgScore = weekCount > 0 ? Math.round(weekSum((r) => r.sleepScore) / weekCount) : 0;
  // 深睡占比用「合计深睡 / 合计总睡眠」，而不是各天占比再取平均——后者会让
  // 3 小时的短夜与 9 小时的长夜等权，算出来的不是「这一周的深睡占比」。
  const weekTst = weekSum((r) => r.durationMinutes);
  const avgDeepRatio = weekTst > 0 ? Math.round((weekSum((r) => r.deepSleepMinutes) / weekTst) * 100) : 0;

  const activeRecord = hoveredRecord || last7Records[last7Records.length - 1];

  // 折线图纵轴此前硬编码在 50–100：低于 50 的分数会被压到同一条底线上，
  // 而图上没有任何说明（真实分数只在 hover 时才显示）。改为按本周实际得分
  // 自适应取窗口，并把范围标注出来，既保留分辨率又不失真。
  const weekScores = last7Records.map((r) => r.sleepScore);
  const scoreLo = weekScores.length > 0 ? Math.min(...weekScores) : 0;
  const scoreHi = weekScores.length > 0 ? Math.max(...weekScores) : 100;
  const scorePad = Math.max(3, Math.round((scoreHi - scoreLo) * 0.2));
  const axisLo = Math.max(0, scoreLo - scorePad);
  const axisHi = Math.min(100, scoreHi + scorePad);
  const axisSpan = Math.max(1, axisHi - axisLo);

  // 折线与圆点共用同一个 y 映射，避免两处公式各改一半后错位
  const scoreY = (score: number) =>
    80 - ((Math.max(axisLo, Math.min(axisHi, score)) - axisLo) / axisSpan) * 60 - 10;

  // 折线图绘图区左右各留出约半个日期标签的宽度。
  // 首尾数据点若贴到 0% / 100%，居中对齐后的日期标签就会跨出内框边框
  // （实测各溢出 2.1px，视觉上像被裁掉）。数据点、日期标签、面积填充
  // 必须共用这一套 x 映射，否则三者之间又会错位。
  const LABEL_PAD_PCT = 6;
  const pointCount = last7Records.length;
  const xPct = (i: number) =>
    pointCount > 1 ? LABEL_PAD_PCT + (i / (pointCount - 1)) * (100 - 2 * LABEL_PAD_PCT) : 50;
  const xVb = (i: number) => (xPct(i) / 100) * 280;

  const getScoreCoordinates = () => {
    if (pointCount === 0) return '';
    return last7Records.map((r, i) => `${xVb(i)},${scoreY(r.sleepScore)}`).join(' ');
  };

  // 参考线标签的光晕底色：从主题的 cardInnerBg 类名里取出十六进制色值。
  // 折线会从标签上穿过，加一圈与底色同色的描边才能始终看清；
  // 各主题底色不同，所以不能写死一个颜色。
  const chartBgHex = theme.cardInnerBg.match(/#[0-9a-fA-F]{3,8}/)?.[0] ?? '#0c1222';

  return (
    <div className={`space-y-3 ${theme.textPrimary}`}>
      {/* 1. Concise Overview Numbers */}
      <div className="grid grid-cols-3 gap-2">
        <div className={`${theme.cardBg} rounded-2xl p-3 border ${theme.cardBorder} text-center`}>
          <span className={`text-[11px] font-medium ${theme.textMuted} block`}>近7日均分</span>
          <span className={`text-xl font-black font-mono ${accentText} tabular-nums`}>{avgScore}</span>
        </div>

        <div className={`${theme.cardBg} rounded-2xl p-3 border ${theme.cardBorder} text-center`}>
          <span className={`text-[11px] font-medium ${theme.textMuted} block`}>日均睡眠</span>
          <span className="text-xl font-black font-mono text-white tabular-nums">
            {/* 全 app 其它地方都写「7小时36分」，这里原本是「7.0h」，
                同一个量在两处用了不同单位。 */}
            {formatDurationChinese(avgDuration)}
          </span>
        </div>

        <div className={`${theme.cardBg} rounded-2xl p-3 border ${theme.cardBorder} text-center`}>
          <span className={`text-[11px] font-medium ${theme.textMuted} block`}>深睡占比</span>
          <span className="text-xl font-black font-mono text-emerald-400 tabular-nums">{avgDeepRatio}%</span>
        </div>
      </div>

      {/* 2. 睡眠负债与作息规律性
          这两项原先完全没有，而「日均睡眠」「深睡占比」只讲了平均值。
          规律性（就寝时间的波动幅度）在睡眠医学里是比时长更强的健康预测因子，
          而负债回答的是「这周到底欠了多少」。两者都从现有记录直接算得出来，
          不需要新增采集。 */}
      <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} space-y-3`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            本周睡眠负债
          </span>
          <span className={`text-xl font-black font-mono tabular-nums ${debt.shortfallMinutes > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {debt.shortfallMinutes > 0 ? formatDurationChinese(debt.shortfallMinutes) : '无负债'}
          </span>
        </div>
        <p className={`text-[10px] ${theme.textMuted} leading-relaxed`}>
          {debt.days === 0
            ? '还没有记录，无法计算累计缺口'
            : debt.shortfallMinutes > 0
              ? `近 ${debt.days} 晚中有 ${deficitNights} 晚没睡够目标，累计缺口 ${formatDurationChinese(debt.shortfallMinutes)}`
              : `近 ${debt.days} 晚每晚都达到了目标时长`}
          {debt.surplusMinutes > 0 && debt.shortfallMinutes > 0 && (
            <>
              {' '}
              <span className="text-slate-500">
                （另有 {formatDurationChinese(debt.surplusMinutes)} 盈余不计入抵扣：少睡一晚要两晚才补得回，
                多睡一晚并不能把缺口抹平）
              </span>
            </>
          )}
        </p>

        {/* 波动幅度用模板字符串一次成型。JSX 里写成 ±{n} 分钟 会被拆成三个文本节点，
            React 会在它们之间插入注释标记，自动化匹配和复制粘贴拿到的都是碎片。 */}
        <div className={`pt-2 border-t ${innerBorder} space-y-2`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400"></span>
              就寝规律性
            </span>
            {regularity ? (
              <span className={`text-xl font-black font-mono tabular-nums ${regularityClass}`}>
                {`±${Math.round(regularity.stdDevMinutes)} 分钟`}
              </span>
            ) : (
              <span className={`text-xs font-bold ${theme.textMuted}`}>记录不足</span>
            )}
          </div>

          {regularity ? (
            <>
              {/* 就寝时间的分布带：一个点代表一晚，阴影是均值±1个标准差。
                  比只给一个数字更能看出「乱在哪」。 */}
              <div className="relative h-9">
                <div className={`absolute left-0 right-0 top-3.5 h-2 rounded-full ${theme.cardInnerBg} border ${theme.cardInnerBorder}`} />
                {(() => {
                  const lo = regularity.minMinutes - 20;
                  const hi = regularity.maxMinutes + 20;
                  const span = Math.max(1, hi - lo);
                  const pct = (v: number) => ((v - lo) / span) * 100;
                  const bandL = pct(regularity.meanMinutes - regularity.stdDevMinutes);
                  const bandR = pct(regularity.meanMinutes + regularity.stdDevMinutes);
                  return (
                    <>
                      <div
                        className="absolute top-3.5 h-2 rounded-full bg-sky-400/25"
                        style={{ left: `${bandL}%`, width: `${Math.max(1, bandR - bandL)}%` }}
                      />
                      <div
                        className="absolute top-2 w-0.5 h-5 rounded-full"
                        style={{ left: `${pct(regularity.meanMinutes)}%`, backgroundColor: theme.accentHex }}
                        title={`平均就寝 ${regularity.meanBedtime}`}
                      />
                      {bedtimePoints.map((point, i) => (
                        <div
                          key={i}
                          className="absolute top-2 w-1.5 h-1.5 rounded-full bg-white/85 border border-slate-900 -translate-x-1/2"
                          style={{ left: `${pct(point.m)}%` }}
                          title={point.label}
                        />
                      ))}
                    </>
                  );
                })()}
              </div>
              <div className={`flex justify-between text-[10px] font-mono ${textMuted}`}>
                <span>{fromMinutesSinceNoon(regularity.minMinutes)}</span>
                <span>平均 {regularity.meanBedtime} 就寝</span>
                <span>{fromMinutesSinceNoon(regularity.maxMinutes)}</span>
              </div>
              <p className={`text-[10px] ${theme.textMuted}`}>
                最早与最晚相差 {formatDurationChinese(regularity.spanMinutes)} ·{' '}
                {regularity.stdDevMinutes < 30
                  ? '作息很稳定，继续保持'
                  : regularity.stdDevMinutes < 60
                    ? '波动略大，固定就寝时间能明显改善深睡'
                    : '波动很大，尽量先把就寝时间固定下来'}
              </p>
            </>
          ) : (
            <p className={`text-[10px] ${theme.textMuted}`}>至少需要 2 晚记录才能算出就寝时间的波动幅度</p>
          )}

          {/* 本周最佳一晚。图里那个最高点其实已经在说这件事，但要读出它得先看懂曲线；
              直接写出来是一行字的事，而且「哪晚最好」是回顾一周时最先想知道的问题。
              放在卡片最后：先讲问题（欠了多少、乱不乱），再给一个正向的锚点。 */}
          {bestNight && (
            <div className={`pt-3 border-t ${theme.cardInnerBorder} flex items-baseline justify-between gap-3`}>
              <span className={`text-[10px] ${theme.textMuted} shrink-0`}>本周最佳</span>
              <span className="text-[11px] font-bold text-white truncate">
                {bestNight.date.slice(5)} · {bestNight.sleepScore} 分
                <span className={`${theme.textMuted} font-normal`}> · 睡了 {formatDurationChinese(bestNight.durationMinutes)}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Visual Trends Container */}
      <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} space-y-3`}>
        {/* Toggle Switch */}
        <div className={`flex items-center justify-between pb-2 border-b ${innerBorder}`}>
          <span className="text-xs font-bold text-white">趋势与结构</span>

          <div className={`flex ${innerBg} p-1 rounded-xl border ${innerBorder} text-[11px]`}>
            <button
              type="button"
              onClick={() => setViewMode('quality')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'quality'
                  ? accentBg + ' text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              得分曲线
            </button>
            <button
              type="button"
              onClick={() => setViewMode('stages')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'stages'
                  ? accentBg + ' text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              分期比例
            </button>
            <button
              type="button"
              onClick={() => setViewMode('circadian')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'circadian'
                  ? accentBg + ' text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              起卧时段
            </button>
          </div>
        </div>

        {/* View Mode 1: Quality Score Trend */}
        {viewMode === 'quality' && (
          <div className="space-y-2 animate-in fade-in">
            <div className={`relative h-40 ${theme.cardInnerBg} rounded-2xl p-3 border ${theme.cardInnerBorder} flex flex-col justify-between`}>
              <svg className="w-full h-24 overflow-visible my-auto" viewBox="0 0 280 80">
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.accentHex} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={theme.accentHex} stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/*
                  参考线必须画在 SVG 内部，与数据共用同一坐标系。
                  原先用 CSS 的 top-4 / top-18 硬定位，而数据走的是 scoreY() 映射到
                  viewBox 的 y∈[10,70]：换算后「90分」线落在坐标轴顶边之上、
                  「75分」线落在约 69 分处，两条线的标注与位置都不符。
                  超出当前纵轴范围时直接不画，避免画在轴外产生误导。
                  虚线画在数据之前（数据压在上面），文字画在数据之后（见下方），
                  否则首尾数据点会盖住标签的第一个字。
                */}
                {90 >= axisLo && 90 <= axisHi && (
                  <line
                    x1="0"
                    y1={scoreY(90)}
                    x2="280"
                    y2={scoreY(90)}
                    stroke="#10b981"
                    strokeOpacity="0.5"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                )}
                {75 >= axisLo && 75 <= axisHi && (
                  <line
                    x1="0"
                    y1={scoreY(75)}
                    x2="280"
                    y2={scoreY(75)}
                    stroke="#64748b"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                )}

                {last7Records.length > 1 && (
                  <polygon
                    points={`${xVb(0)},80 ${getScoreCoordinates()} ${xVb(pointCount - 1)},80`}
                    fill="url(#scoreGrad)"
                  />
                )}

                <polyline
                  fill="none"
                  stroke={theme.accentHex}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={getScoreCoordinates()}
                />

                {last7Records.map((r, i) => {
                  const x = xVb(i);
                  const y = scoreY(r.sleepScore);
                  const isHovered = activeRecord?.id === r.id;

                  return (
                    <g key={r.id} className="cursor-pointer" onClick={() => setHoveredRecord(r)}>
                      <circle
                        cx={x}
                        cy={y}
                        r={isHovered ? 5.5 : 4}
                        fill={isHovered ? '#ffffff' : theme.accentHex}
                        stroke={theme.accentHex}
                        strokeWidth="2"
                      />
                      {isHovered && (
                        <text
                          x={x}
                          y={y - 8}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {r.sleepScore}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* 参考线标签画在数据之后：否则首个数据点会盖住标签的第一个字。
                    描边用与图表底色同色的光晕，保证折线穿过时仍然可读。 */}
                {90 >= axisLo && 90 <= axisHi && (
                  <text
                    x="2"
                    y={scoreY(90) - 3}
                    fill="#34d399"
                    fontSize="9"
                    fontFamily="monospace"
                    paintOrder="stroke"
                    stroke={chartBgHex}
                    strokeWidth="3"
                  >
                    90分 达标线
                  </text>
                )}
                {75 >= axisLo && 75 <= axisHi && (
                  <text
                    x="2"
                    y={scoreY(75) - 3}
                    fill="#94a3b8"
                    fontSize="9"
                    fontFamily="monospace"
                    paintOrder="stroke"
                    stroke={chartBgHex}
                    strokeWidth="3"
                  >
                    75分 警戒线
                  </text>
                )}
              </svg>

              <div className={`text-right text-[9px] ${textMuted} font-mono`}>
                纵轴 {axisLo}–{axisHi} 分（按本周实际得分自适应）
              </div>

              {/* 日期标签用与数据点同一套相对坐标居中（left + translateX(-50%)）。
                  原先用 justify-between：它把首尾标签的「边缘」贴到两端，而数据点中心在
                  0% / 100%，实测标签中心比点偏内 15.1px（中间那个点偏移为 0，正好印证）。
                  现在两侧各留 LABEL_PAD_PCT，标签不再跨出内框边框。 */}
              <div className={`relative h-4 border-t ${innerBorder} text-[10px] ${textMuted} font-mono`}>
                {last7Records.map((r, i) => {
                  return (
                    <span
                      key={r.id}
                      onClick={() => setHoveredRecord(r)}
                      style={{ left: `${xPct(i)}%` }}
                      className={`absolute top-1 -translate-x-1/2 whitespace-nowrap cursor-pointer ${
                        activeRecord?.id === r.id ? accentText + ' font-bold' : 'hover:text-white'
                      }`}
                    >
                      {r.date.slice(5)}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* View Mode 2: Sleep Stages */}
        {viewMode === 'stages' && (
          <div className="space-y-2 animate-in fade-in">
            <div className={`min-h-[10rem] ${theme.cardInnerBg} rounded-2xl p-3 border ${theme.cardInnerBorder} flex flex-col justify-between`}>
              {/* 柱高 = 卧床时长。原先每根柱子都写死 h-20，于是高度完全相同，
                  「哪晚睡得少」这个最该看出来的信息在这张图上完全看不见
                  （演示数据里最长和最短差了好几个小时）。高度是最强的视觉通道，
                  现在用它编码时长，颜色分段继续编码构成比例。 */}
              <div className="flex items-end justify-between gap-2 h-28 px-1">
                {last7Records.map((r) => {
                  // 四段是「深睡/浅睡/REM/清醒」——这是对整夜卧床时间的完整划分，
                  // 所以分母必须是卧床时长。此前用总睡眠做分母，四段之和
                  // = 卧床/总睡眠 > 100%，最后一截会被外层 overflow-hidden 裁掉，
                  // 清醒段基本看不见。
                  const total = Math.max(1, r.durationMinutes + r.awakeMinutes);
                  const deepPct = (r.deepSleepMinutes / total) * 100;
                  const remPct = (r.remSleepMinutes / total) * 100;
                  const lightPct = (r.lightSleepMinutes / total) * 100;
                  const awakePct = (r.awakeMinutes / total) * 100;
                  const isHovered = activeRecord?.id === r.id;
                  // 最高的一晚占满可绘区，其余按比例。下限 12% 保证极短的
                  // 夜晚仍然可见（否则 2 小时的柱子会细成一条线）。
                  const heightPct = Math.max(12, (total / maxStageTotal) * 100);

                  return (
                    <div
                      key={r.id}
                      onClick={() => setHoveredRecord(r)}
                      className="flex-1 flex flex-col items-center h-full justify-end cursor-pointer group"
                    >
                      <div className="w-full flex-1 min-h-0 flex items-end justify-center">
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full max-w-[24px] rounded-md overflow-hidden flex flex-col-reverse ${
                            isHovered ? 'ring-2 ring-indigo-400 shadow' : ''
                          }`}
                        >
                          {/* data-stage 供渲染层断言定位分段：柱容器本身也带
                              height:%（编码时长），只靠 style 匹配会把它算成一段。 */}
                          <div data-stage="deep" style={{ height: `${deepPct}%` }} className={SLEEP_STAGE_COLORS.deep.className} />
                          <div data-stage="light" style={{ height: `${lightPct}%` }} className={SLEEP_STAGE_COLORS.light.className} />
                          <div data-stage="rem" style={{ height: `${remPct}%` }} className={SLEEP_STAGE_COLORS.rem.className} />
                          <div data-stage="awake" style={{ height: `${awakePct}%` }} className={SLEEP_STAGE_COLORS.awake.className} />
                        </div>
                      </div>

                      {/* 日期始终显示。曾试过把日期换成「7小时55分」，但每根柱子
                          只有约 40px 宽，7 个字会压到相邻列；而且 hoveredRecord 在
                          点击后是持续保留的，触屏上点一下就会一直看不到日期。
                          具体数字改到图下方那行明细里给出。 */}
                      <span
                        className={`text-[9px] font-mono mt-1 whitespace-nowrap ${
                          isHovered ? accentText + ' font-bold' : textMuted
                        }`}
                      >
                        {r.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 选中那晚的明细。柱子只能表达比例，具体数字放这里，
                  不再往 40px 宽的列里塞。默认显示最近一晚，点柱子可切换。 */}
              <div className={`mt-2 text-[10px] font-mono ${textSecondary} flex flex-wrap justify-center gap-x-2 gap-y-0.5`}>
                <span className={`${accentText} font-bold`}>{activeRecord.date.slice(5)}</span>
                <span>卧床 {formatDurationChinese(activeRecord.durationMinutes + activeRecord.awakeMinutes)}</span>
                <span className={textMuted}>·</span>
                <span>总睡眠 {formatDurationChinese(activeRecord.durationMinutes)}</span>
              </div>

              <div className={`flex flex-col items-center gap-1 pt-1 border-t ${innerBorder} text-[10px] ${textSecondary}`}>
                {/* 图例顺序必须与柱子的堆叠顺序一致（自下而上 深睡→浅睡→REM→清醒），
                    否则读者会以为图例是从上往下对应的。
                    颜色统一来自 utils/sleepStageColors：这里原先「深睡」用的是
                    主题色，导致同一阶段在四个主题下分别是靛蓝/浅灰/黄/青。 */}
                <div className="flex justify-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-sm ${SLEEP_STAGE_COLORS.deep.className}`} />深睡
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-sm ${SLEEP_STAGE_COLORS.light.className}`} />浅睡
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-sm ${SLEEP_STAGE_COLORS.rem.className}`} />REM
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-sm ${SLEEP_STAGE_COLORS.awake.className}`} />清醒
                  </span>
                </div>
                <span className={`text-[9px] ${textMuted} font-sans text-center`}>
                  柱高 = 当晚卧床时长，色块 = 各阶段占比（四段合计 100%）<br />
                  * 睡眠分期为基于作息起止点与超昼夜节律的模型估算值，非临床医疗设备检测
                </span>
              </div>
            </div>
          </div>
        )}

        {/* View Mode 3: Circadian Gantt */}
        {viewMode === 'circadian' && (
          <div className="space-y-2 animate-in fade-in">
            <div className={`${theme.cardInnerBg} rounded-2xl p-3 border ${theme.cardInnerBorder} space-y-2`}>
              <div className={`flex justify-between text-[10px] ${textMuted} font-mono pb-1 border-b ${innerBorder}`}>
                <span>21:00</span>
                <span>00:00</span>
                <span>03:00</span>
                <span>06:00</span>
                <span>09:00</span>
              </div>

              {last7Records.map((r) => {
                const [bh, bm] = r.bedtime.split(':').map(Number);
                const [wh, wm] = r.wakeTime.split(':').map(Number);
                const startM = (bh < 12 ? bh + 24 : bh) * 60 + bm;
                const endM = (wh < 12 ? wh + 24 : wh) * 60 + wm;

                const rangeStart = 21 * 60;
                const totalRange = 13 * 60;
                const leftPercent = Math.max(0, Math.min(100, ((startM - rangeStart) / totalRange) * 100));
                const widthPercent = Math.max(6, Math.min(100 - leftPercent, ((endM - startM) / totalRange) * 100));

                const isHovered = activeRecord?.id === r.id;

                return (
                  <div
                    key={r.id}
                    onClick={() => setHoveredRecord(r)}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <span
                      className={`w-9 text-[10px] font-mono shrink-0 ${
                        isHovered ? accentText + ' font-bold' : textMuted
                      }`}
                    >
                      {r.date.slice(5)}
                    </span>

                    <div className={`flex-1 h-5 bg-slate-950 rounded-lg relative overflow-hidden border ${innerBorder}`}>
                      <div
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          backgroundColor: isHovered ? theme.accentHex : `${theme.accentHex}99`,
                        }}
                        className="absolute top-0.5 bottom-0.5 rounded flex items-center justify-between px-1.5"
                      >
                        <span className="text-[9px] font-mono text-white">{r.bedtime}</span>
                        <span className="text-[9px] font-mono text-white">{r.wakeTime}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. Collapsible Historical Records List with Delete Capability */}
      <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder}`}>
        <button
          type="button"
          onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
          className="w-full flex items-center justify-between text-left cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">历史睡眠数据记录</span>
            <span className={`text-[10px] ${textMuted} font-mono ${innerBg} px-2 py-0.5 rounded-full border ${innerBorder}`}>
              共 {records.length} 条
            </span>
          </div>

          <div className={`flex items-center gap-1 text-xs ${accentText} font-medium`}>
            <span>{isHistoryExpanded ? '收起列表' : '展开查看与管理'}</span>
            {isHistoryExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {/* Collapsible Content */}
        {isHistoryExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-700/60 divide-y divide-slate-800 text-xs animate-in fade-in duration-150">
            {records.length === 0 ? (
              <div className={`py-4 text-center ${textMuted}`}>暂无数据记录</div>
            ) : (
              records.map((r) => (
                <div
                  key={r.id}
                  className="py-3 flex items-center justify-between hover:bg-slate-800/30 px-2 rounded-xl transition-colors group"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-xs">{r.date}</span>
                      <span className={`font-mono ${accentText} font-bold text-xs`}>{r.sleepScore}分</span>
                    </div>
                    <div className={`text-[11px] ${textMuted} flex items-center gap-2 mt-0.5 font-mono`}>
                      <span>{r.bedtime} - {r.wakeTime}</span>
                      <span>·</span>
                      <span>{formatDurationChinese(r.durationMinutes)}</span>
                      <span>·</span>
                      <span className="text-emerald-400">深睡 {r.deepSleepMinutes}m</span>
                    </div>
                  </div>

                  {/* Delete Button */}
                  {onDeleteRecord && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确认删除 ${r.date} 的睡眠记录？`)) {
                          onDeleteRecord(r.id);
                        }
                      }}
                      title="删除此条记录"
                      className={`p-2 ${textMuted} hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
