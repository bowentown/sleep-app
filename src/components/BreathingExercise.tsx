import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Wind, ShieldCheck, Heart } from 'lucide-react';

type BreathPhase = 'idle' | 'inhale' | 'hold' | 'exhale';

/** 推荐轮数：达到后提示可以停下，不强制。 */
export const RECOMMENDED_ROUNDS = 4;

export const BreathingExercise: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<BreathPhase>('idle');
  const [countdown, setCountdown] = useState(4);
  const [completedRounds, setCompletedRounds] = useState(0);

  useEffect(() => {
    let timer: number;
    if (isActive) {
      timer = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev > 1) {
            return prev - 1;
          }

          // Advance phase
          if (phase === 'idle' || phase === 'exhale') {
            setPhase('inhale');
            return 4; // 4 seconds inhale
          } else if (phase === 'inhale') {
            setPhase('hold');
            return 7; // 7 seconds hold
          } else if (phase === 'hold') {
            setPhase('exhale');
            setCompletedRounds((r) => r + 1);
            return 8; // 8 seconds exhale
          }
          return 4;
        });
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [isActive, phase]);

  const handleStart = () => {
    setIsActive(true);
    setPhase('inhale');
    setCountdown(4);
  };

  const handlePause = () => {
    setIsActive(false);
  };

  const handleReset = () => {
    setIsActive(false);
    setPhase('idle');
    setCountdown(4);
    setCompletedRounds(0);
  };

  const getPhaseText = () => {
    switch (phase) {
      case 'inhale':
        return { title: '缓缓深吸气', desc: '用鼻子吸气，让腹部先鼓起来' };
      case 'hold':
        return { title: '平稳屏气', desc: '屏不住就直接呼气——7 秒不是硬指标' };
      case 'exhale':
        return { title: '轻柔呼气', desc: '口唇微启，慢慢把气吐尽' };
      default:
        return { title: '4-7-8 助眠呼吸', desc: '呼气比吸气长，副交感神经就会占上风' };
    }
  };

  const currentInfo = getPhaseText();

  // Circle scaling calculation
  const getScaleClass = () => {
    if (!isActive || phase === 'idle') return 'scale-100';
    if (phase === 'inhale') return 'scale-125 transition-transform duration-4000 ease-out';
    if (phase === 'hold') return 'scale-125';
    if (phase === 'exhale') return 'scale-90 transition-transform duration-8000 ease-in-out';
    return 'scale-100';
  };

  return (
    <div className="w-full bg-slate-900/80 rounded-2xl p-5 border border-slate-800/80 flex flex-col items-center text-center">
      <div className="flex items-center justify-between w-full mb-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Wind className="w-4 h-4 text-teal-400" />
          <span>4-7-8 助眠呼吸法</span>
        </div>
        <span className="text-[11px] text-slate-400">已完成 {completedRounds} 轮</span>
      </div>

      {/* Visual Breathing Circle */}
      <div className="relative w-44 h-44 my-4 flex items-center justify-center">
        {/* Outer glowing ripple */}
        <div
          className={`absolute inset-0 rounded-full bg-teal-500/10 blur-xl transition-all duration-1000 ${
            phase === 'inhale' ? 'opacity-80 scale-110' : phase === 'hold' ? 'opacity-90 scale-115' : 'opacity-20 scale-95'
          }`}
        />

        {/* Dynamic breathing orb */}
        <div
          className={`w-36 h-36 rounded-full flex flex-col items-center justify-center border shadow-2xl transition-all duration-700 ${getScaleClass()} ${
            phase === 'inhale'
              ? 'bg-gradient-to-tr from-teal-900/60 to-cyan-800/40 border-teal-400/50 text-teal-200'
              : phase === 'hold'
              ? 'bg-gradient-to-tr from-indigo-900/60 to-purple-800/40 border-indigo-400/50 text-indigo-200'
              : phase === 'exhale'
              ? 'bg-gradient-to-tr from-slate-900 to-teal-950/60 border-slate-700/60 text-slate-300'
              : 'bg-slate-950/80 border-slate-800 text-slate-400'
          }`}
        >
          {isActive ? (
            <>
              <span className="text-[32px] font-mono font-bold tabular-nums">{countdown}</span>
              <span className="text-xs font-medium mt-1">
                {phase === 'inhale' ? '吸气 4s' : phase === 'hold' ? '屏气 7s' : '呼气 8s'}
              </span>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Heart className="w-7 h-7 text-teal-400/80" />
              <span className="text-xs font-medium text-slate-300">点击开始</span>
            </div>
          )}
        </div>
      </div>

      {/* Guide text */}
      <div className="min-h-[50px] mb-4">
        <h4 className="text-sm font-semibold text-slate-100">{currentInfo.title}</h4>
        <p className="text-xs text-slate-400 mt-0.5 max-w-xs">{currentInfo.desc}</p>
      </div>

      {/* 满 4 轮后给一句「可以停了」。
          呼吸练习的目的是松下来，不是完成 KPI；把「还差几轮」变成压力就本末倒置了。
          CBT-I 里唯一被证实起中介作用的是**降低睡眠努力**（10.1111/psyg.13074），
          所以这里的措辞是允许停下，而不是催促继续。 */}
      {completedRounds >= RECOMMENDED_ROUNDS && (
        <p className="text-[11px] text-teal-300/85 mb-3 max-w-xs">
          已经 {completedRounds} 轮了，想停就停——躺着不动也是休息。
        </p>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {!isActive ? (
          <button
            onClick={handleStart}
            className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-teal-950 active:scale-95 transition-all"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>开始呼吸引导</span>
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs flex items-center gap-2 active:scale-95 transition-all"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>暂停</span>
          </button>
        )}

        <button
          onClick={handleReset}
          className="p-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          title="重置"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-800/60 w-full flex items-center justify-center gap-4 text-[11px] text-slate-400">
        <span>🌙 睡前 4 轮左右即可</span>
        <span>•</span>
        <span>延长呼气激活副交感神经</span>
      </div>
    </div>
  );
};
