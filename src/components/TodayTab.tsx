import React, { useEffect, useState } from 'react';
import {
  Moon,
  Plus,
  Play,
  ArrowRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { SleepRecord, UserProfile } from '../types/sleep';
import { SleepHypnogram } from './SleepHypnogram';
import { formatDurationChinese } from '../utils/sleepScore';
import { OneTapSleepTracker } from './OneTapSleepTracker';
import { ThemeConfig } from '../utils/themeStyles';

interface TodayTabProps {
  records: SleepRecord[];
  userProfile: UserProfile;
  onOpenActiveSleep: () => void;
  onOpenManualLog: () => void;
  onNavigateToCoach: () => void;
  onSaveRecord?: (record: SleepRecord) => void;
  theme: ThemeConfig;
}

export const TodayTab: React.FC<TodayTabProps> = ({
  records,
  userProfile,
  onOpenActiveSleep,
  onOpenManualLog,
  onNavigateToCoach,
  onSaveRecord,
  theme,
}) => {
  const latestRecord = records[0] || null;

  // 得分环 + 数字 count-up（进入页面时 0 → 目标值，800ms 缓出）
  const [displayScore, setDisplayScore] = useState(0);
  useEffect(() => {
    if (!latestRecord) return;
    const target = Math.min(99, Math.max(25, latestRecord.sleepScore));
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [latestRecord?.sleepScore, latestRecord?.id]);

  const getScoreColor = (score: number) => {
    if (score >= 88) return { text: 'text-indigo-400', stroke: '#818cf8', label: '优' };
    if (score >= 78) return { text: 'text-emerald-400', stroke: '#34d399', label: '良' };
    if (score >= 68) return { text: 'text-amber-400', stroke: '#fbbf24', label: '平' };
    return { text: 'text-rose-400', stroke: '#f87171', label: '差' };
  };

  const scoreInfo = latestRecord ? getScoreColor(latestRecord.sleepScore) : getScoreColor(85);

  return (
    <div className={`space-y-4 ${theme.textPrimary}`}>
      {/* 1. Primary One-Tap Sleep Tracker */}
      {onSaveRecord && <OneTapSleepTracker onSaveRecord={onSaveRecord} theme={theme} targetDurationHours={userProfile.targetDurationHours} />}

      {/* 2. Last Sleep Overview Card with Unified Theme Colors */}
      {latestRecord ? (
        <div className={`rounded-3xl p-5 ${theme.cardBg} border ${theme.cardBorder} shadow-xl transition-colors`}>
          <div className="flex items-center justify-between text-xs mb-3 font-medium">
            <span className="text-white font-black flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
              最近一次睡眠生理报告
            </span>
            <span className="font-mono text-slate-300 font-bold">{latestRecord.date}</span>
          </div>

          <div className="flex items-center justify-between gap-5 my-1">
            {/* Score Ring */}
            <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" stroke="#334155" strokeWidth="8" fill="none" />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke={scoreInfo.stroke}
                  strokeWidth="8"
                  strokeDasharray={`${(displayScore / 100) * 251.2} 251.2`}
                  strokeLinecap="round"
                  fill="none"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-2xl font-black font-mono text-white tabular-nums leading-none">
                  {displayScore}
                </span>
                <span className={`text-[11px] font-black mt-1 ${scoreInfo.text}`}>
                  {scoreInfo.label}
                </span>
              </div>
            </div>

            {/* Metrics */}
            <div className="flex-1 space-y-2 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-slate-300 font-bold">总睡眠时长</span>
                <span className="font-black text-white font-mono text-sm">
                  {formatDurationChinese(latestRecord.durationMinutes)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-300 font-bold">入睡 / 醒来</span>
                <span className="font-mono text-slate-100 font-bold">
                  {latestRecord.bedtime} - {latestRecord.wakeTime}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-300 font-bold">深睡阶段</span>
                <span className="font-mono text-emerald-400 font-black">
                  {latestRecord.deepSleepMinutes}分 · {Math.round((latestRecord.deepSleepMinutes / Math.max(1, latestRecord.durationMinutes)) * 100)}%
                </span>
              </div>
              {userProfile.targetBedtime && (() => {
                const [bh, bm] = latestRecord.bedtime.split(':').map(Number);
                const [th, tm] = userProfile.targetBedtime.split(':').map(Number);
                let diff = bh * 60 + bm - (th * 60 + tm);
                if (diff > 720) diff -= 1440;
                if (diff < -720) diff += 1440;
                const txt = diff === 0 ? '与目标一致' : diff > 0 ? `晚于目标 ${diff} 分钟` : `早于目标 ${-diff} 分钟`;
                return (
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-300 font-bold">就寝 vs 目标</span>
                    <span className={`font-mono font-bold text-sm ${diff > 30 ? 'text-rose-400' : diff < -30 ? 'text-sky-400' : 'text-emerald-400'}`}>
                      {txt}
                    </span>
                  </div>
                );
              })()}
              <div className="pt-1 text-[10px] text-slate-500">
                评分为按作息推演的模型估算值，非医疗诊断，仅作生活方式参考。
              </div>
              {latestRecord.sleepScore < 75 && (
                <div className="pt-1 text-[11px] text-amber-300/90 font-medium">
                  💡 提示：睡眠评分自然波动属正常现象，身体今夜会自动通过增加深睡代偿，无需担忧。
                </div>
              )}
            </div>
          </div>

          {latestRecord.dreamNotes && (
            <div className="mt-3 pt-3 border-t border-slate-700/80 text-xs text-slate-200">
              <span className="text-indigo-300 font-bold">梦境记录：</span>{latestRecord.dreamNotes}
            </div>
          )}
        </div>
      ) : (
        <div className={`rounded-3xl p-6 ${theme.cardBg} border ${theme.cardBorder} text-center space-y-2 shadow-lg`}>
          <div className={`w-12 h-12 rounded-2xl ${theme.cardInnerBg} border ${theme.cardBorder} flex items-center justify-center mx-auto shadow-inner`}>
            <Moon className={`w-6 h-6 ${theme.accentText}`} />
          </div>
          <h4 className="text-sm font-bold text-white pt-1">暂无睡眠记录</h4>
          <p className={`text-xs ${theme.textMuted}`}>点击上方开始就寝，或通过下方快速补录真实作息</p>
        </div>
      )}

      {/* 3. Hypnogram Chart (Tonight Stage Distribution) */}
      {latestRecord && (
        <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl transition-colors`}>
          <SleepHypnogram record={latestRecord} theme={theme} />
        </div>
      )}

      {/* 4. Action Cards for Manual Log & Bedside Monitor */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={onOpenManualLog}
          className={`p-4 rounded-2xl ${theme.cardBg} border ${theme.cardBorder} hover:border-slate-500 text-left transition-all active:scale-[0.98] group cursor-pointer shadow-md`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className={`w-8 h-8 rounded-xl ${theme.cardInnerBg} ${theme.accentText} flex items-center justify-center border ${theme.cardBorder}`}>
              <Plus className="w-4 h-4 stroke-[3]" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </div>
          <span className="text-sm font-bold text-white block">晨起手动补录</span>
          <span className={`text-xs ${theme.textMuted} mt-0.5 block font-medium`}>按昨夜真实起居补记</span>
        </button>

        <button
          type="button"
          onClick={onOpenActiveSleep}
          className={`p-4 rounded-2xl ${theme.cardBg} border ${theme.cardBorder} hover:border-slate-500 text-left transition-all active:scale-[0.98] group cursor-pointer shadow-md`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className={`w-8 h-8 rounded-xl ${theme.cardInnerBg} ${theme.accentText} flex items-center justify-center border ${theme.cardBorder}`}>
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </div>
          <span className="text-sm font-bold text-white block">床头夜钟伴眠</span>
          <span className={`text-xs ${theme.textMuted} mt-0.5 block font-medium`}>极简暗屏 · 助眠白噪</span>
        </button>
      </div>

      {/* 5. Coach Card Prompt */}
      <div
        onClick={onNavigateToCoach}
        className={`p-4 rounded-2xl ${theme.cardBg} border ${theme.cardBorder} flex items-center justify-between cursor-pointer hover:border-slate-500 transition-all shadow-md`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl ${theme.cardInnerBg} ${theme.accentText} flex items-center justify-center border ${theme.cardBorder}`}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-white">AI 睡眠节律智能问诊</h4>
            <p className={`text-[11px] ${theme.textMuted} font-medium`}>基于近期 7 天数据定制恢复方案</p>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-400" />
      </div>
    </div>
  );
};
