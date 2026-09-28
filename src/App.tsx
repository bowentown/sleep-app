import React, { useState, useEffect } from 'react';
import {
  Moon,
  CheckCircle2,
} from 'lucide-react';
import { SleepRecord, UserProfile, DEFAULT_EYE_CARE } from './types/sleep';
import { getInitialSleepLogs, isSleepRecordLike } from './utils/sleepRecord';
import { TodayTab } from './components/TodayTab';
import { TrendsTab } from './components/TrendsTab';
import { AIAdvicePanel } from './components/AIAdvicePanel';
import { SettingsTab } from './components/SettingsTab';
import { EyeCareTab } from './components/EyeCareTab';
import { BottomNavBar, NavTab } from './components/BottomNavBar';
import { ActiveSleepModal } from './components/ActiveSleepModal';
import { ManualLogModal } from './components/ManualLogModal';
import { APP_THEMES } from './utils/themeStyles';
import { isNativePlatform, syncAlarmsToNative } from './utils/nativeAlarmScheduler';
import { applyEyeCare, eyeCareInAppStyles, isInEyeCareWindow } from './utils/eyeCare';
import { LaunchSplash } from './components/LaunchSplash';

/**
 * localStorage 写入保护：配额超限时 setItem 会抛异常，
 * 若在 useEffect 里冒泡出去会打断渲染、把整个 App 变成错误页。
 */
