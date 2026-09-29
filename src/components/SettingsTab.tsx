import React, { useState } from 'react';
import {
  Clock,
  RotateCcw,
  Sliders,
  ShieldCheck,
  Palette,
  Download,
  Upload,
  Smartphone,
} from 'lucide-react';
import { UserProfile, CustomAlarmSetting, CustomAIConfig, SleepRecord, SleepStageSegment } from '../types/sleep';
import { AlarmManager } from './AlarmManager';
import { CustomAISettingsModal } from './CustomAISettingsModal';
import { PWAExportModal } from './PWAExportModal';
import { APP_THEMES, ThemeConfig } from '../utils/themeStyles';

// 主题切换时同步切换桌面图标（原生 activity-alias 启停；Web 环境跳过）
function switchLauncherIcon(themeId: string) {
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.GemmaLLM) {
      cap.Plugins.GemmaLLM.setLauncherIcon({ theme: themeId });
    }
  } catch {
    // 图标切换失败不影响主题应用
  }
}
import { getActiveModelLabel } from '../utils/localLlmEngine';
import { toLocalDateString } from '../utils/dateUtils';

// 作息目标联动工具：HH:MM ↔ 当日分钟数（跨午夜安全）
const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toClock = (min: number): string => {
  const norm = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
};

// 导入备份的逐条清洗：任何非对象/缺日期/字段异常的条目都会被安全跳过或兜底
const numOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const strOr = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;
const clampMin = (v: unknown, max: number): number => Math.max(0, Math.min(max, numOr(v, 0)));

function sanitizeRecord(raw: unknown): SleepRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  if (!date) return null;
  const duration = clampMin(r.durationMinutes, 1440);
  const stages = Array.isArray(r.stages)
    ? (r.stages as unknown[])
        .map((st): SleepStageSegment | null => {
          if (typeof st !== 'object' || st === null) return null;
          const s = st as Record<string, unknown>;
          const stage = ['awake', 'rem', 'light', 'deep'].includes(s.stage as string)
            ? (s.stage as SleepStageSegment['stage'])
            : 'light';
          return {
            stage,
            startTime: strOr(s.startTime, '23:30'),
            endTime: strOr(s.endTime, '07:30'),
            durationMinutes: Math.max(0, Math.round(numOr(s.durationMinutes, 0))),
          };
        })
        .filter((x): x is SleepStageSegment => x !== null)
    : [];
  return {
    id: strOr(r.id, `import-${Date.now()}-${Math.round(Math.random() * 1e6)}`),
    date,
    bedtime: strOr(r.bedtime, '23:30'),
    wakeTime: strOr(r.wakeTime, '07:30'),
    durationMinutes: duration || 1,
    deepSleepMinutes: clampMin(r.deepSleepMinutes, duration),
    lightSleepMinutes: clampMin(r.lightSleepMinutes, duration),
    remSleepMinutes: clampMin(r.remSleepMinutes, duration),
    awakeMinutes: clampMin(r.awakeMinutes, 720),
    sleepScore: Math.max(0, Math.min(100, numOr(r.sleepScore, 60))),
    sleepEfficiency: Math.max(0, Math.min(100, numOr(r.sleepEfficiency, 80))),
    latencyMinutes: clampMin(r.latencyMinutes, 480),
    wakeCount: Math.max(0, Math.round(numOr(r.wakeCount, 0))),
    wakingMood: (['refreshed', 'neutral', 'tired', 'groggy'].includes(r.wakingMood as string)
      ? r.wakingMood
      : 'neutral') as SleepRecord['wakingMood'],
    preSleepHabits: Array.isArray(r.preSleepHabits)
      ? (r.preSleepHabits as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    dreamNotes: typeof r.dreamNotes === 'string' ? r.dreamNotes : undefined,
    stages,
    soundEvents: Array.isArray(r.soundEvents)
      ? (r.soundEvents as SleepRecord['soundEvents'])
      : undefined,
  };
}

