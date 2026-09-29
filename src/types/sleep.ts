export type SleepStage = 'awake' | 'rem' | 'light' | 'deep';

export interface SleepStageSegment {
  stage: SleepStage;
  startTime: string; // e.g. "23:15"
  endTime: string;   // e.g. "00:45"
  durationMinutes: number;
}

export type WakingMood = 'refreshed' | 'neutral' | 'tired' | 'groggy';

export interface SleepRecord {
  id: string;
  date: string; // YYYY-MM-DD
  bedtime: string; // HH:mm
  wakeTime: string; // HH:mm
  durationMinutes: number;
  deepSleepMinutes: number;
  lightSleepMinutes: number;
  remSleepMinutes: number;
  awakeMinutes: number;
  sleepScore: number; // 0 - 100
  sleepEfficiency: number; // percentage, e.g. 92%
  latencyMinutes: number; // time to fall asleep
  wakeCount: number;
  wakingMood: WakingMood;
  preSleepHabits: string[]; // e.g. ['reading', 'screen_time', 'caffeine', 'hot_bath', 'meditation']
  dreamNotes?: string;
  stages?: SleepStageSegment[];
  soundEvents?: { time: string; decibel: number; label: string }[];
}

export interface PersonalizedRecommendation {
  timeWindow: string;
  action: string;
  detail: string;
  impact: string;
}

export interface ClinicalMetricsAnalysis {
  durationAssessment: string;
  deepSleepAssessment: string;
  remSleepAssessment: string;
  efficiencyAssessment: string;
  sleepLatencyAssessment: string;
}

export interface SleepAnalysisResult {
  chronotype: string;
  chronotypeDescription: string;
  overallHealthGrade: string;
  scoreSummary: string;
  clinicalMetricsAnalysis: ClinicalMetricsAnalysis;
  identifiedIssues: string[];
  personalizedRecommendations: PersonalizedRecommendation[];
  mindsetAffirmation: string;
}

export interface SoundscapeTrack {
  id: string;
  name: string;
  category: 'nature' | 'noise' | 'meditation';
  description: string;
  soundType: 'rain' | 'ocean' | 'forest' | 'whitenoise' | 'bowl';
  accentColor: string;
}

export interface CustomAlarmSetting {
  id: string;
  time: string; // "07:00"
  label: string; // "晨起舒缓唤醒"
  enabled: boolean;
  repeatDays: number[]; // [1,2,3,4,5] (1=Mon..7=Sun)
  tone: 'gentle_chime' | 'aurora_melody' | 'radar_beep';
  smartWakeEnabled: boolean;
  smartWakeWindowMinutes: number; // e.g. 20
}

export type AIProvider = 'built_in' | 'deepseek' | 'custom_openai' | 'local_rules' | 'local_llm';

export interface CustomAIConfig {
  provider: AIProvider;
  deepseekApiKey?: string;
  deepseekModel?: string; // e.g. 'deepseek-flash', 'deepseek-pro'
  customBaseUrl?: string; // e.g. 'https://api.deepseek.com'
  customApiKey?: string;
  customModelName?: string;
  systemPersona?: string; // AI role & tone prompt
  localModelVariant?: 'qwen_0_6b' | 'gemma_1b';
}

export interface EyeCareConfig {
  enabled: boolean; // 总开关（原生端为全局悬浮窗滤镜；Web 端回退为应用内滤镜）
  preset: 'night' | 'reading' | 'game' | 'sleep' | 'custom'; // 夜间 / 阅读 / 游戏 / 助眠 / 自定义
  warmColor: string; // '#RRGGBB' 滤镜色
  warmStrength: number; // 0-100 滤镜强度
  dimStrength: number; // 0-100 屏幕减光强度
  scheduleEnabled: boolean; // 定时开关（默认关闭，用户按需开启）
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
}

export const DEFAULT_EYE_CARE: EyeCareConfig = {
  enabled: false,
  preset: 'night',
  warmColor: '#FFB35C',
  warmStrength: 50,
  dimStrength: 15,
  scheduleEnabled: false,
  start: '22:00',
  end: '07:00',
};

export interface UserProfile {
  name: string;
  age: number;
  targetBedtime: string; // e.g. "23:00"
  targetWakeTime: string; // e.g. "07:00"
  targetDurationHours: number;
  smartWakeWindowMinutes: number;
  themeColor?: 'midnight' | 'pure_dark' | 'warm_amber' | 'serene_blue' | 'light_clean';
  brightnessLevel: number; // 0 - 100% app display brightness / dimming
  warmthFilter: boolean; // eye protection amber warm tint
  eyeCare?: EyeCareConfig;
  alarms?: CustomAlarmSetting[];
  aiConfig?: CustomAIConfig;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
