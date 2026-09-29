import React, { useEffect, useRef, useState } from 'react';
import { Eye, MoonStar, BookOpen, Gamepad2, BedDouble, Pipette, Clock, CheckCircle2 } from 'lucide-react';
import { UserProfile, EyeCareConfig, DEFAULT_EYE_CARE } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';
import {
  isEyeCareNative,
  eyeCarePermissionGranted,
  eyeCareOpenPermissionSettings,
  eyeCareInAppStyles,
  isInEyeCareWindow,
  applyEyeCare,
  stopEyeCareNow,
} from '../utils/eyeCare';

interface EyeCareTabProps {
  userProfile: UserProfile;
  onUpdateProfile: (updated: Partial<UserProfile>) => void;
  onToast: (msg: string) => void;
  theme: ThemeConfig;
}

// ===== 场景预设：每个场景是一组（主色调 + 滤镜强度 + 减光），色相彼此区分 =====
// 夜间=暖黄（经典减蓝光）· 阅读=豆沙绿（护眼绿纸感）· 游戏=中性灰（色彩保真只压暗）· 助眠=深橙（最强减蓝+减光）
const SCENES: {
  id: EyeCareConfig['preset'];
  name: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  strength: number;
  dim: number;
}[] = [
  { id: 'night', name: '夜间', desc: '暖黄减蓝', icon: MoonStar, color: '#FFB35C', strength: 50, dim: 15 },
  { id: 'reading', name: '阅读', desc: '豆沙绿纸感', icon: BookOpen, color: '#CDE8CE', strength: 30, dim: 0 },
  { id: 'game', name: '游戏', desc: '中性灰保真', icon: Gamepad2, color: '#D6E0EA', strength: 15, dim: 10 },
  { id: 'sleep', name: '助眠', desc: '深橙低亮', icon: BedDouble, color: '#FF7A50', strength: 75, dim: 30 },
];

// 自定义调色盘精选色点（覆盖暖黄/橙/绿/灰蓝/紫/蓝，与场景色相呼应）
const PALETTE_DOTS = ['#FFE8C2', '#FFC178', '#FF9D57', '#FF7A50', '#CDE8CE', '#D6E0EA', '#C9A0FF', '#9DB4FF'];

// 旧版预设名迁移
const LEGACY_PRESET_MAP: Record<string, EyeCareConfig['preset']> = { soft: 'reading', amber: 'night', maple: 'sleep' };

const hslToHex = (h: number, s: number, l: number): string => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
};
const hexToHue = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 28;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
};

/** 色相条：指针拖动取色（触屏友好） */
const HueBar: React.FC<{ hue: number; onChange: (h: number) => void }> = ({ hue, onChange }) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(Math.round(t * 359));
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="色相"
      aria-valuenow={Math.round(hue)}
      className="relative h-5 rounded-full cursor-pointer touch-none select-none"
      style={{
        background:
          'linear-gradient(90deg,#ff8080,#ffc780,#f5ff80,#96ff80,#80ffe0,#80b3ff,#c280ff,#ff80d5,#ff8080)',
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) pick(e.clientX);
      }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full border-2 border-white shadow-md pointer-events-none"
        style={{ left: `${(Math.min(359, Math.max(0, hue)) / 359) * 100}%`, background: hslToHex(hue, 0.68, 0.6) }}
      />
    </div>
  );
};

