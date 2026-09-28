import React, { useEffect, useState } from 'react';
import { ThemeConfig } from '../utils/themeStyles';

const KEY = 'somnacare_splash_shown';

/** 四主题月色：受光渐变亮色 / 暗部深色 / 极光双色 */
const MOON_THEMES: Record<string, { lit: string; deep: string; aur1: string; aur2: string }> = {
  midnight: { lit: '#a8e6ff', deep: '#2563eb', aur1: '#2d529e', aur2: '#9db4ff' },
  pure_dark: { lit: '#f1f5f9', deep: '#475569', aur1: '#1e293b', aur2: '#94a3b8' },
  warm_amber: { lit: '#fff7e0', deep: '#f59e0b', aur1: '#92400e', aur2: '#fcd34d' },
  serene_blue: { lit: '#ccfbf1', deep: '#0891b2', aur1: '#155e75', aur2: '#67e8f9' },
};

/**
 * 品牌开屏（三段式，冷启动一次）：
 * 1. 一滴水落入湖面，涟漪扩散；
 * 2. 镜头拉远，月亮顺时针渲染成形（主题色渐变）；
 * 3. 极光条带浮现于月亮后方，涟漪倒影与宣传词“懂睡眠，更懂你”随之出现。
 * 结束后 500ms 淡出进主界面。原生启动屏与首帧同色，衔接无缝。
 */
