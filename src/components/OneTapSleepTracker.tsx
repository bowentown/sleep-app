import React, { useState, useEffect } from 'react';
import { BedDouble, Sun, AlertTriangle } from 'lucide-react';
import { SleepRecord } from '../types/sleep';
import { formatDurationChinese, clockAfter, DEFAULT_LATENCY_MINUTES } from '../utils/sleepScore';
import { buildSleepRecord } from '../utils/sleepRecord';
import { toLocalDateString, toLocalTimeString } from '../utils/dateUtils';
import { ThemeConfig } from '../utils/themeStyles';
import { getBedtimeStatus } from '../utils/sleepInsights';
import { getMoonInfo } from '../utils/moonPhase';
import { MoonDisc } from './MoonDisc';

interface OneTapSleepTrackerProps {
  onSaveRecord: (record: SleepRecord) => void;
  theme: ThemeConfig;
  targetDurationHours?: number;
  /** 目标就寝时间 "HH:mm"，用于让这张卡按当前时间显示不同状态 */
  targetBedtime?: string;
}

export const OneTapSleepTracker: React.FC<OneTapSleepTrackerProps> = ({ onSaveRecord, theme, targetDurationHours, targetBedtime = '23:00' }) => {
  const [sleepStartTime, setSleepStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('somnacare_bedtime_start');
    return saved ? Number(saved) : null;
  });

  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  // 就寝状态是按当前时间算的，不刷新的话跨过整点文案就不对了。
  // 30 秒一次足够，代价可以忽略。
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [completedRecord, setCompletedRecord] = useState<SleepRecord | null>(null);

  useEffect(() => {
    if (!sleepStartTime) {
      setElapsedMinutes(0);
      return;
    }

    const updateTime = () => {
      const diffMin = Math.max(0, Math.floor((Date.now() - sleepStartTime) / 60000));
      setElapsedMinutes(diffMin);
    };

    updateTime();
    const interval = window.setInterval(updateTime, 5000);
    return () => window.clearInterval(interval);
  }, [sleepStartTime]);

  const handleStartSleep = () => {
    const now = Date.now();
    setSleepStartTime(now);
    localStorage.setItem('somnacare_bedtime_start', String(now));
  };

  const handleWakeUp = () => {
    if (!sleepStartTime) return;

    const startDate = new Date(sleepStartTime);
    const wakeDate = new Date();

    const bedtimeStr = toLocalTimeString(startDate);
    // 卧床时长取实测值；wakeTime 由 bedtime + 实测分钟数派生，
    // 保证 bedtime→wakeTime 的跨度与实测值精确一致（否则秒级取整会让效率偏 1%）
    const timeInBed = Math.max(1, Math.round((wakeDate.getTime() - sleepStartTime) / 60000));
    const wakeTimeStr = clockAfter(bedtimeStr, timeInBed);
    const isMicroSession = timeInBed < 15;

    const newRecord: SleepRecord = buildSleepRecord({
      id: `onetap-${Date.now()}`,
      // 本地日期（此前是 toISOString 的 UTC 日期：早 6-9 点醒来会落到 UTC 前一天，
      // 跨夜两条记录算出同一 date，被 App 的去重逻辑静默覆盖）
      date: toLocalDateString(wakeDate),
      bedtime: bedtimeStr,
      wakeTime: wakeTimeStr,
      latencyMinutes: isMicroSession ? 2 : DEFAULT_LATENCY_MINUTES,
      wakeCount: isMicroSession ? 0 : 1,
      // 这里原来是 `timeInBed < 30 ? 'tired' : 'refreshed'`——**用时长编造主观感受**。
      // 一键记录本来就不问感受，凭 30 分钟编一个出来，等于替用户说他醒来是什么感觉，
      // 而且方向必然与分数一致（睡得短→tired），把「感受」变成分数的回声。
      // 改用 'neutral'：这也是 buildSleepRecord 里 `input.wakingMood ?? 'neutral'` 的既有默认，
      // 且 describeMoodVsScore 明确不把 neutral 当作「感觉不错」，不会凑出假的矛盾。
      wakingMood: 'neutral',
      preSleepHabits: [],
      targetDurationMinutes: Math.round((targetDurationHours || 8) * 60),
    });

    localStorage.removeItem('somnacare_bedtime_start');
    setSleepStartTime(null);
    setCompletedRecord(newRecord);
    setShowSummaryModal(true);
    onSaveRecord(newRecord);
  };

  const handleCancelSession = () => {
    localStorage.removeItem('somnacare_bedtime_start');
    setSleepStartTime(null);
  };

  const formatElapsed = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} 分钟`;
    return `${h} 小时 ${m} 分钟`;
  };

  // 这张卡以前是静态的「今晚准备入睡」，22:40 和凌晨 1 点看到的完全一样。
  // 现在主文案随当前时间变化：临近目标就寝倒计时，超过目标就寝提醒。
  const bedtimeStatus = getBedtimeStatus(clock, targetBedtime);

  const statusToneClass =
    bedtimeStatus.tone === 'overdue'
      ? 'text-rose-300'
      : bedtimeStatus.tone === 'windDown'
        ? theme.accentText
        : theme.textMuted;

  return (
    <>
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-lg transition-all relative overflow-hidden`}>
        {!sleepStartTime ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* 这里原本是 lucide 的 Moon，和页头品牌标识、底部导航是同一个造型。
                    同一个图形在一屏出现三次就不再是品牌符号而是装饰，所以改用
                    与「上床就寝」语义直接相关的床，把新月留给品牌标识本身。 */}
                <div className={`w-11 h-11 rounded-2xl ${theme.cardInnerBg} border ${theme.cardBorder} flex items-center justify-center shadow-inner`}>
                  <BedDouble className={`w-5 h-5 ${theme.accentText}`} />
                </div>
                <div>
                  <h3 className={`text-[17px] font-black tracking-wide ${bedtimeStatus.tone === 'daytime' ? 'text-white' : statusToneClass}`}>
                    {bedtimeStatus.headline}
                  </h3>
                  <p className={`text-xs ${theme.textMuted} mt-0.5`}>{bedtimeStatus.detail}</p>
                </div>
              </div>
            </div>

            {/* 真实月相：与日期同步，有物理依据而不是随机装饰。
                月相可精确计算，所以这一行每天都不一样，也顺带让这张卡有变化。 */}
            <div className="flex items-center gap-2">
              <MoonDisc
                size={16}
                date={clock}
                litColor={theme.accentHex}
                darkColor="rgba(15,23,42,0.55)"
              />
              {/* 一次成型一个文本节点。JSX 里写成 今夜{名} · 月龄 {数} 天 会被拆成
                  多个文本节点，React 在它们之间插入注释标记，自动化匹配与复制粘贴
                  拿到的都是碎片。 */}
              <span className={`text-[11px] ${theme.textMuted} font-medium`}>
                {(() => {
                  const moon = getMoonInfo(clock);
                  return `今夜${moon.phaseName} · 月龄 ${moon.age.toFixed(1)} 天`;
                })()}
              </span>
            </div>

            <button
              type="button"
              onClick={handleStartSleep}
              className={`w-full py-3 px-5 rounded-2xl ${theme.accentBg} text-white font-black text-xs tracking-wider flex items-center justify-center gap-2 active:scale-[0.99] transition-all cursor-pointer shadow-lg animate-cta-breathe`}
            >
              <span>轻按开启今夜就寝记录</span>
              <span className="text-sm">→</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs px-1 font-bold">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 font-black text-sm">
                  正在实时记录中 · 已就寝 {formatElapsed(elapsedMinutes)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelSession}
                className="text-slate-400 hover:text-white text-xs underline cursor-pointer"
              >
                取消记录
              </button>
            </div>

            <button
              type="button"
              onClick={handleWakeUp}
              className="w-full py-3 px-5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black flex items-center justify-between active:scale-[0.99] transition-all cursor-pointer shadow-xl"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-black/10 flex items-center justify-center">
                  <Sun className="w-5 h-5 text-slate-950 fill-current" />
                </div>
                <div className="text-left">
                  <span className="text-sm font-black tracking-wide block text-slate-950">
                    已醒来 · 记录本次实际时长
                  </span>
                  <span className="text-[11px] text-slate-800 font-bold">按实际入睡分钟数精准结算</span>
                </div>
              </div>
              <span className="text-xs font-black bg-black/10 px-3 py-2 rounded-xl text-slate-950">
                完成本次睡眠 →
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Completion Modal - 100% Solid & Strict Duration Display */}
      {showSummaryModal && completedRecord && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4">
          <div className={`${theme.cardBg} border-2 border-indigo-400 rounded-3xl w-full max-w-sm p-6 text-white shadow-2xl text-center`}>
            <div className="text-sm font-bold text-indigo-300 mb-1">
              {completedRecord.durationMinutes < 30 ? '记录完毕 · 微睡眠/短时记录' : '晨安！恭喜完成睡眠'}
            </div>

            <h3 className="text-2xl font-black tracking-tight text-white mb-2">
              本次睡眠评定 {completedRecord.sleepScore} 分
            </h3>

            {completedRecord.durationMinutes < 30 && (
              <div className="mb-4 text-xs text-amber-300 bg-amber-950/60 p-3 rounded-xl border border-amber-500/40 flex items-center gap-2 text-left">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>记录时长为 {completedRecord.durationMinutes} 分钟，按你实际开始/结束时间计算，未做拉长。</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 mb-6">
              <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
                <span className="text-xs text-slate-300 block mb-1 font-bold">实际时长</span>
                <span className="text-[17px] font-black font-mono text-white">
                  {completedRecord.durationMinutes < 60
                    ? `${completedRecord.durationMinutes}分钟`
                    : `${(completedRecord.durationMinutes / 60).toFixed(1)}h`}
                </span>
              </div>
              <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
                <span className="text-xs text-slate-300 block mb-1 font-bold">深睡时长</span>
                <span className="text-[17px] font-black font-mono text-emerald-400">
                  {completedRecord.deepSleepMinutes}分
                </span>
              </div>
              <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
                <span className="text-xs text-slate-300 block mb-1 font-bold">睡眠效率</span>
                <span className="text-[17px] font-black font-mono text-indigo-300">
                  {completedRecord.sleepEfficiency}%
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSummaryModal(false)}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm transition-colors cursor-pointer shadow-lg"
            >
              确定并查看详情
            </button>
          </div>
        </div>
      )}
    </>
  );
};