function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`localStorage 写入失败（${key}）——可能已超出存储配额`, e);
    return false;
  }
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('today');
  const [isActiveSleepOpen, setIsActiveSleepOpen] = useState(false);
  const [isManualLogOpen, setIsManualLogOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Persistence for user logs: Empty by default for new users, prevents overwriting corrupt data
  const [records, setRecords] = useState<SleepRecord[]>(() => {
    const saved = localStorage.getItem('somnacare_sleep_records');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // 过滤结构不合法的条目：否则下游 r.bedtime.split(':') 会直接抛错、整个 App 崩溃
          const valid = parsed.filter(isSleepRecordLike);
          if (valid.length !== parsed.length) {
            console.warn(`已忽略 ${parsed.length - valid.length} 条结构损坏的睡眠记录`);
          }
          return valid;
        }
      } catch (e) {
        console.error('Failed to parse saved records, backing up corrupted key:', e);
        safeLocalStorageSet('somnacare_sleep_records_backup_corrupted', saved);
        return [];
      }
    }
    // New user starts with empty clean diary by default (can explicitly load demo data in Settings)
    return [];
  });

  // User Profile configuration
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('somnacare_user_profile');
    if (saved) {
      try {
        const parsedProfile = JSON.parse(saved) as UserProfile;
        // 老默认闹钟名对称化：工作日 → 周内（仅迁移未改过名的默认项）
        if (Array.isArray(parsedProfile?.alarms)) {
          parsedProfile.alarms = parsedProfile.alarms.map((a) =>
            a.label === '工作日温和唤醒' ? { ...a, label: '周内温和唤醒' } : a
          );
        }
        // 老配置补齐护眼分区默认值
        if (!parsedProfile.eyeCare) {
          parsedProfile.eyeCare = DEFAULT_EYE_CARE;
        }
        return parsedProfile;
      } catch (e) {
        console.error('Failed to parse profile', e);
      }
    }
    return {
      name: '体验用户',
      age: 28,
      targetBedtime: '23:30',
      targetWakeTime: '07:30',
      targetDurationHours: 8,
      smartAlarmEnabled: true,
      smartWakeWindowMinutes: 20,
      soundDetectionSensitivity: 'medium',
      themeColor: 'midnight',
      brightnessLevel: 100,
      warmthFilter: false,
      alarms: [
        {
          id: 'alarm-1',
          time: '07:30',
          label: '周内温和唤醒',
          enabled: true,
          repeatDays: [1, 2, 3, 4, 5],
          tone: 'gentle_chime',
          vibrate: true,
          smartWakeEnabled: true,
          smartWakeWindowMinutes: 20,
        },
        {
          id: 'alarm-2',
          time: '08:30',
          label: '周末舒缓起床',
          enabled: false,
          repeatDays: [6, 7],
          tone: 'aurora_melody',
          vibrate: true,
          smartWakeEnabled: true,
          smartWakeWindowMinutes: 20,
        },
      ],
      aiConfig: {
        provider: 'deepseek',
        deepseekModel: 'deepseek-flash',
        systemPersona:
          '你是一位资深临床睡眠医学与生物钟节律顾问。以温暖关切、科学严谨的语气为用户答疑，重点指导如何提升深度睡眠质量。',
      },
    };
  });

  useEffect(() => {
    safeLocalStorageSet('somnacare_sleep_records', JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    safeLocalStorageSet('somnacare_user_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  // APK 启动时无条件同步一次闹钟到原生 AlarmManager（重启/重装后打开即恢复调度）
  useEffect(() => {
    if (isNativePlatform()) {
      syncAlarmsToNative(userProfile.alarms || []);
    }
  }, []);

  // 护眼滤镜：打开 App 时按配置/定时窗口自动启停，之后每 30 秒轮询一次
  const eyeCareCfg = userProfile.eyeCare ?? DEFAULT_EYE_CARE;
  useEffect(() => {
    void applyEyeCare(eyeCareCfg);
    const t = setInterval(() => void applyEyeCare(eyeCareCfg), 30_000);
    return () => clearInterval(t);
  }, [eyeCareCfg]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const handleSaveActiveSleep = (newRecord: SleepRecord) => {
    setRecords((prev) => {
      const filtered = prev.filter((r) => r.date !== newRecord.date);
      return [newRecord, ...filtered].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    });
    showToast(`🌙 记录已保存！本次睡眠记录时长 ${newRecord.durationMinutes < 60 ? `${newRecord.durationMinutes}分钟` : `${(newRecord.durationMinutes / 60).toFixed(1)}小时`}`);
  };

  const handleSaveManualRecord = (newRecord: SleepRecord) => {
    setRecords((prev) => {
      const filtered = prev.filter((r) => r.date !== newRecord.date);
      return [newRecord, ...filtered].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    });
    showToast(`📝 睡眠记录已保存！综合健康得分 ${newRecord.sleepScore} 分`);
  };

  const handleResetDemoData = () => {
    const initial = getInitialSleepLogs();
    setRecords(initial);
    showToast('已重置恢复 7 天真实睡眠示例数据');
  };

  const handleDeleteRecord = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    showToast('已删除该条睡眠数据');
  };

  // Obtain active theme config (card, text, page all linked)
  const currentTheme = APP_THEMES[userProfile.themeColor as keyof typeof APP_THEMES] || APP_THEMES.midnight;

  return (
    <div
      className={`min-h-screen w-full theme-${currentTheme.id} ${currentTheme.pageBg} ${currentTheme.textPrimary} selection:bg-indigo-500/30 relative flex flex-col transition-colors duration-300`}
    >
      <LaunchSplash theme={currentTheme} />
      {/* 夜间护眼：原生端由系统悬浮窗全局生效，应用内不再叠加（避免双重滤镜）；
          Web/PWA 端回退为应用内滤镜层 */}
      {!isNativePlatform() && (eyeCareCfg.enabled
        ? (() => {
            const inWindow = isInEyeCareWindow(eyeCareCfg);
            if (!inWindow) return null;
            const { warm, dim } = eyeCareInAppStyles(eyeCareCfg);
            return (
              <>
                <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: warm, mixBlendMode: 'multiply' }} />
                <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: dim }} />
              </>
            );
          })()
        : (
          <>
            {userProfile.warmthFilter && (
              <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: 'rgba(255,147,41,0.10)', mixBlendMode: 'multiply' }} />
            )}
            {userProfile.brightnessLevel < 100 && (
              <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: `rgba(0,0,0,${((100 - userProfile.brightnessLevel) / 100) * 0.55})` }} />
            )}
          </>
        ))}
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[90] px-5 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black shadow-2xl flex items-center gap-2.5 animate-bounce border border-indigo-400">
          <CheckCircle2 className="w-5 h-5 text-indigo-200" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Area: Natural Vertical Page Scroll (Header flows with content) */}
      <div className="w-full flex-1 max-w-lg mx-auto flex flex-col">
        {/* Scrollable Mobile Header */}
        <header className={`px-5 pt-5 pb-3.5 flex items-center justify-between border-b ${currentTheme.cardBorder} shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <Moon className="w-5 h-5 fill-white/40" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">
              极光睡眠
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs ${currentTheme.textPrimary} font-bold ${currentTheme.cardBg} px-3.5 py-1.5 rounded-full border ${currentTheme.cardBorder} shadow-md`}>
              {new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
        </header>

        {/* Tab View Container（key 重挂载触发 180ms 淡入上浮动效）
            导航栏是 fixed 定位，底部让位统一由这里的 pb-28 负责：
            原先 5 个页签根节点各写一遍 pb-28，改导航高度时得记得改 5 处。
            flex flex-col 让「内容比视口短」的页签可以用 my-auto 或 h-full 撑开。 */}
        <main key={activeTab} className="animate-tab-fade-in px-4 pt-4 pb-28 space-y-4 flex-1 flex flex-col">
          {activeTab === 'today' && (
            <TodayTab
              records={records}
              userProfile={userProfile}
              onOpenActiveSleep={() => setIsActiveSleepOpen(true)}
              onOpenManualLog={() => setIsManualLogOpen(true)}
              onNavigateToCoach={() => setActiveTab('coach')}
              onSaveRecord={handleSaveManualRecord}
              theme={currentTheme}
            />
          )}

          {activeTab === 'trends' && (
            <TrendsTab
              records={records}
              onDeleteRecord={handleDeleteRecord}
              theme={currentTheme}
            />
          )}

          {activeTab === 'coach' && (
            <AIAdvicePanel records={records} userProfile={userProfile} theme={currentTheme} />
          )}

          {activeTab === 'eyecare' && (
            <EyeCareTab
              userProfile={userProfile}
              onUpdateProfile={(updated) => setUserProfile((prev) => ({ ...prev, ...updated }))}
              onToast={showToast}
              theme={currentTheme}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              records={records}
              userProfile={userProfile}
              onUpdateProfile={(updated) => setUserProfile((prev) => ({ ...prev, ...updated }))}
              onResetDemoData={handleResetDemoData}
              onImportRecords={(raw) => {
                const valid = raw.filter(isSleepRecordLike);
                const skipped = raw.length - valid.length;
                if (valid.length === 0) {
                  showToast('⚠️ 导入失败：文件里没有可识别的睡眠记录');
                  return;
                }
                // 合并而非整体覆盖：此前直接 setRecords(imported) 会静默清掉现有数据
                setRecords((prev) => {
                  const byDate = new Map<string, SleepRecord>();
                  for (const r of prev) byDate.set(r.date, r);
                  for (const r of valid) byDate.set(r.date, r);
                  return [...byDate.values()].sort(
                    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
                  );
                });
                showToast(
                  skipped > 0
                    ? `已导入 ${valid.length} 条记录（跳过 ${skipped} 条无法识别）`
                    : `已导入 ${valid.length} 条睡眠记录`
                );
              }}
              theme={currentTheme}
            />
          )}
        </main>
      </div>

      {/* Bottom Navigation: Permanently fixed at screen bottom with theme styles */}
      <BottomNavBar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        theme={currentTheme}
      />

      {/* Floating Active Sleep Modal (Live Bedside Monitor) */}
      <ActiveSleepModal
        isOpen={isActiveSleepOpen}
        onClose={() => setIsActiveSleepOpen(false)}
        onFinishSleep={handleSaveActiveSleep}
        theme={currentTheme}
        targetDurationHours={userProfile.targetDurationHours}
      />

      {/* Manual Sleep Log Modal */}
      <ManualLogModal
        isOpen={isManualLogOpen}
        onClose={() => setIsManualLogOpen(false)}
        onSaveRecord={handleSaveManualRecord}
        theme={currentTheme}
        targetDurationHours={userProfile.targetDurationHours}
      />
    </div>
  );
};

export default App;
