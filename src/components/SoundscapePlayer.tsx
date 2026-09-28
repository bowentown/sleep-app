import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Play, Pause, Timer, Music2, Sparkles } from 'lucide-react';
import { sleepAudio } from '../utils/audioSynth';
import { SoundscapeTrack } from '../types/sleep';

const TRACKS: SoundscapeTrack[] = [
  {
    id: 'rain',
    name: '窗畔细雨',
    category: 'nature',
    description: '柔和雨滴敲打玻璃与屋檐，天然声学掩蔽',
    soundType: 'rain',
    accentColor: 'from-blue-900/50 to-indigo-950/60',
  },
  {
    id: 'ocean',
    name: '深海潮汐',
    category: 'nature',
    description: '0.12Hz缓慢浪涌起伏，同步心肺静息节律',
    soundType: 'ocean',
    accentColor: 'from-teal-950/60 to-cyan-900/40',
  },
  {
    id: 'forest',
    name: '夜风竹林',
    category: 'nature',
    description: '微风轻拂竹叶与远处夏蝉，恬静乡村夜色',
    soundType: 'forest',
    accentColor: 'from-emerald-950/60 to-teal-900/40',
  },
  {
    id: 'whitenoise',
    name: '粉红噪音',
    category: 'noise',
    description: '能量均匀衰减的护眠声谱，隔绝突发杂音',
    soundType: 'whitenoise',
    accentColor: 'from-purple-950/60 to-indigo-950/50',
  },
  {
    id: 'bowl',
    name: '灵修颂钵',
    category: 'meditation',
    description: '432Hz谐波与4Hz缓慢拍频，长音共振助放松',
    soundType: 'bowl',
    accentColor: 'from-amber-950/60 to-orange-950/40',
  },
];

export const SoundscapePlayer: React.FC = () => {
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [timerMinutes, setTimerMinutes] = useState<number | null>(30);
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    let interval: number;
    if (isPlaying && timerRemainingSeconds !== null && timerRemainingSeconds > 0) {
      interval = window.setInterval(() => {
        setTimerRemainingSeconds((prev) => {
          if (prev && prev > 1) {
            return prev - 1;
          }
          // Timer finished
          sleepAudio.stop();
          setIsPlaying(false);
          setActiveTrackId(null);
          return null;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, timerRemainingSeconds]);

  const handleTrackClick = (track: SoundscapeTrack) => {
    if (activeTrackId === track.id && isPlaying) {
      sleepAudio.stop();
      setIsPlaying(false);
      setActiveTrackId(null);
      setTimerRemainingSeconds(null);
    } else {
      sleepAudio.play(track.soundType);
      setActiveTrackId(track.id);
      setIsPlaying(true);
      if (timerMinutes) {
        setTimerRemainingSeconds(timerMinutes * 60);
      }
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    sleepAudio.setVolume(newVol);
  };

  const handleSetTimer = (mins: number | null) => {
    setTimerMinutes(mins);
    if (mins) {
      setTimerRemainingSeconds(mins * 60);
    } else {
      setTimerRemainingSeconds(null);
    }
  };

  return (
    <div className="w-full bg-slate-900/80 rounded-2xl p-4 border border-slate-800/80">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
            <Music2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">助眠声景与自然白噪音</h3>
            <p className="text-[11px] text-slate-400">实时 Web Audio 声学引擎合成，纯净无损循环</p>
          </div>
        </div>

        {isPlaying && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/40 text-[10px] text-emerald-400 font-medium animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            播放中
          </span>
        )}
      </div>

      {/* Soundscape Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
        {TRACKS.map((t) => {
          const isThisPlaying = activeTrackId === t.id && isPlaying;
          return (
            <button
              key={t.id}
              onClick={() => handleTrackClick(t)}
              className={`text-left p-3 rounded-xl border transition-all flex items-center justify-between relative overflow-hidden group ${
                isThisPlaying
                  ? 'bg-gradient-to-r ' + t.accentColor + ' border-indigo-500/60 shadow-md shadow-indigo-950'
                  : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950/80'
              }`}
            >
              <div className="relative z-10 flex-1 pr-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100">{t.name}</span>
                  {t.category === 'meditation' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                      共振
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{t.description}</p>
              </div>

              {/* Play / Pause button */}
              <div
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform ${
                  isThisPlaying
                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-900/60'
                    : 'bg-slate-800 text-slate-300 group-hover:scale-105'
                }`}
              >
                {isThisPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
              </div>

              {/* Sound waves animation if playing */}
              {isThisPlaying && (
                <div className="absolute right-12 bottom-2 flex items-end gap-0.5 opacity-60">
                  <span className="w-1 h-3 bg-indigo-400 rounded-full animate-bounce" />
                  <span className="w-1 h-5 bg-indigo-300 rounded-full animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Playback Controls (Volume & Timer) */}
      <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-300">
        {/* Volume Slider */}
        <div className="flex items-center gap-2 w-full sm:w-1/2">
          {volume === 0 ? (
            <VolumeX className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <Volume2 className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <span className="text-[11px] font-mono text-slate-400 w-8 text-right tabular-nums">
            {Math.round(volume * 100)}%
          </span>
        </div>

        {/* Timer selector */}
        <div className="flex items-center justify-end gap-1.5 w-full sm:w-auto">
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mr-1">
            <Timer className="w-3.5 h-3.5 text-indigo-400" />
            <span>定时关</span>
          </div>
          {[15, 30, 45, 60].map((mins) => (
            <button
              key={mins}
              onClick={() => handleSetTimer(timerMinutes === mins ? null : mins)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                timerMinutes === mins
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              {mins}m
            </button>
          ))}
          {timerRemainingSeconds !== null && (
            <span className="text-[11px] font-mono text-indigo-400 ml-1 font-semibold tabular-nums">
              ({Math.floor(timerRemainingSeconds / 60)}:{String(timerRemainingSeconds % 60).padStart(2, '0')})
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
