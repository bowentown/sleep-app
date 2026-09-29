import React from 'react';
import { SleepRecord, SleepStage } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';
import { SLEEP_STAGE_COLORS } from '../utils/sleepStageColors';
import { buildTargetTimeline, describeDelta } from '../utils/sleepInsights';
import { InfoNote } from './InfoNote';

interface SleepHypnogramProps {
  record: SleepRecord;
  theme?: ThemeConfig;
  /** 目标就寝 / 起床时间。两者都给时，堆叠条会换成「昨夜 vs 目标」时间轴。 */
  targetBedtime?: string;
  targetWakeTime?: string;
}

// 颜色统一来自 utils/sleepStageColors（原先这里写死 hex，与趋势页不一致）
const STAGE_CONFIG: Record<SleepStage, { label: string; color: string; yOffset: number; height: number }> = {
  awake: { label: '清醒', color: SLEEP_STAGE_COLORS.awake.hex, yOffset: 10, height: 18 },
  rem: { label: 'REM (快速眼动)', color: SLEEP_STAGE_COLORS.rem.hex, yOffset: 45, height: 22 },
  light: { label: '浅睡', color: SLEEP_STAGE_COLORS.light.hex, yOffset: 85, height: 24 },
  deep: { label: '深睡', color: SLEEP_STAGE_COLORS.deep.hex, yOffset: 125, height: 26 },
};