interface SettingsTabProps {
  records: SleepRecord[];
  userProfile: UserProfile;
  onUpdateProfile: (updated: Partial<UserProfile>) => void;
  onResetDemoData: () => void;
  onImportRecords?: (imported: SleepRecord[]) => void;
  theme: ThemeConfig;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  records,
  userProfile,
  onUpdateProfile,
  onResetDemoData,
  onImportRecords,
  theme,
}) => {
  const [isAIConfigOpen, setIsAIConfigOpen] = useState(false);
  // 安装/导出引导此前是个**孤儿组件**——写完了、没有任何入口，谁都没见过。
  // 放在「数据备份」卡里：它是把数据带走/换设备的入口，和导出备份是同一件事。
  const [isPwaOpen, setIsPwaOpen] = useState(false);

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(records, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `somnacare-sleep-backup-${toLocalDateString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed: unknown = JSON.parse(event.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error('not-array');
        // 逐条清洗：此前只校验 Array.isArray，导入 [1,2,3] 会让首页直接崩
        const cleaned = parsed
          .map((r) => sanitizeRecord(r))
          .filter((r): r is SleepRecord => r !== null);
        if (cleaned.length === 0) {
          alert('导入失败：文件里没有可识别的睡眠记录');
          return;
        }
        if (onImportRecords) {
          onImportRecords(cleaned);
          if (cleaned.length < parsed.length) {
            alert(`已导入 ${cleaned.length} 条记录，另有 ${parsed.length - cleaned.length} 条格式无效已跳过`);
          }
        }
      } catch {
        alert('导入失败：不是合法的睡眠备份 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className={`space-y-4 ${theme.textPrimary}`}>
      {/* 1. Theme Color Palette Section */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-xl ${theme.cardInnerBg} text-indigo-400 flex items-center justify-center border ${theme.cardBorder}`}>
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">界面主题</h3>
            </div>
          </div>
          <span className="text-[11px] font-bold text-slate-400">
            {APP_THEMES[(userProfile.themeColor || 'midnight') as keyof typeof APP_THEMES]?.name}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          {Object.values(APP_THEMES).map((t) => {
            const isSelected = (userProfile.themeColor || 'midnight') === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onUpdateProfile({ themeColor: t.id as any });
                  switchLauncherIcon(t.id);
                }}
                className={`p-3 rounded-2xl border text-left transition-all relative cursor-pointer ${
                  isSelected
                    ? `border-indigo-400 ${theme.cardInnerBg} shadow-lg ring-1 ring-indigo-400/50`
                    : `${theme.cardInnerBg} border-slate-700/70 hover:border-slate-500`
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full ${t.pageBg} border-2 border-slate-400 shadow-sm flex items-center justify-center`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
                    </span>
                    <span className="text-xs font-black text-white">{t.name}</span>
                  </div>
                  {isSelected ? (
                    <span className="text-[11px] font-bold text-indigo-400">
                      ✓ 使用中
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 font-medium">{t.tag}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Custom Alarm Clocks (Hardware Web Audio) */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl`}>
        <AlarmManager
          alarms={userProfile.alarms || []}
          onUpdateAlarms={(alarms: CustomAlarmSetting[]) => onUpdateProfile({ alarms })}
          theme={theme}
        />
      </div>

      {/* 3. AI Model Selector Entry */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-violet-600/30 text-violet-300 flex items-center justify-center border border-violet-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">AI 顾问</h3>
              <p className="text-xs text-slate-300">
                当前运行：
                <span className="text-indigo-300 font-bold ml-1">
                  {userProfile.aiConfig?.provider === 'deepseek'
                    ? `DeepSeek (${userProfile.aiConfig.deepseekModel || 'deepseek-flash'})`
                    : userProfile.aiConfig?.provider === 'local_llm'
                    ? `端侧小模型 (${getActiveModelLabel()})`
                    : userProfile.aiConfig?.provider === 'custom_openai'
                    ? '自建 API'
                    : '本地睡眠规则引擎'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAIConfigOpen(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shadow-md shadow-indigo-950 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
          >
            配置与探查
          </button>
        </div>

        <p className="text-xs text-slate-300 font-medium">
          云端 · 端侧 · 本地，三级可切换
        </p>
      </div>

      {/* 4. Schedule Target — 三字段联动编辑器：改其一，其余自动推算 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-4`}>
        <div className="flex items-center gap-2 pb-3 border-b border-slate-700/60">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-400">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">作息目标</h3>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3 shadow-inner`}>
            <span className="text-xs font-bold text-slate-200 block mb-1">目标就寝</span>
            <input
              type="time"
              value={userProfile.targetBedtime}
              onChange={(e) =>
                onUpdateProfile({
                  targetBedtime: e.target.value,
                  targetWakeTime: toClock(toMin(e.target.value) + Math.round(userProfile.targetDurationHours * 60)),
                })
              }
              className="w-full bg-transparent text-2xl font-black text-white font-mono focus:outline-none cursor-pointer"
            />
          </div>

          <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3 shadow-inner`}>
            <span className="text-xs font-bold text-slate-200 block mb-1">目标醒来</span>
            <input
              type="time"
              value={userProfile.targetWakeTime}
              onChange={(e) => {
                // 反推时长（跨午夜安全），对齐 0.5h 步进并夹在滑杆范围内
                const durH = Math.min(12, Math.max(4, Math.round(((toMin(e.target.value) - toMin(userProfile.targetBedtime) + 1440) % 1440) / 30) * 0.5));
                onUpdateProfile({ targetWakeTime: e.target.value, targetDurationHours: durH });
              }}
              className="w-full bg-transparent text-2xl font-black text-white font-mono focus:outline-none cursor-pointer"
            />
          </div>
        </div>

        <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3 shadow-inner space-y-2`}>
          <div className="flex justify-between text-xs font-bold">
            <span className="text-slate-200">目标睡眠时长</span>
            <span className="text-indigo-400 font-mono text-sm">{userProfile.targetDurationHours} 小时</span>
          </div>
          <input
            type="range"
            min={4}
            max={12}
            step={0.5}
            value={userProfile.targetDurationHours}
            onChange={(e) => {
              const h = Number(e.target.value);
              onUpdateProfile({
                targetDurationHours: h,
                targetWakeTime: toClock(toMin(userProfile.targetBedtime) + Math.round(h * 60)),
              });
            }}
            className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-700 rounded-lg"
          />
        </div>

        {/* 实时摘要 + 距离下一次目标就寝的提示 */}
        <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3 space-y-2`}>
          <p className={`text-xs font-mono font-bold ${theme.accentText}`}>
            {userProfile.targetBedtime} 入睡 · {userProfile.targetDurationHours} 小时 · {userProfile.targetWakeTime} 醒来
          </p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {(() => {
              const now = new Date();
              const nowMin = now.getHours() * 60 + now.getMinutes();
              let untilBed = toMin(userProfile.targetBedtime) - nowMin;
              if (untilBed < 0) untilBed += 1440;
              if (untilBed <= 90) {
                return untilBed <= 15
                  ? `⏰ 距目标就寝还有 ${untilBed} 分钟，该减速了`
                  : `🌙 距目标就寝还有 ${Math.floor(untilBed / 60)}小时${untilBed % 60}分，适合开始睡前流程`;
              }
              return `🕐 距今晚目标就寝约 ${Math.floor(untilBed / 60)} 小时${untilBed % 60} 分`;
            })()}
            用于评分基准与 AI 建议。
          </p>
        </div>
      </div>

      {/* 5. Data Backup, Export & Reset Management */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-bold text-white">数据备份</span>
          </div>
          <span className={`text-xs ${theme.textMuted} font-mono`}>共 {records.length} 条记录</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleExportJSON}
            className={`py-2 px-3 rounded-xl ${theme.cardInnerBg} hover:opacity-90 border ${theme.cardBorder} text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow`}
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>导出 JSON 备份</span>
          </button>

          <label className={`py-2 px-3 rounded-xl ${theme.cardInnerBg} hover:opacity-90 border ${theme.cardBorder} text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow`}>
            <Upload className="w-4 h-4 text-indigo-400" />
            <span>导入备份文件</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setIsPwaOpen(true)}
          className={`w-full py-2 rounded-xl ${theme.cardInnerBg} hover:opacity-90 border ${theme.cardBorder} text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow`}
        >
          <Smartphone className="w-4 h-4 text-sky-400" />
          <span>安装到手机 / 分享给朋友</span>
        </button>

        <button
          type="button"
          onClick={onResetDemoData}
          className={`w-full py-2 rounded-xl ${theme.cardInnerBg} hover:opacity-80 border ${theme.cardInnerBorder} ${theme.textMuted} hover:text-white text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer`}
        >
          <RotateCcw className="w-3.5 h-3.5 opacity-60" />
          <span>恢复示例数据（7天演示）</span>
        </button>
      </div>

      {/* 安装与导出引导 */}
      <PWAExportModal isOpen={isPwaOpen} onClose={() => setIsPwaOpen(false)} />

      {/* Custom AI Config Modal */}
      <CustomAISettingsModal
        isOpen={isAIConfigOpen}
        onClose={() => setIsAIConfigOpen(false)}
        config={userProfile.aiConfig || { provider: 'deepseek' }}
        onSaveConfig={(cfg: CustomAIConfig) => onUpdateProfile({ aiConfig: cfg })}
        theme={theme}
      />
    </div>
  );
};
