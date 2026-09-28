import React from 'react';
import { SleepRecord, SleepStage } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';

interface SleepHypnogramProps {
  record: SleepRecord;
  theme?: ThemeConfig;
}

const STAGE_CONFIG: Record<SleepStage, { label: string; color: string; yOffset: number; height: number }> = {
  awake: { label: '清醒', color: '#f87171', yOffset: 10, height: 18 },
  rem: { label: 'REM (快速眼动)', color: '#818cf8', yOffset: 45, height: 22 },
  light: { label: '浅睡', color: '#38bdf8', yOffset: 85, height: 24 },
  deep: { label: '深睡', color: '#6366f1', yOffset: 125, height: 26 },
};

export const SleepHypnogram: React.FC<SleepHypnogramProps> = ({ record, theme }) => {
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
        <span className="font-mono text-emerald-300 bg-emerald-950 px-2.5 py-0.5 rounded-lg border border-emerald-600 font-bold">
          综合效率 {record.sleepEfficiency}%
        </span>
      </div>

      {/* SVG Timeline Chart */}
      <div className={`relative w-full h-36 select-none ${innerBg} rounded-2xl p-2.5 border ${innerBorder} shadow-inner`}>
        {/* Stage Y-axis labels */}
        <div className={`absolute left-2.5 top-2.5 bottom-6 flex flex-col justify-between text-[10px] ${textMuted} font-semibold pointer-events-none z-10`}>
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
        <div className={`absolute left-10 right-2 bottom-1 flex justify-between text-[10px] ${textSecondary} font-mono font-medium`}>
          <span>{record.bedtime}</span>
          <span>{getMidpointTime(record.bedtime, record.wakeTime)}</span>
          <span>{record.wakeTime}</span>
        </div>
      </div>

      {/* Stage Percentage Bar */}
      <div className="mt-3">
        <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
          <div style={{ width: `${deepPercent}%` }} className="bg-indigo-500 h-full" title={`深睡: ${deepPercent}%`} />
          <div style={{ width: `${lightPercent}%` }} className="bg-sky-400 h-full" title={`浅睡: ${lightPercent}%`} />
          <div style={{ width: `${remPercent}%` }} className="bg-indigo-300 h-full" title={`REM: ${remPercent}%`} />
          <div style={{ width: `${awakePercent}%` }} className="bg-rose-400 h-full" title={`清醒: ${awakePercent}%`} />
        </div>

        {/* Breakdown Legend */}
        <div className="grid grid-cols-4 gap-2 mt-3 text-center text-xs">
          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className={`text-xs ${textSecondary} font-medium`}>深睡</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.deepSleepMinutes}分</span>
            <span className="text-[10px] text-indigo-300 font-mono font-medium">{deepShareOfTst}% (目标&gt;18%)</span>
          </div>

          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span className={`text-xs ${textSecondary} font-medium`}>浅睡</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.lightSleepMinutes}分</span>
            <span className="text-[10px] text-sky-300 font-mono font-medium">{lightShareOfTst}%</span>
          </div>

          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-300" />
              <span className={`text-xs ${textSecondary} font-medium`}>REM</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.remSleepMinutes}分</span>
            <span className="text-[10px] text-indigo-300 font-mono font-medium">{remShareOfTst}% (目标&gt;20%)</span>
          </div>

          <div className={`p-2 rounded-xl ${statBg} border ${innerBorder} shadow-inner`}>
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span className={`text-xs ${textSecondary} font-medium`}>清醒</span>
            </div>
            <span className={`font-bold ${theme?.textPrimary || 'text-white'} mt-0.5 block tabular-nums text-sm`}>{record.awakeMinutes}分</span>
            <span className="text-[10px] text-rose-300 font-mono font-medium">占卧床 {awakePercent}%</span>
          </div>
        </div>

        <p className={`mt-2 text-[9px] ${textMuted} leading-relaxed`}>
          深睡 / 浅睡 / REM 占比为占「总睡眠时长」，与临床目标同口径；清醒为占「卧床时长」。
          上方堆叠条按卧床时长划分，四段合计 100%。
        </p>
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
