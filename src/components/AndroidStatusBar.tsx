import React, { useState, useEffect } from 'react';
import { Wifi, BatteryMedium, Moon, Smartphone, Maximize2 } from 'lucide-react';

interface AndroidStatusBarProps {
  isPhoneFrame: boolean;
  onToggleFrame: () => void;
}

export const AndroidStatusBar: React.FC<AndroidStatusBarProps> = ({
  isPhoneFrame,
  onToggleFrame,
}) => {
  const [timeStr, setTimeStr] = useState('23:45');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      setTimeStr(`${h}:${m}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full shrink-0 select-none bg-[#161f33] border-b border-slate-800/80">
      {/* Mobile Top Bar */}
      <div className="flex items-center justify-between px-5 pt-2 pb-2 text-xs font-medium text-slate-200 tracking-tight">
        {/* Left: Clock & App icon */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-white tabular-nums">{timeStr}</span>
          <span className="flex items-center gap-1 text-[11px] text-indigo-300">
            <Moon className="w-3 h-3 text-indigo-400 fill-indigo-400/40" />
            <span className="text-[11px] text-slate-300 font-medium">夜间守护中</span>
          </span>
        </div>

        {/* Right: Signal, Wifi, Battery */}
        <div className="flex items-center gap-2 text-slate-200">
          <span className="text-[11px] font-bold text-slate-300">5G</span>
          <Wifi className="w-3.5 h-3.5 text-slate-200" />
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono tabular-nums text-slate-200 font-semibold">92%</span>
            <BatteryMedium className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
      </div>
    </div>
  );
};
