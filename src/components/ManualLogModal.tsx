import React, { useState } from 'react';
import { X, Moon, Clock, Sparkles, Check, Smartphone, Coffee, Bath, Flower2, BookOpen, Dumbbell, Wine, Utensils } from 'lucide-react';
import { SleepRecord, WakingMood } from '../types/sleep';
import { buildSleepRecord } from '../utils/sleepRecord';
import { ThemeConfig } from '../utils/themeStyles';

interface ManualLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveRecord: (record: SleepRecord) => void;
  theme?: ThemeConfig;
  targetDurationHours?: number;
}

const HABIT_OPTIONS = [
  { id: 'screen_time', label: '睡前玩手机', icon: Smartphone },
  { id: 'caffeine', label: '下午喝咖啡/茶', icon: Coffee },
  { id: 'hot_bath', label: '睡前温水澡', icon: Bath },
  { id: 'meditation', label: '冥想/腹式呼吸', icon: Flower2 },
  { id: 'reading', label: '纸质书阅读', icon: BookOpen },
  { id: 'workout', label: '晚间运动', icon: Dumbbell },
  { id: 'alcohol', label: '睡前饮酒', icon: Wine },
  { id: 'heavy_meal', label: '夜宵饱腹', icon: Utensils },
];

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
  const [selectedMood, setSelectedMood] = useState<WakingMood>('refreshed');
  const [selectedHabits, setSelectedHabits] = useState<string[]>(['reading', 'hot_bath']);
  const [dreamNotes, setDreamNotes] = useState('');

  const modalBg = theme?.cardBg || 'bg-[#1e293b]';
  const modalBorder = theme?.cardBorder || 'border-slate-700';
  const innerBg = theme?.cardInnerBg || 'bg-[#0f172a]';
  const innerBorder = theme?.cardInnerBorder || 'border-slate-700';
  const accentBg = theme?.accentBg || 'bg-indigo-600 hover:bg-indigo-500';

  if (!isOpen) return null;

  const toggleHabit = (id: string) => {
    setSelectedHabits((prev) =>
      prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]
    );
  };

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
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] bg-black/95 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className={`w-full max-w-md ${modalBg} border-2 border-indigo-400 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar my-auto`}>
        {/* Grab Handle */}
        <div className="w-12 h-1.5 bg-slate-500 rounded-full mx-auto mb-4 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
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
            <label className="block text-xs font-bold text-white mb-1.5">记录日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`w-full ${innerBg} border ${innerBorder} rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-400 font-mono shadow-inner cursor-pointer`}
            />
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3.5 shadow-inner`}>
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 mb-1">
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

            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3.5 shadow-inner`}>
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 mb-1">
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
            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3.5 shadow-inner`}>
              <div className="flex justify-between text-xs text-slate-200 mb-1.5 font-bold">
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

            <div className={`${innerBg} border ${innerBorder} rounded-2xl p-3.5 shadow-inner`}>
              <div className="flex justify-between text-xs text-slate-200 mb-1.5 font-bold">
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
            <label className="block text-xs font-bold text-white mb-1.5">晨起状态感受</label>
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
                  className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 text-xs transition-all cursor-pointer ${
                    selectedMood === m.key
                      ? `${accentBg} border-white text-white font-black shadow-lg scale-[1.02]`
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
            <label className="block text-xs font-bold text-white mb-1.5">昨晚睡前行为习惯</label>
            <div className="flex flex-wrap gap-2">
              {HABIT_OPTIONS.map((h) => {
                const active = selectedHabits.includes(h.id);
                return (
                  <button
                    type="button"
                    key={h.id}
                    onClick={() => toggleHabit(h.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      active
                        ? `${accentBg} text-white border border-white shadow-md`
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
            <label className="block text-xs font-bold text-white mb-1.5">梦境与醒来体验 (选填)</label>
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
          className={`w-full py-4 rounded-2xl ${accentBg} text-white font-black text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer`}
        >
          <Check className="w-5 h-5 stroke-[3]" />
          <span>保存记录并更新睡眠趋势</span>
        </button>
      </div>
    </div>
  );
};
