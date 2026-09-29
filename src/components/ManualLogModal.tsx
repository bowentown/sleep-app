import React, { useState } from 'react';
import { X, Moon, Clock, Check } from 'lucide-react';
import { HABIT_OPTIONS, DEFAULT_HABITS, toggleHabit } from '../utils/preSleepHabits';
import { SleepRecord, WakingMood } from '../types/sleep';
import { buildSleepRecord } from '../utils/sleepRecord';
import { ThemeConfig } from '../utils/themeStyles';
import { useModalA11y } from '../utils/modalA11y';

interface ManualLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveRecord: (record: SleepRecord) => void;
  theme?: ThemeConfig;
  targetDurationHours?: number;
}

export const ManualLogModal: React.FC<ManualLogModalProps> = ({
  isOpen,
  onClose,
  onSaveRecord,
  theme,
  targetDurationHours,
}) => {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [bedtime, setBedtime] = useState('23:30');
  const [wakeTime, setWakeTime] = useState('07:30');
  const [wakeCount, setWakeCount] = useState(1);
  const [latencyMinutes, setLatencyMinutes] = useState(15);
  // ★ 默认必须是 'neutral'，不能是 'refreshed'。
  // `sleepInsights.describeMoodVsScore` 把 'neutral' 当作 App 里「没说」的值
  // （`buildSleepRecord` 的 `input.wakingMood ?? 'neutral'`），
  // 并在注释里写明：把"没说"当成"感觉不错"，会让**一键记录和低分凑出一条假的矛盾**。
  // 而这里原来预选 'refreshed'，等于用户不碰选择器就替他说了「精力充沛」，
  // 于是那条假矛盾真的会生成出来——**引擎里的缓解措施被界面绕过了**。
  // `OneTapSleepTracker` 一直用的是 'neutral'，这里向它看齐。
  const [selectedMood, setSelectedMood] = useState<WakingMood>('neutral');
  const [selectedHabits, setSelectedHabits] = useState<string[]>(DEFAULT_HABITS);
  const [dreamNotes, setDreamNotes] = useState('');

  const modalBg = theme?.cardBg || 'bg-[#1e293b]';
  const innerBg = theme?.cardInnerBg || 'bg-[#0f172a]';
  const innerBorder = theme?.cardInnerBorder || 'border-slate-700';
  const accentBg = theme?.accentBg || 'bg-indigo-600 hover:bg-indigo-500';
  const accentFg = theme?.accentFg || 'text-white';

  // 必须在提前 return 之前调用（hook 不能条件化）
  const { ref: dialogRef, dialogProps } = useModalA11y({ isOpen, onClose, label: '补记昨夜睡眠' });

  if (!isOpen) return null;

  const onToggleHabit = (id: string) => setSelectedHabits((prev) => toggleHabit(prev, id));

  const handleSave = () => {
    // 统一走 buildSleepRecord：时长=总睡眠、清醒=潜伏期+夜醒、分期与字段自洽
    const record: SleepRecord = buildSleepRecord({
      id: `manual-${Date.now()}`,
      date,
      bedtime,
      wakeTime,
      latencyMinutes,
      wakeCount,
      wakingMood: selectedMood,
      preSleepHabits: selectedHabits,
      dreamNotes,
      targetDurationMinutes: Math.round((targetDurationHours || 8) * 60),
    });

    onSaveRecord(record);
    onClose();
  };

  return (
    <div
      {...dialogProps}
      ref={dialogRef}
      className="fixed inset-0 z-[100] bg-black/95 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto outline-none"
    >
      <div className={`w-full max-w-md ${modalBg} border-2 border-indigo-400 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar my-auto`}>
        {/* Grab Handle */}
        <div className="w-12 h-1.5 bg-slate-500 rounded-full mx-auto mb-4 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl ${innerBg} text-indigo-400 flex items-center justify-center border ${innerBorder}`}>
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[17px] font-black text-white">晨起极速记录 / 真实补录</h3>
              <p className="text-xs text-slate-300">根据实际作息推算睡眠周期与各期占比（估算值）</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={`w-8 h-8 rounded-full ${innerBg} hover:opacity-80 text-white flex items-center justify-center cursor-pointer transition-colors border ${innerBorder}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body inputs */}
        <div className="py-4 space-y-4">
          {/* Date Selector */}
          <div>
            <label className="block text-xs font-bold text-white mb-1">记录日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`w-full ${innerBg} border ${innerBorder} rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono shadow-inner cursor-pointer`}
            />
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3 shadow-inner`}>
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2 mb-1">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                入睡时间
              </span>
              <input
                type="time"
                value={bedtime}
                onChange={(e) => setBedtime(e.target.value)}
                className="w-full bg-transparent text-2xl font-black text-white font-mono focus:outline-none cursor-pointer"
              />
            </div>

            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3 shadow-inner`}>
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2 mb-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                醒来时间
              </span>
              <input
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
                className="w-full bg-transparent text-2xl font-black text-white font-mono focus:outline-none cursor-pointer"
              />
            </div>
          </div>

          {/* Latency & Wake count */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3 shadow-inner`}>
              <div className="flex justify-between text-xs text-slate-200 mb-1 font-bold">
                <span>入睡耗时</span>
                <span className="text-indigo-300 font-mono">{latencyMinutes} 分钟</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={latencyMinutes}
                onChange={(e) => setLatencyMinutes(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-700 rounded-lg"
              />
            </div>

            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3 shadow-inner`}>
              <div className="flex justify-between text-xs text-slate-200 mb-1 font-bold">
                <span>夜醒次数</span>
                <span className="text-amber-300 font-mono">{wakeCount} 次</span>
              </div>
              <input
                type="range"
                min={0}
                max={6}
                value={wakeCount}
                onChange={(e) => setWakeCount(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-2 bg-slate-700 rounded-lg"
              />
            </div>
          </div>

          {/* Morning Mood */}
          <div>
            <label className="block text-xs font-bold text-white mb-1">晨起状态感受</label>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { key: 'refreshed', label: '精力充沛', emoji: '⚡' },
                  { key: 'neutral', label: '平淡一般', emoji: '😊' },
                  { key: 'tired', label: '略微疲劳', emoji: '😐' },
                  { key: 'groggy', label: '昏沉困倦', emoji: '🥱' },
                ] as const
              ).map((m) => (
                <button
                  type="button"
                  key={m.key}
                  onClick={() => setSelectedMood(m.key)}
                  className={`p-3 rounded-2xl border flex flex-col items-center gap-2 text-xs transition-all cursor-pointer ${
                    selectedMood === m.key
                      ? `${accentBg} border-white ${accentFg} font-black shadow-lg scale-[1.02]`
                      : `${innerBg} ${innerBorder} text-slate-200 hover:border-slate-400`
                  }`}
                >
                  <span className="text-2xl">{m.emoji}</span>
                  <span className="text-xs font-bold">{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pre-sleep Habits tags */}
          <div>
            <label className="block text-xs font-bold text-white mb-1">昨晚睡前行为习惯</label>
            <div className="flex flex-wrap gap-2">
              {HABIT_OPTIONS.map((h) => {
                const active = selectedHabits.includes(h.id);
                return (
                  <button
                    type="button"
                    key={h.id}
                    onClick={() => onToggleHabit(h.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                      active
                        ? `${accentBg} ${accentFg} border border-white shadow-md`
                        : `${innerBg} text-slate-200 border ${innerBorder} hover:border-slate-400`
                    }`}
                  >
                    <h.icon className="w-3.5 h-3.5" />
                    <span>{h.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dream diary notes */}
          <div>
            <label className="block text-xs font-bold text-white mb-1">梦境与醒来体验 (选填)</label>
            <textarea
              value={dreamNotes}
              onChange={(e) => setDreamNotes(e.target.value)}
              placeholder="记录昨晚梦境场景、心情或特别的细节..."
              rows={2}
              className={`w-full ${innerBg} border ${innerBorder} rounded-xl p-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-400 shadow-inner font-medium`}
            />
          </div>
        </div>

        {/* Save button */}
        <button
          type="button"
          onClick={handleSave}
          className={`w-full py-4 rounded-2xl ${accentBg} ${accentFg} font-black text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer`}
        >
          <Check className="w-5 h-5 stroke-[3]" />
          <span>保存记录并更新睡眠趋势</span>
        </button>
      </div>
    </div>
  );
};
