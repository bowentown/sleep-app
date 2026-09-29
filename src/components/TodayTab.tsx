import React, { useEffect, useState } from 'react';
import {
  Plus,
  Play,
  ArrowRight,
  Clock,
  Sparkles,
  Wind,
  ChevronDown,
} from 'lucide-react';
import { SleepRecord, UserProfile } from '../types/sleep';
import { SleepHypnogram } from './SleepHypnogram';
import { formatDurationChinese } from '../utils/sleepScore';
import { OneTapSleepTracker } from './OneTapSleepTracker';
import { BreathingExercise } from './BreathingExercise';
import { ThemeConfig } from '../utils/themeStyles';
import { buildMorningSummary, describeWeekExtreme, describeDelta, minutesSinceNoon, describeVsSelf, describeMoodVsScore, scoreBand } from '../utils/sleepInsights';

interface TodayTabProps {
  records: SleepRecord[];
  userProfile: UserProfile;
  onOpenActiveSleep: () => void;
  onOpenManualLog: () => void;
  onSaveRecord?: (record: SleepRecord) => void;
  theme: ThemeConfig;
}

export const TodayTab: React.FC<TodayTabProps> = ({
  records,
  userProfile,
  onOpenActiveSleep,
  onOpenManualLog,
  onSaveRecord,
  theme,
}) => {
  const latestRecord = records[0] || null;

  // 呼吸练习默认收起。首屏的排版密度已经调过一轮（工具入口刻意降权成轻量列表行），
  // 直接摊开一个 171 行的卡片会把「工具」重新抬到和「数据」一样重。
  const [showBreathing, setShowBreathing] = useState(false);

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

  // 档位判定只此一处（scoreBand），颜色映射留在这里。
  // 原先档位是在这个函数里写死的，别处想判断"优/良/平/差"只能再抄一遍阈值。
  const getScoreColor = (score: number) => {
    const label = scoreBand(score);
    if (label === '优') return { text: 'text-indigo-400', stroke: '#818cf8', label };
    if (label === '良') return { text: 'text-emerald-400', stroke: '#34d399', label };
    if (label === '平') return { text: 'text-amber-400', stroke: '#fbbf24', label };
    return { text: 'text-rose-400', stroke: '#f87171', label };
  };

  const scoreInfo = latestRecord ? getScoreColor(latestRecord.sleepScore) : getScoreColor(85);

  // 「和你自己比」。放在分数**之前**：睡眠领域唯一一项 MRT 实测（Takeuchi 2024）
  // 有效的形式就是自指对照，而不是给一个绝对分数；且它对本来睡眠稳定的组完全无效应。
  // 可用晚数不足时 describeVsSelf 返回 null，此处不显示——宁可不给，也不给不可靠的数。
  const vsSelf = describeVsSelf(records);

  // 分数与「你自己记录的感受」矛盾时才出现。
  // wakingMood 此前被录入却从未被读取——App 问了用户醒来什么感觉，然后扔掉。
  // 而用户的主观感受是这件事上比分数更硬的证据（见 describeMoodVsScore 的注释）。
  // 一致时不显示：JITAI 要求显式设计"不提供任何东西"，多说一句只会让这条失去分量。
  const moodConflict = describeMoodVsScore(latestRecord);

  // 起床后的一句话总结。报告卡本身是一张数据表，人得自己把数字翻译成结论；
  // 这句话只做「把已有数字串成一个判断」，比较的对象（目标时长、目标就寝、
  // 本周最高/最低分）全部来自记录本身，不做任何医学推断。
  const weekRecords = records.slice(0, 7);
  // 本周最佳/最差：卡片头部的徽标
  const weekExtreme = latestRecord ? describeWeekExtreme(latestRecord, weekRecords) : null;
  const morningSummary = latestRecord
    ? buildMorningSummary(
        latestRecord,
        weekRecords,
        Math.round(userProfile.targetDurationHours * 60),
        userProfile.targetBedtime
      )
    : '';

  return (
    <div className={`space-y-4 ${theme.textPrimary}`}>
      {/* 1. Primary One-Tap Sleep Tracker */}
      {onSaveRecord && <OneTapSleepTracker onSaveRecord={onSaveRecord} theme={theme} targetDurationHours={userProfile.targetDurationHours} targetBedtime={userProfile.targetBedtime} />}

      {/* 2. Last Sleep Overview Card —— 全页「主角卡」
          其它卡片都是「同样的圆角 + 同样的填充 + 同样的 1px 边框」，
          结果没有层级，用户第一眼不知道该看哪里。这里让总结卡不带边框、
          圆角更大，并用主题色叠一层极淡的斜向渐变，把视觉重量集中过来；
          数据卡沿用原来的中性处理，工具入口进一步弱化成列表行。 */}
      {latestRecord ? (
        <div
          className={`rounded-[26px] p-5 ${theme.cardBg} shadow-xl transition-colors relative overflow-hidden`}
          style={{ backgroundImage: `linear-gradient(135deg, ${theme.accentHex}26, transparent 58%)` }}
        >
          <div className="flex items-center justify-between text-xs mb-3 font-medium">
            <span className="text-white font-black flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: theme.accentHex }}></span>
              昨夜睡眠小结
            </span>
            <span className="flex items-center gap-2">
              {/* 「本周最佳/最差」放在日期旁边：它讲的是这一周，不是这一晚。
                  原来拼在小结里，那一行要 315px 而可用宽只有 326px。 */}
              {weekExtreme && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                  weekExtreme === '本周最佳'
                    ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'
                    : 'text-amber-300 border-amber-400/30 bg-amber-400/10'
                }`}>{weekExtreme}</span>
              )}
              <span className="font-mono text-slate-300 font-bold">{latestRecord.date}</span>
            </span>
          </div>

          {/* 一句话结论放在最显眼的位置：数据表保留，但先给判断，再给依据。 */}
          <p className="text-sm leading-relaxed text-slate-100 font-medium mb-3">
            {morningSummary}
          </p>

          {/* 自指对照放在分数之前。
              分数是「绝对判定」，这条是「相对你自己的变化」——后者才是被实测验证有效的形式。
              同时分数环整体降一级（w-20→w-16、text-2xl→text-[17px]）：
              它 40 分来自推演的分期，且深睡分在实测输入下几乎恒为满分，
              原来的视觉权重（整张卡最大的元素）与它能承载的信息量不匹配。 */}
          {vsSelf && (
            <p className="text-sm leading-relaxed text-slate-100 mb-2">{vsSelf.text}</p>
          )}

          {moodConflict && (
            <p className="text-sm leading-relaxed text-amber-200 font-medium mb-2">{moodConflict}</p>
          )}

          <div className="flex items-center justify-between gap-5 my-1">
            {/* Score Ring（已降级：不再抢占视觉主导权） */}
            <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
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
                <span className="text-[17px] font-black font-mono text-white tabular-nums leading-none">
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
                {/* 这一行原来用绿色显示、且不带任何来源说明，看起来和上面的「总睡眠时长」
                    一样是测出来的。但它不是：用户只填了就寝/起床/入睡用时/夜醒次数，
                    分期是按固定周期模型推算的（详见 utils/sleepFindings 的 provenance）。
                    绿色在这张卡里意味着「这一项好」，而实测这个数字主要反映睡眠时长，
                    睡得越少反而越高——所以既不该用它表达好坏，也不能不带来源标记。 */}
                <span className="text-slate-300 font-bold">
                  深睡阶段
                  <span className="ml-1 text-[11px] font-normal text-slate-500">推演</span>
                </span>
                <span className="font-mono text-slate-200 font-black">
                  {latestRecord.deepSleepMinutes}分 · {Math.round((latestRecord.deepSleepMinutes / Math.max(1, latestRecord.durationMinutes)) * 100)}%
                </span>
              </div>
              {userProfile.targetBedtime && (() => {
                // 复用 utils/sleepInsights 的跨午夜换算与差值文案。
                // 这里原本自己写了一套 ±720 分钟的启发式来纠正跨午夜，是同一件事的
                // 第二份实现；而且它把 193 分钟直接显示成「193 分钟」，与同一张卡里
                // 一句话总结和时间轴用的「3小时13分」不是一个口径。
                // describeDelta 的容差是 10 分钟，与时间轴保持一致，避免同一张卡
                // 两处对同一个 6 分钟差异给出不同说法（一处「基本准时」一处「晚 6 分钟」）。
                const bedMin = minutesSinceNoon(latestRecord.bedtime);
                const targetMin = minutesSinceNoon(userProfile.targetBedtime);
                if (!Number.isFinite(bedMin) || !Number.isFinite(targetMin)) return null;
                const diff = bedMin - targetMin;
                const txt = describeDelta(diff);
                return (
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-300 font-bold">就寝 vs 目标</span>
                    <span className={`font-mono font-bold text-sm ${diff > 30 ? 'text-rose-400' : diff < -30 ? 'text-sky-400' : 'text-emerald-400'}`}>
                      {txt}
                    </span>
                  </div>
                );
              })()}
              <div className="pt-1 text-xs text-slate-500">
                时长与就寝为你的实际记录；深睡分期由作息推演，手机无法测量。
                综合评分含 40 分的推演分期，仅供你与自己比较，非医疗诊断。
              </div>
              {latestRecord.sleepScore < 75 && (
                <div className="pt-1 text-[11px] text-amber-300/90 font-medium">
                  💡 单晚分数波动很正常，不用据此调整今天的作息。想改善的话，
                  先固定起床时间——它比固定就寝时间更容易做到。
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
        /* 空状态不再放「又一个新月」：顶部品牌区已经是新月，就寝卡里也有一个，
           同一个造型出现三次就不再是品牌符号而是装饰。这里改用虚线框表达
           「位置留空、报告将出现在这里」，也不再用「上方/下方」描述布局
           （布局一变文案就错）。 */
        <div className={`rounded-3xl p-6 border border-dashed ${theme.cardBorder} text-center space-y-2`}>
          <h4 className="text-sm font-bold text-white">还没有睡眠记录</h4>
          <p className={`text-xs ${theme.textMuted}`}>完成一次就寝，这里会显示昨夜的分期结构与睡眠评分</p>
        </div>
      )}

      {/* 3. Hypnogram Chart (Tonight Stage Distribution) */}
      {latestRecord && (
        <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl transition-colors`}>
          <SleepHypnogram
            record={latestRecord}
            theme={theme}
            targetBedtime={userProfile.targetBedtime}
            targetWakeTime={userProfile.targetWakeTime}
          />
        </div>
      )}

      {/* 4. 工具入口
          这三个入口原本是三张与数据卡同等重量的卡片（同样的填充、边框、圆角、
          阴影），于是「工具」和「内容」在视觉上一样重，页面没有焦点。
          现在收进一张卡里，改成轻量列表行：无独立底色、无阴影，只用分隔线区分，
          图标也不再套描边方块。信息一字未减，但视觉重量降到数据卡之下。 */}
      <div className={`rounded-2xl ${theme.cardBg} border ${theme.cardBorder} overflow-hidden`}>
        <button
          type="button"
          onClick={onOpenManualLog}
          className={`w-full px-4 py-3 flex items-center gap-3 text-left border-b ${theme.cardBorder} hover:bg-white/[0.04] transition-colors active:bg-white/[0.07] cursor-pointer group`}
        >
          <Plus className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
          <span className="flex-1 min-w-0">
            <span className="text-xs font-bold text-white block">记录昨夜睡眠</span>
            <span className={`text-[11px] ${theme.textMuted} font-medium block`}>按真实起居时间补记</span>
          </span>
          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors shrink-0" />
        </button>

        <button
          type="button"
          onClick={onOpenActiveSleep}
          className={`w-full px-4 py-3 flex items-center gap-3 text-left border-b ${theme.cardBorder} hover:bg-white/[0.04] transition-colors active:bg-white/[0.07] cursor-pointer group`}
        >
          <Play className={`w-4 h-4 shrink-0 fill-current ${theme.accentText}`} />
          <span className="flex-1 min-w-0">
            <span className="text-xs font-bold text-white block">助眠音景</span>
            <span className={`text-[11px] ${theme.textMuted} font-medium block`}>极简暗屏 · 白噪掩蔽</span>
          </span>
          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors shrink-0" />
        </button>

        {/* 睡前呼吸练习：与上面两条一样是轻量列表行，点开才展开内容 */}
        <button
          type="button"
          onClick={() => setShowBreathing((v) => !v)}
          aria-expanded={showBreathing}
          className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.04] transition-colors active:bg-white/[0.07] cursor-pointer group ${
            showBreathing ? `border-b ${theme.cardBorder}` : ''
          }`}
        >
          <Wind className={`w-4 h-4 shrink-0 ${theme.accentText}`} />
          <span className="flex-1 min-w-0">
            <span className="text-xs font-bold text-white block">睡前呼吸练习</span>
            <span className={`text-[11px] ${theme.textMuted} font-medium block`}>4-7-8 · 呼气比吸气长</span>
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 group-hover:text-white transition-transform shrink-0 ${
              showBreathing ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showBreathing && (
          <div className="p-3">
            <BreathingExercise />
          </div>
        )}

      </div>
    </div>
  );
};