export const LaunchSplash: React.FC<{ theme: ThemeConfig }> = ({ theme }) => {
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const t1 = setTimeout(() => setFading(true), 2950);
    const t2 = setTimeout(() => {
      try {
        sessionStorage.setItem(KEY, '1');
      } catch {
        // ignore
      }
      setVisible(false);
    }, 3500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible]);

  if (!visible) return null;

  const mc = MOON_THEMES[theme.id] ?? MOON_THEMES.midnight;
  const CIRC = 2 * Math.PI * 62;

  return (
    <div
      className={`fixed inset-0 z-[200] overflow-hidden transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'linear-gradient(180deg, #060b1a 0%, #03060f 100%)' }}
    >
      {/* 第三步：极光条带（月亮后方浮现） */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0,
          animation: 'splash-aurora-in 800ms ease-out 1500ms both',
          background: `repeating-linear-gradient(97deg, transparent 0 14px, ${mc.aur2}22 14px 22px, transparent 22px 40px), linear-gradient(180deg, transparent 8%, ${mc.aur1}30 45%, transparent 85%)`,
          filter: 'blur(14px)',
        }}
      />

      {/* 第一步：水滴落入湖面 */}
      <div
        className="absolute left-1/2 top-[38%] rounded-full"
        style={{
          width: 13,
          height: 13,
          marginLeft: -6.5,
          marginTop: -6.5,
          background: mc.lit,
          boxShadow: `0 0 16px ${mc.lit}`,
          animation: 'splash-drop 620ms cubic-bezier(0.55,0,1,0.45) both',
        }}
      />
      {/* 涟漪 */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute left-1/2 top-[38%] rounded-full"
          style={{
            width: 150,
            height: 150,
            marginLeft: -75,
            marginTop: -75,
            border: `1.5px solid ${mc.lit}`,
            animation: `splash-ripple 950ms ease-out ${430 + i * 170}ms both`,
          }}
        />
      ))}

      {/* 第二步：月亮顺时针渲染 + 镜头拉远 */}
      <div
        className="absolute left-1/2 top-[38%]"
        style={{
          transform: 'translate(-50%,-50%)',
          animation: 'splash-zoom 1500ms ease-out 500ms both',
        }}
      >
        <svg width="230" height="230" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="splashMoonGrad" x1="0" y1="1" x2="0.55" y2="0">
              <stop offset="0%" stopColor={mc.lit} />
              <stop offset="100%" stopColor={mc.deep} />
            </linearGradient>
            <mask id="splashBiteMask">
              <rect width="200" height="200" fill="white" />
              <circle cx="139" cy="76" r="56" fill="black" />
            </mask>
          </defs>
          {/* 顺时针描边 */}
          <circle
            cx="100"
            cy="100"
            r="62"
            fill="none"
            stroke={mc.lit}
            strokeWidth="2.5"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform="rotate(-90 100 100)"
            opacity="0.85"
            style={{ animation: 'splash-draw 850ms ease-in-out 600ms both' }}
          />
          {/* 渐变填充（描边完成后浮现） */}
          <g mask="url(#splashBiteMask)">
            <circle
              cx="100"
              cy="100"
              r="62"
              fill="url(#splashMoonGrad)"
              opacity="0"
              style={{ animation: 'splash-fill 480ms ease-out 1300ms both' }}
            />
          </g>
        </svg>
      </div>

      {/* 第三步：月亮下缘扩散出的水面涟漪
          ── 这里原先有真实的错位缺陷 ──
          原实现是 6 个 ry=2 的极扁椭圆，而且容器用 left:50% + translateX(-50%)
          居中，同时挂着 transform 动画。CSS 动画的 transform 会覆盖内联
          transform，fill-mode:both 又把终态 translateY(0) 永久留在元素上，
          于是 translateX(-50%) 再也没回来。实测（390px 视口）：
            月亮中心 X = 195（正确）
            涟漪中心 X = 310（偏右 115px = 230px 宽度的一半）
          涟漪从 195 一直铺到 425，右半截直接跑出屏幕。评审说的「飘在月亮
          右下角、和月亮没有任何视觉连接」就是这个偏移，不是审美问题。
          修法：居中不再依赖 transform，改用 left:0/right:0 + flex 居中，
          动画只负责 translateY。以下文字块同理。
          图形本身也换成同心椭圆：圆心放在轨道顶边（cy=0），上半被 SVG 视口
          自然裁掉，留下的下弧才是「水面上扩散的涟漪」，而不是一排平行横线。 */}
      <div
        className="absolute left-0 right-0 flex justify-center"
        style={{
          top: 'calc(38% + 71px)',
          opacity: 0,
          animation: 'splash-rise 650ms ease-out 1950ms both',
        }}
      >
        <svg width="360" height="48" viewBox="0 0 360 48" aria-hidden="true">
          {(
            [
              [40, 10],
              [78, 17],
              [116, 25],
              [154, 33],
            ] as Array<[number, number]>
          ).map(([rx, ry], i) => (
            <ellipse
              key={i}
              cx="180"
              cy="0"
              rx={rx}
              ry={ry}
              fill="none"
              stroke={mc.lit}
              strokeWidth="1.4"
              style={{
                transformOrigin: '180px 0px',
                transformBox: 'view-box',
                animation: `splash-ripple-out 1400ms ease-out ${1950 + i * 190}ms both`,
              }}
            />
          ))}
        </svg>
      </div>

      {/* 品牌名。原先整屏只有图形和一句宣传词，第一印象偏空；
          名字放在月亮之下、宣传词之上，作为视觉的落点。 */}
      <div
        className="absolute left-0 right-0 text-center"
        style={{ top: 'calc(38% + 140px)', opacity: 0, animation: 'splash-rise 700ms ease-out 2050ms both' }}
      >
        <p
          className="text-[22px] font-black text-white"
          style={{ letterSpacing: '0.3em', paddingLeft: '0.3em' }}
        >
          极光睡眠
        </p>
      </div>

      {/* 宣传词 */}
      <div
        className="absolute left-0 right-0 text-center"
        style={{ top: 'calc(38% + 182px)', opacity: 0, animation: 'splash-rise 750ms ease-out 2250ms both' }}
      >
        <p
          className="text-[14px] text-slate-300 whitespace-nowrap"
          style={{
            letterSpacing: '0.42em',
            paddingLeft: '0.42em',
            // 上浮 + 由左向右揭开。两个动画分别只写 transform 和 clip-path，
            // 不抢同一个属性。定位仍然只用 left/right，不用 transform。
            animation: 'splash-rise 500ms ease-out 2250ms both, splash-ltr 900ms ease-out 2430ms both',
          }}
        >
          懂睡眠，更懂你
        </p>
      </div>
    </div>
  );
};

export default LaunchSplash;