export const EyeCareTab: React.FC<EyeCareTabProps> = ({ userProfile, onUpdateProfile, onToast, theme }) => {
  const rawCfg = userProfile.eyeCare ?? DEFAULT_EYE_CARE;
  const cfg: EyeCareConfig = LEGACY_PRESET_MAP[rawCfg.preset]
    ? { ...rawCfg, preset: LEGACY_PRESET_MAP[rawCfg.preset] }
    : rawCfg;
  const native = isEyeCareNative();
  const [granted, setGranted] = useState<boolean>(true);
  const [now, setNow] = useState<Date>(new Date());
  const [hue, setHue] = useState<number>(() => hexToHue(cfg.warmColor));

  const patch = (p: Partial<EyeCareConfig>) => onUpdateProfile({ eyeCare: { ...cfg, ...p } });

  // 权限状态 + 每 30s 轮询（定时窗口自动启停）
  useEffect(() => {
    if (native) {
      eyeCarePermissionGranted().then(setGranted);
    }
    void applyEyeCare(cfg);
    const t = setInterval(() => {
      setNow(new Date());
      void applyEyeCare(cfg);
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.enabled, cfg.scheduleEnabled, cfg.start, cfg.end, cfg.warmColor, cfg.warmStrength, cfg.dimStrength]);

  const inWindow = isInEyeCareWindow(cfg, now);
  const active = cfg.enabled && inWindow;
  const styles = eyeCareInAppStyles(cfg);

  const handleToggle = async (next: boolean) => {
    if (next && native) {
      const ok = await eyeCarePermissionGranted();
      setGranted(ok);
      if (!ok) {
        await eyeCareOpenPermissionSettings();
        onToast('请在系统设置中允许"显示在其他应用上层"，返回后再次开启');
        return;
      }
    }
    patch({ enabled: next });
    if (next) {
      const applied = await applyEyeCare({ ...cfg, enabled: true });
      onToast(applied ? '护眼滤镜已开启，全局生效' : '护眼滤镜将在定时窗口内自动生效');
    } else {
      await stopEyeCareNow();
      onToast('护眼滤镜已关闭');
    }
  };

  const statusLine = active
    ? '滤镜生效中'
    : cfg.enabled
      ? '等待定时窗口自动开启'
      : '已关闭';

  return (
    <div className={`space-y-4 ${theme.textPrimary}`}>
      {/* 1. 总开关 + 状态 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-orange-500/20 text-orange-300 flex items-center justify-center border border-orange-400">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">护眼滤镜</h3>
              <p className="text-xs text-slate-400 flex items-center gap-1" aria-live="polite">
                {active ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : null}
                {statusLine}
                {cfg.enabled && cfg.scheduleEnabled ? ` · 定时 ${cfg.start}–${cfg.end}` : ''}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => void handleToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-600 peer-checked:bg-orange-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>

        {/* 滤镜色预览细条 */}
        <div
          className="h-2 rounded-full border border-white/5"
          style={{ background: `linear-gradient(90deg, #0b1026, ${styles.warm})` }}
          aria-hidden
        />

        {native && cfg.enabled && !granted && (
          <button
            type="button"
            onClick={() => {
              void eyeCareOpenPermissionSettings();
              onToast('授权后返回本页，再次打开护眼开关即可');
            }}
            className="w-full py-2.5 rounded-xl bg-orange-500/20 border border-orange-400 text-orange-200 text-xs font-bold cursor-pointer active:scale-[0.98] transition-transform"
          >
            需要悬浮窗权限 · 前往系统设置授权
          </button>
        )}
        {!native && (
          <p className="text-xs text-slate-500">网页预览仅应用内生效；安装 APK 后全系统生效</p>
        )}
      </div>

      {/* 2. 场景预设 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl`}>
        <div className="grid grid-cols-4 gap-2.5">
          {SCENES.map((s) => {
            const Icon = s.icon;
            const selected = cfg.preset === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => patch({ preset: s.id, warmColor: s.color, warmStrength: s.strength, dimStrength: s.dim })}
                className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 border transition-all cursor-pointer active:scale-[0.96] ${
                  selected
                    ? 'border-orange-400/80 bg-orange-500/10 shadow-lg shadow-orange-900/20'
                    : `${theme.cardInnerBg} ${theme.cardInnerBorder} hover:border-white/20`
                }`}
              >
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center border border-white/10"
                  style={{ background: `linear-gradient(135deg, ${s.color}, ${s.color}55)` }}
                >
                  <Icon className="w-5 h-5 text-white/90" />
                </div>
                <span className={`text-xs font-bold ${selected ? 'text-orange-200' : 'text-white'}`}>{s.name}</span>
                <span className="text-[11px] text-slate-400 leading-none">{s.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 自定义调色盘 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3.5`}>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => patch({ preset: 'custom' })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all active:scale-95 ${
              cfg.preset === 'custom'
                ? 'border-orange-400/80 bg-orange-500/10 text-orange-200'
                : `${theme.cardInnerBg} ${theme.cardInnerBorder} text-white`
            }`}
          >
            <Pipette className="w-3.5 h-3.5" />
            自定义颜色
          </button>
          <div
            className="w-9 h-9 rounded-2xl border border-white/15 shadow-inner"
            style={{ background: cfg.warmColor }}
            aria-label={`当前颜色 ${cfg.warmColor}`}
          />
        </div>

        {/* 精选色点 */}
        <div className="flex items-center justify-between gap-2">
          {PALETTE_DOTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`选择颜色 ${c}`}
              onClick={() => {
                setHue(hexToHue(c));
                patch({ preset: 'custom', warmColor: c });
              }}
              className={`w-7 h-7 rounded-full cursor-pointer transition-transform active:scale-90 border ${
                cfg.warmColor.toUpperCase() === c ? 'border-white scale-110 shadow-md' : 'border-white/10'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>

        {/* 色相条 */}
        <HueBar
          hue={hue}
          onChange={(h) => {
            setHue(h);
            patch({ preset: 'custom', warmColor: hslToHex(h, 0.68, 0.6) });
          }}
        />
      </div>

      {/* 4. 强度调节 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3.5`}>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-bold">
            <span className="text-slate-200">滤镜强度</span>
            <span className="text-orange-400 font-mono">{cfg.warmStrength}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={cfg.warmStrength}
            onChange={(e) => patch({ warmStrength: Number(e.target.value) })}
            className="w-full accent-orange-500 cursor-pointer h-2 bg-slate-700 rounded-lg"
            aria-label="滤镜强度"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-bold">
            <span className="text-slate-200">屏幕减光</span>
            <span className="text-indigo-400 font-mono">{cfg.dimStrength}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={cfg.dimStrength}
            onChange={(e) => patch({ dimStrength: Number(e.target.value) })}
            className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-700 rounded-lg"
            aria-label="屏幕减光"
          />
        </div>
      </div>

      {/* 5. 定时（默认关闭，按需开启） */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-300" />
            <h3 className="text-sm font-bold text-white">定时开启</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={cfg.scheduleEnabled}
              onChange={(e) => patch({ scheduleEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-slate-600 peer-checked:bg-indigo-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>

        {cfg.scheduleEnabled && (
          <div className="grid grid-cols-2 gap-2.5">
            <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
              <span className="text-xs text-slate-400 block mb-1">开始</span>
              <input
                type="time"
                value={cfg.start}
                onChange={(e) => patch({ start: e.target.value || '22:00' })}
                className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none cursor-pointer"
                aria-label="定时开始时间"
              />
            </div>
            <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
              <span className="text-xs text-slate-400 block mb-1">结束</span>
              <input
                type="time"
                value={cfg.end}
                onChange={(e) => patch({ end: e.target.value || '07:00' })}
                className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none cursor-pointer"
                aria-label="定时结束时间"
              />
            </div>
          </div>
        )}
        <p className="text-xs text-slate-500">
          {cfg.scheduleEnabled
            ? '到点自动开、出窗自动关，支持跨午夜时段（如 22:00 – 07:00）'
            : '开启后按设定时间段自动开关滤镜'}
        </p>
      </div>
    </div>
  );
};