export const SleepHypnogram: React.FC<SleepHypnogramProps> = ({
  record,
  theme,
  targetBedtime,
  targetWakeTime,
}) => {
  const timeline =
    targetBedtime && targetWakeTime
      ? buildTargetTimeline(record.bedtime, record.wakeTime, targetBedtime, targetWakeTime)
      : null;
  const innerBg = theme?.cardInnerBg || 'bg-[#090d1a]';
  const innerBorder = theme?.cardInnerBorder || 'border-slate-700/80';
  const textSecondary = theme?.textSecondary || 'text-slate-300';
  const textMuted = theme?.textMuted || 'text-slate-400';
  const statBg = theme?.cardInnerBg || 'bg-[#0f172a]';
  const stages = record.stages || [];
  const totalMin = record.durationMinutes + record.awakeMinutes;

  // 占卧床时长（TIB）：四段之和恒为 100%，用于堆叠条与泳道图——它们划分的是整夜卧床。
  const deepPercent = totalMin > 0 ? Math.round((record.deepSleepMinutes / totalMin) * 100) : 0;
  const remPercent = totalMin > 0 ? Math.round((record.remSleepMinutes / totalMin) * 100) : 0;
  const lightPercent = totalMin > 0 ? Math.round((record.lightSleepMinutes / totalMin) * 100) : 0;
  const awakePercent = totalMin > 0 ? Math.round((record.awakeMinutes / totalMin) * 100) : 0;

  // 占总睡眠时长（TST）：深睡/REM 的临床目标区间（约 13–23% / 20–25%）是按 TST 定义的，
  // 所以「目标 >18%」这类对照必须用这一套；同时与 TodayTab 的「深睡阶段 xx%」同口径。
  // 混用两套分母会让同一屏出现两个数（95 分深睡曾同时显示 21% 和 20%）。
  const tstMin = record.durationMinutes;
  const shareOfTst = (minutes: number) =>
    tstMin > 0 ? Math.round((minutes / tstMin) * 100) : 0;
  const deepShareOfTst = shareOfTst(record.deepSleepMinutes);
  const lightShareOfTst = shareOfTst(record.lightSleepMinutes);
  const remShareOfTst = shareOfTst(record.remSleepMinutes);

  // Pre-calculate SVG stage blocks
  const startX = 40;
  const usableWidth = 355;
  let currentX = startX;
  const renderedBlocks = stages.map((st, i) => {
    const width = Math.max(3, (st.durationMinutes / totalMin) * usableWidth);
    const stageCfg = STAGE_CONFIG[st.stage] || STAGE_CONFIG.light;
    const rectY =
      st.stage === 'awake' ? 10 : st.stage === 'rem' ? 44 : st.stage === 'light' ? 76 : 108;
    const rectX = currentX;
    currentX += width;

    return (
      <g key={i}>
        <rect
          x={rectX}
          y={rectY}
          width={width}
          height={16}
          rx="3"
          fill={stageCfg.color}
          opacity={0.88}
        >
          <title>{`${stageCfg.label}: ${st.durationMinutes}分钟 (${st.startTime}-${st.endTime})`}</title>
        </rect>
        {i < stages.length - 1 && (
          <line
            x1={rectX + width}
            y1={rectY + 8}
            x2={rectX + width}
            y2={
              stages[i + 1].stage === 'awake'
                ? 18
                : stages[i + 1].stage === 'rem'
                ? 52
                : stages[i + 1].stage === 'light'
                ? 84
                : 116
            }
            stroke="#64748b"
            strokeWidth="1.2"
          />
        )}
      </g>
    );
  });

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between mb-2 text-xs">
        <div>
          <span className={`font-black ${theme?.textPrimary || 'text-white'} text-sm`}>90分钟睡眠周期推演（估算值）</span>
          <span className={`${textSecondary} font-mono ml-2 font-bold`}>
            {record.bedtime} - {record.wakeTime}
          </span>
        </div>
        <span className="font-mono text-emerald-300 bg-emerald-950 px-3 py-0.5 rounded-lg border border-emerald-600 font-bold">
          综合效率 {record.sleepEfficiency}%
        </span>
      </div>

      {/* SVG Timeline Chart */}
      <div className={`relative w-full h-36 select-none ${innerBg} rounded-2xl p-3 border ${innerBorder} shadow-inner`}>
        {/* Stage Y-axis labels */}
        <div className={`absolute left-2.5 top-2.5 bottom-6 flex flex-col justify-between text-xs ${textMuted} font-semibold pointer-events-none z-10`}>
          <span className="text-rose-400">清醒</span>
          <span className="text-indigo-300">REM</span>
          <span className="text-sky-300">浅睡</span>
          <span className="text-indigo-400 font-bold">深睡</span>
        </div>

        {/* Timeline SVG */}
        <svg className="w-full h-full" viewBox="0 0 400 130" preserveAspectRatio="none">
          {/* Horizontal guideline levels */}
          <line x1="38" y1="18" x2="395" y2="18" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1="38" y1="52" x2="395" y2="52" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1="38" y1="84" x2="395" y2="84" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1="38" y1="116" x2="395" y2="116" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />

          {/* Render stage blocks */}
          {stages.length > 0 && renderedBlocks}
        </svg>

        {/* Time X-axis */}
        <div className={`absolute left-10 right-2 bottom-1 flex justify-between text-xs ${textSecondary} font-mono font-medium`}>
          <span>{record.bedtime}</span>
          <span>{getMidpointTime(record.bedtime, record.wakeTime)}</span>
          <span>{record.wakeTime}</span>
        </div>
      </div>

      <div className="mt-3">
        {timeline ? (
          /* 「昨夜 vs 目标」时间轴。
             原先这里是一条四色堆叠条，但它的信息与上面泳道图、下面四个阶段
             方块完全重复。改成把「就寝比目标早 15 分钟」这件只停留在文字上的
             信息画出来：实际睡眠区间是实心条，目标是两根刻度。 */
          <>
            <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
              <span className={`${textSecondary} font-medium shrink-0`}>昨夜 vs 目标</span>
              {/* 时间轴已经把目标与实际都画出来了，下面还有一行解释白色刻度的含义，
                  卡片标题也已经有 23:15 – 07:10。所以这里只留两个差值，不复述钟点：
                  原来那串「就寝 23:15（早 15分钟）· 起床 07:10（早 20分钟）」在窄屏上会被截断。 */}
              <span className={`font-mono ${textMuted} truncate`}>
                就寝 {describeDelta(timeline.bedDeltaMinutes)} · 起床 {describeDelta(timeline.wakeDeltaMinutes)}
              </span>
            </div>
            <div className="relative h-7">
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-800 border border-slate-700" />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full border border-slate-900/60"
                style={{
                  left: `${timeline.actualStartPct}%`,
                  width: `${Math.max(0.5, timeline.actualEndPct - timeline.actualStartPct)}%`,
                  backgroundColor: theme?.accentHex || '#818cf8',
                }}
                title={`实际卧床 ${record.bedtime} → ${record.wakeTime}`}
              />
              <div
                className="absolute top-0.5 w-0.5 h-6 bg-white/70 rounded-full -translate-x-1/2"
                style={{ left: `${timeline.targetBedPct}%` }}
                title={`目标就寝 ${targetBedtime}`}
              />
              <div
                className="absolute top-0.5 w-0.5 h-6 bg-white/70 rounded-full -translate-x-1/2"
                style={{ left: `${timeline.targetWakePct}%` }}
                title={`目标起床 ${targetWakeTime}`}
              />
            </div>
            <div className={`flex justify-between text-[11px] font-mono ${textMuted} mt-0.5`}>
              <span>{timeline.startLabel}</span>
              <span>白色刻度 = 目标就寝 / 目标起床</span>
              <span>{timeline.endLabel}</span>
            </div>
          </>
        ) : (
          <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
            <div style={{ width: `${deepPercent}%` }} className={`${SLEEP_STAGE_COLORS.deep.className} h-full`} title={`深睡: ${deepPercent}%`} />
            <div style={{ width: `${lightPercent}%` }} className={`${SLEEP_STAGE_COLORS.light.className} h-full`} title={`浅睡: ${lightPercent}%`} />
            <div style={{ width: `${remPercent}%` }} className={`${SLEEP_STAGE_COLORS.rem.className} h-full`} title={`REM: ${remPercent}%`} />
            <div style={{ width: `${awakePercent}%` }} className={`${SLEEP_STAGE_COLORS.awake.className} h-full`} title={`清醒: ${awakePercent}%`} />
          </div>
        )}

        {/* Breakdown Legend */}
        <div className="grid grid-cols-4 gap-2 mt-3 text-center text-xs">
          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className={`w-2 h-2 rounded-full ${SLEEP_STAGE_COLORS.deep.className}`} />
              <span className={`text-xs ${textSecondary} font-medium`}>深睡</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.deepSleepMinutes}分</span>
            <span className="block text-xs text-indigo-400 font-mono font-medium">{deepShareOfTst}%</span>
            <span className={`block text-[11px] ${textMuted} font-mono`}>目标 18%</span>
          </div>

          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className={`w-2 h-2 rounded-full ${SLEEP_STAGE_COLORS.light.className}`} />
              <span className={`text-xs ${textSecondary} font-medium`}>浅睡</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.lightSleepMinutes}分</span>
            <span className="text-xs text-sky-300 font-mono font-medium">{lightShareOfTst}%</span>
          </div>

          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className={`w-2 h-2 rounded-full ${SLEEP_STAGE_COLORS.rem.className}`} />
              <span className={`text-xs ${textSecondary} font-medium`}>REM</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.remSleepMinutes}分</span>
            <span className="block text-xs text-pink-400 font-mono font-medium">{remShareOfTst}%</span>
            <span className={`block text-[11px] ${textMuted} font-mono`}>目标 20%</span>
          </div>

          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className={`w-2 h-2 rounded-full ${SLEEP_STAGE_COLORS.awake.className}`} />
              <span className={`text-xs ${textSecondary} font-medium`}>清醒</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.awakeMinutes}分</span>
            <span className="text-xs text-orange-300 font-mono font-medium">占卧床 {awakePercent}%</span>
          </div>
        </div>

        <div className="mt-2">
          <InfoNote theme={theme}>
            深睡 / 浅睡 / REM 占比按「总睡眠时长」计；清醒按「卧床时长」计，两者基准不同。
          </InfoNote>
        </div>
      </div>
    </div>
  );
};

function getMidpointTime(bedtime: string, wakeTime: string): string {
  const [bH, bM] = bedtime.split(':').map(Number);
  const [wH, wM] = wakeTime.split(':').map(Number);
  let bMin = bH * 60 + bM;
  let wMin = wH * 60 + wM;
  if (wMin <= bMin) wMin += 24 * 60;
  const midMin = Math.round((bMin + wMin) / 2) % (24 * 60);
  const h = String(Math.floor(midMin / 60)).padStart(2, '0');
  const m = String(midMin % 60).padStart(2, '0');
  return `${h}:${m}`;
}
