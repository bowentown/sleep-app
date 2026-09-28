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
import { ThemeConfig } from '../utils/themeStyles';

interface TrendsTabProps {
  records: SleepRecord[];
  onDeleteRecord?: (id: string) => void;
  theme: ThemeConfig;
  /** 初始视图。默认「趋势与结构」，可让调用方直接落到某个视图（也便于渲染层自检） */
  initialViewMode?: MetricViewMode;
}

export type MetricViewMode = 'quality' | 'stages' | 'circadian';

export const TrendsTab: React.FC<TrendsTabProps> = ({
  records,
  onDeleteRecord,
  theme,
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

  const getScoreCoordinates = () => {
    if (last7Records.length === 0) return '';
    const step = 280 / Math.max(1, last7Records.length - 1);
    return last7Records.map((r, i) => `${i * step},${scoreY(r.sleepScore)}`).join(' ');
  };

  return (
    <div className={`space-y-3 pb-28 ${theme.textPrimary}`}>
      {/* 1. Concise Overview Numbers */}
      <div className="grid grid-cols-3 gap-2">
        <div className={`${theme.cardBg} rounded-2xl p-3 border ${theme.cardBorder} text-center`}>
          <span className={`text-[11px] font-medium ${theme.textMuted} block`}>近7日均分</span>
          <span className={`text-xl font-black font-mono ${accentText} tabular-nums`}>{avgScore}</span>
        </div>

        <div className={`${theme.cardBg} rounded-2xl p-3 border ${theme.cardBorder} text-center`}>
          <span className={`text-[11px] font-medium ${theme.textMuted} block`}>日均睡眠</span>
          <span className="text-xl font-black font-mono text-white tabular-nums">
            {(avgDuration / 60).toFixed(1)}h
          </span>
        </div>

        <div className={`${theme.cardBg} rounded-2xl p-3 border ${theme.cardBorder} text-center`}>
          <span className={`text-[11px] font-medium ${theme.textMuted} block`}>深睡占比</span>
          <span className="text-xl font-black font-mono text-emerald-400 tabular-nums">{avgDeepRatio}%</span>
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
              <div className="absolute inset-x-3 top-4 border-b border-dashed border-emerald-500/30 flex justify-between text-[10px] text-emerald-400 font-mono">
                <span>90分 达标线</span>
              </div>
              <div className={`absolute inset-x-3 top-18 border-b border-dashed ${innerBorder} flex justify-between text-[10px] ${textMuted} font-mono`}>
                <span>75分 警戒线</span>
              </div>

              <svg className="w-full h-24 overflow-visible my-auto" viewBox="0 0 280 80">
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.accentHex} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={theme.accentHex} stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {last7Records.length > 1 && (
                  <polygon
                    points={`0,80 ${getScoreCoordinates()} 280,80`}
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
                  const step = 280 / Math.max(1, last7Records.length - 1);
                  const x = i * step;
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
              </svg>

              <div className={`text-right text-[9px] ${textMuted} font-mono`}>
                纵轴 {axisLo}–{axisHi} 分（按本周实际得分自适应）
              </div>

              <div className={`flex justify-between text-[10px] ${textMuted} font-mono pt-1 border-t ${innerBorder}`}>
                {last7Records.map((r) => (
                  <span
                    key={r.id}
                    onClick={() => setHoveredRecord(r)}
                    className={`cursor-pointer ${
                      activeRecord?.id === r.id ? accentText + ' font-bold' : 'hover:text-white'
                    }`}
                  >
                    {r.date.slice(5)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* View Mode 2: Sleep Stages */}
        {viewMode === 'stages' && (
          <div className="space-y-2 animate-in fade-in">
            <div className={`h-40 ${theme.cardInnerBg} rounded-2xl p-3 border ${theme.cardInnerBorder} flex flex-col justify-between`}>
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

                  return (
                    <div
                      key={r.id}
                      onClick={() => setHoveredRecord(r)}
                      className="flex-1 flex flex-col items-center h-full justify-end cursor-pointer group"
                    >
                      <div
                        className={`w-full max-w-[24px] h-20 rounded-md overflow-hidden flex flex-col-reverse ${
                          isHovered ? 'ring-2 ring-indigo-400 shadow' : ''
                        }`}
                      >
                        <div style={{ height: `${deepPct}%`, backgroundColor: theme.accentHex }} />
                        <div style={{ height: `${lightPct}%` }} className="bg-sky-400" />
                        <div style={{ height: `${remPct}%` }} className="bg-indigo-300" />
                        <div style={{ height: `${awakePct}%` }} className="bg-rose-400" />
                      </div>

                      <span
                        className={`text-[9px] font-mono mt-1 ${
                          isHovered ? accentText + ' font-bold' : textMuted
                        }`}
                      >
                        {r.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className={`flex flex-col items-center gap-1 pt-1 border-t ${innerBorder} text-[10px] ${textSecondary}`}>
                <div className="flex justify-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: theme.accentHex }} />深睡
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-300" />REM
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />浅睡
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-400" />清醒
                  </span>
                </div>
                <span className={`text-[9px] ${textMuted} font-sans`}>
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
