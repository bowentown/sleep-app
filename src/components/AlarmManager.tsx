import React, { useState, useEffect } from 'react';
import {
  Bell,
  Plus,
  Play,
  Square,
  Trash2,
  Clock,
  Sparkles,
  Volume2,
  Check,
  Sun,
  ShieldCheck,
} from 'lucide-react';
import { CustomAlarmSetting } from '../types/sleep';
import { sleepAudio } from '../utils/audioSynth';
import { InfoNote } from './InfoNote';
import { ThemeConfig } from '../utils/themeStyles';
import {
  isNativePlatform,
  syncAlarmsToNative,
  requestAlarmPermissions,
} from '../utils/nativeAlarmScheduler';

interface AlarmManagerProps {
  alarms: CustomAlarmSetting[];
  onUpdateAlarms: (alarms: CustomAlarmSetting[]) => void;
  theme?: ThemeConfig;
}

const DEFAULT_DAYS = [
  { day: 1, label: '一' },
  { day: 2, label: '二' },
  { day: 3, label: '三' },
  { day: 4, label: '四' },
  { day: 5, label: '五' },
  { day: 6, label: '六' },
  { day: 7, label: '日' },
];

export const AlarmManager: React.FC<AlarmManagerProps> = ({ alarms, onUpdateAlarms, theme }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newTime, setNewTime] = useState('07:30');
  const [newLabel, setNewLabel] = useState('早晨唤醒');
  const [newDays, setNewDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [newTone, setNewTone] = useState<'gentle_chime' | 'aurora_melody' | 'radar_beep'>('gentle_chime');
  const [newSmartWake, setNewSmartWake] = useState(true);
  const [newSmartWindow, setNewSmartWindow] = useState(20);

  const [testingTone, setTestingTone] = useState<string | null>(null);
  const [activeRingingAlarm, setActiveRingingAlarm] = useState<CustomAlarmSetting | null>(null);
  const [nativeStatus, setNativeStatus] = useState<{ isNative: boolean; scheduledCount: number }>({
    isNative: isNativePlatform(),
    scheduledCount: 0,
  });
  const [permissionHint, setPermissionHint] = useState<string | null>(null);

  const innerBg = theme?.cardInnerBg || 'bg-[#0f172a]';
  const innerBorder = theme?.cardInnerBorder || 'border-slate-800';
  const accentBg = theme?.accentBg || 'bg-indigo-600 hover:bg-indigo-500';

  // 1. 同步闹钟到原生后台系统 (当在 APK 下运行时)
  useEffect(() => {
    const isNat = isNativePlatform();
    if (isNat) {
      syncAlarmsToNative(alarms).then((res) => {
        setNativeStatus({ isNative: true, scheduledCount: res.nativeScheduledCount });
      });
    } else {
      setNativeStatus({ isNative: false, scheduledCount: 0 });
    }
  }, [alarms]);

  // Stop testing tone on unmount
  React.useEffect(() => {
    return () => {
      sleepAudio.stop();
    };
  }, []);

  // Alarm clock monitor loop: checks every 10 seconds against system clock
  React.useEffect(() => {
    const checkAlarm = () => {
      const now = new Date();
      const currentHours = String(now.getHours()).padStart(2, '0');
      const currentMinutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;
      const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // 1-7

      alarms.forEach((alarm) => {
        if (
          alarm.enabled &&
          alarm.time === currentTimeStr &&
          (alarm.repeatDays.length === 0 || alarm.repeatDays.includes(currentDay))
        ) {
          if (!activeRingingAlarm) {
            setActiveRingingAlarm(alarm);
            sleepAudio.playAlarm(alarm.tone);
          }
        }
      });
    };

    const interval = window.setInterval(checkAlarm, 10000);
    return () => window.clearInterval(interval);
  }, [alarms, activeRingingAlarm]);

  const handleTestTone = (tone: 'gentle_chime' | 'aurora_melody' | 'radar_beep') => {
    if (testingTone === tone) {
      sleepAudio.stop();
      setTestingTone(null);
    } else {
      sleepAudio.playAlarm(tone);
      setTestingTone(tone);
    }
  };

  const handleStopRinging = () => {
    sleepAudio.stop();
    setActiveRingingAlarm(null);
  };

  // 原生环境下确保通知权限已授予 (Android 13+ POST_NOTIFICATIONS 为运行时权限，未授权则通知不显示)
  const ensureAlarmPermissions = async (): Promise<boolean> => {
    if (!isNativePlatform()) return true;
    const granted = await requestAlarmPermissions();
    if (!granted) {
      setPermissionHint('未获得系统通知权限，闹钟将无法弹窗响铃。请在系统设置 → 应用 → 极光睡眠 中允许"通知"权限后重试。');
      return false;
    }
    setPermissionHint(null);
    return true;
  };

  const handleToggleAlarm = async (id: string) => {
    const target = alarms.find((a) => a.id === id);
    if (target && !target.enabled) {
      const ok = await ensureAlarmPermissions();
      if (!ok) return;
    }
    const updated = alarms.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a));
    onUpdateAlarms(updated);
  };

  const handleDeleteAlarm = (id: string) => {
    onUpdateAlarms(alarms.filter((a) => a.id !== id));
  };

  // 调整已有闹钟的浅睡唤醒窗口（1-30 分钟步进）
  const handleAdjustWindow = (id: string, delta: number) => {
    onUpdateAlarms(
      alarms.map((a) =>
        a.id === id
          ? { ...a, smartWakeWindowMinutes: Math.min(30, Math.max(1, (a.smartWakeWindowMinutes || 20) + delta)) }
          : a
      )
    );
  };

  const handleToggleDay = (day: number) => {
    if (newDays.includes(day)) {
      setNewDays(newDays.filter((d) => d !== day));
    } else {
      setNewDays([...newDays, day].sort());
    }
  };

  const handleSaveNewAlarm = async () => {
    const ok = await ensureAlarmPermissions();
    if (!ok) return;
    const created: CustomAlarmSetting = {
      id: `alarm-${Date.now()}`,
      time: newTime,
      label: newLabel || '唤醒闹钟',
      enabled: true,
      repeatDays: newDays,
      tone: newTone,
      smartWakeEnabled: newSmartWake,
      smartWakeWindowMinutes: newSmartWindow,
    };
    onUpdateAlarms([...alarms, created]);
    setIsAdding(false);
  };

  return (
    <div className="space-y-4">
      {/* Active Ringing Overlay Notification Banner */}
      {activeRingingAlarm && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-600 via-indigo-600 to-violet-600 text-white shadow-2xl animate-pulse flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
              <Sun className="w-6 h-6 animate-spin text-amber-200" />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-100">闹钟响铃中 · 晨安唤醒</div>
              <h4 className="text-2xl font-black">{activeRingingAlarm.time} {activeRingingAlarm.label}</h4>
            </div>
          </div>
          <button
            type="button"
            onClick={handleStopRinging}
            className="px-5 py-2 bg-white text-slate-900 font-black text-sm rounded-xl shadow-lg active:scale-95 transition-all cursor-pointer"
          >
            停止响铃
          </button>
        </div>
      )}

      {/* Header with Add Button & Native Platform Status */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-sm font-bold text-white whitespace-nowrap">定时唤醒</span>
          </div>

          <button
          type="button"
          onClick={() => {
            if (isAdding) {
              sleepAudio.stop();
              setTestingTone(null);
            }
            setIsAdding(!isAdding);
          }}
          className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black flex items-center gap-2 transition-colors cursor-pointer shadow-md whitespace-nowrap"
        >
          {isAdding ? '取消' : <><Plus className="w-3.5 h-3.5 stroke-[3]" /><span>添加闹钟</span></>}
        </button>
        </div>

        {!nativeStatus.isNative ? (
          <p className="text-xs text-amber-300/90 font-medium whitespace-nowrap">
            （APK 可离线唤醒，Web 需保持打开）
          </p>
        ) : (
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
            <span className="text-xs font-black bg-emerald-950 text-emerald-300 border border-emerald-500/60 px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap">
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span>系统级精确唤醒已激活 ({nativeStatus.scheduledCount})</span>
            </span>
            <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
              杀进程与息屏均不影响响铃
            </span>
            <span className="text-xs text-amber-300/90 font-medium whitespace-nowrap">
              若息屏未响：请允许自启动、省电设为“无限制”、调高通知音量
            </span>
          </div>
        )}
        {permissionHint && (
          <p className="text-[11px] text-rose-300 font-bold">⚠️ {permissionHint}</p>
        )}
      </div>

      {/* Add New Alarm Form */}
      {isAdding && (
        <div className={`p-4 rounded-2xl ${innerBg} border-2 border-indigo-400 space-y-4 animate-in fade-in duration-200 shadow-xl`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-indigo-300">新建自定义闹钟</span>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="闹钟备注（如：工作日晨读）"
              className={`${innerBg} border border-slate-600 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-400 w-44 text-right font-bold`}
            />
          </div>

          {/* Time Picker */}
          <div className={`flex items-center justify-center py-3 ${innerBg} rounded-2xl border ${innerBorder} shadow-inner`}>
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="bg-transparent text-[32px] font-black font-mono text-white focus:outline-none tracking-widest cursor-pointer"
            />
          </div>

          {/* Repeat Days */}
          <div>
            <span className="text-xs text-white font-bold block mb-1">重复周期</span>
            <div className="flex justify-between gap-1">
              {DEFAULT_DAYS.map(({ day, label }) => {
                const isSelected = newDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleToggleDay(day)}
                    className={`w-9 h-9 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      isSelected
                        ? `${accentBg} text-white shadow-md border-2 border-white`
                        : `${innerBg} text-slate-300 border ${innerBorder} hover:text-white`
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tone Selector & Preview */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-white font-bold">唤醒音阶</span>
              {testingTone && (
                <button
                  type="button"
                  onClick={() => {
                    sleepAudio.stop();
                    setTestingTone(null);
                  }}
                  className="text-xs text-amber-300 font-black flex items-center gap-1 bg-amber-950 px-2 py-0.5 rounded border border-amber-500"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>停止试听</span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'gentle_chime', label: '528Hz修复颂磬', desc: '纯净共振' },
                { key: 'aurora_melody', label: '极光升华旋律', desc: '五度音阶' },
                { key: 'radar_beep', label: '柔和脉冲声', desc: '清爽准点' },
              ].map((t) => (
                <div
                  key={t.key}
                  onClick={() => setNewTone(t.key as any)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    newTone === t.key
                      ? 'bg-indigo-600/40 border-indigo-400 text-white shadow-md'
                      : `${innerBg} ${innerBorder} text-slate-200 hover:border-slate-400`
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-black">
                    <span>{t.label}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTestTone(t.key as any);
                      }}
                      className="p-1 text-indigo-400 hover:text-white"
                    >
                      {testingTone === t.key ? (
                        <Square className="w-3.5 h-3.5 fill-current text-amber-400" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                    </button>
                  </div>
                  <span className="text-xs text-slate-300 block mt-0.5">{t.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Smart Wake Toggle & Window */}
          <div className={`p-3 rounded-xl ${innerBg} border ${innerBorder} space-y-2`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-white block font-bold">
                  浅睡唤醒
                  <span className="ml-1 text-[11px] font-normal text-amber-300/90">尚未生效</span>
                </span>
                <span className="text-[11px] text-slate-300">
                  计划设定 ±{newSmartWindow} 分钟的唤醒窗口
                </span>
              </div>
              <input
                type="checkbox"
                checked={newSmartWake}
                onChange={(e) => setNewSmartWake(e.target.checked)}
                className="accent-indigo-600 w-5 h-5 rounded cursor-pointer"
              />
            </div>
            {newSmartWake && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 font-mono">1m</span>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={newSmartWindow}
                  onChange={(e) => setNewSmartWindow(Number(e.target.value))}
                  className="flex-1 accent-indigo-500 cursor-pointer"
                />
                <span className="text-xs text-slate-400 font-mono">30m</span>
                <span className="text-[11px] text-indigo-300 font-mono font-bold w-9 text-right tabular-nums">
                  {newSmartWindow}m
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSaveNewAlarm}
            className={`w-full py-3 rounded-xl ${accentBg} text-white text-xs font-black shadow-lg transition-all active:scale-98 cursor-pointer`}
          >
            保存并启动此闹钟
          </button>
        </div>
      )}

      {/* Alarm List */}
      <div className="space-y-2">
        {alarms.length === 0 ? (
          <div className={`p-5 rounded-2xl ${innerBg} border ${innerBorder} text-center text-xs text-slate-300 font-medium`}>
            暂无闹钟 · 点右上角添加
          </div>
        ) : (
          alarms.map((alarm) => {
            const dayText =
              alarm.repeatDays.length === 7
                ? '每天'
                : alarm.repeatDays.length === 5 && !alarm.repeatDays.includes(6) && !alarm.repeatDays.includes(7)
                ? '周内'
                : alarm.repeatDays.length === 2 && alarm.repeatDays.includes(6) && alarm.repeatDays.includes(7)
                ? '周末'
                : alarm.repeatDays.length === 0
                ? '仅一次'
                : `周 ${alarm.repeatDays.join('、')}`;

            return (
              <div
                key={alarm.id}
                className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${
                  alarm.enabled
                    ? `${innerBg} ${innerBorder} text-white shadow-md`
                    : `${innerBg}/40 border-slate-800 text-slate-400 opacity-60`
                }`}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleTestTone(alarm.tone)}
                    title="试听铃声"
                    className={`w-11 h-11 rounded-xl ${theme?.cardBg || 'bg-slate-800'} text-indigo-300 flex items-center justify-center transition-all shrink-0 border ${innerBorder} shadow-inner cursor-pointer`}
                  >
                    {testingTone === alarm.tone ? (
                      <Square className="w-4 h-4 fill-current text-amber-400" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5 text-indigo-400" />
                    )}
                  </button>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-2xl font-mono font-black tracking-tight text-white">
                        {alarm.time}
                      </span>
                      <span className="text-xs text-white font-bold whitespace-nowrap">{alarm.label}</span>
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-1 font-medium">
                      <span className="whitespace-nowrap">{dayText}</span>
                      {/* 这个徽标原来只写「浅睡唤醒 ±20m」，读起来像是一个正在工作的功能。
                          实际 checkAlarm 只做 alarm.time === 当前分钟 的精确匹配，
                          smartWakeEnabled / smartWakeWindowMinutes 从未参与响铃判定；
                          原生插件里也没有任何传感器代码。也就是说它承诺了「提前平缓唤醒」，
                          而代码做不到。放在这里（而不是新增表单里）是因为用户正是在这里看到它。 */}
                      {alarm.smartWakeEnabled && (
                        <span className="inline-flex items-center text-indigo-300 bg-indigo-950 border border-indigo-600 px-1 py-0.5 rounded text-[11px] font-bold">
                          <button
                            type="button"
                            title="减小唤醒窗口"
                            onClick={() => handleAdjustWindow(alarm.id, -1)}
                            className="px-1 hover:text-white cursor-pointer"
                          >
                            −
                          </button>
                          <span className="tabular-nums">浅睡唤醒 ±{alarm.smartWakeWindowMinutes}m</span>
                          <span className="text-amber-300 font-normal">尚未生效</span>
                          <button
                            type="button"
                            title="增大唤醒窗口"
                            onClick={() => handleAdjustWindow(alarm.id, +1)}
                            className="px-1 hover:text-white cursor-pointer"
                          >
                            +
                          </button>
                        </span>
                      )}
                    </div>
                    {alarm.smartWakeEnabled && (
                      <div className="mt-1">
                        <InfoNote theme={theme} summary="为什么尚未生效">
                          判断「浅睡」需要在整夜读取体动（加速度计）或声音，当前版本没有采集任何一项，
                          闹钟只做<strong>精确到分钟</strong>的匹配。所以这个窗口只是把偏好记下来了，
                          <strong>还不会改变响铃时刻</strong>——在实际实现之前，唤醒就是你设定的那一刻，
                          不会提前也不会推后。保留这个开关，是因为它决定将来采集数据的窗口长度，
                          参考的默认值是 30 分钟（Sleep as Android 公开的人群数据表明，
                          30 分钟是「睡得更久」与「抓到浅睡」之间的最佳折中）。
                        </InfoNote>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleDeleteAlarm(alarm.id)}
                    className="p-2 text-slate-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {/* Switch toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleAlarm(alarm.id)}
                    className={`w-12 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                      alarm.enabled ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        alarm.enabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
