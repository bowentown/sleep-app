export type ThemeMode = 'midnight' | 'pure_dark' | 'warm_amber' | 'serene_blue';

export interface ThemeConfig {
  id: ThemeMode;
  name: string;
  tag: string;
  desc: string;
  // App container
  pageBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // Card styling
  cardBg: string;
  cardBorder: string;
  cardInnerBg: string;
  cardInnerBorder: string;
  // Highlights & accents
  accentColor: string;
  accentBg: string;
  accentText: string;
  accentRing: string;
  /** 原始十六进制强调色：供 SVG 描边、图表与氛围光等内联样式使用 */
  accentHex: string;
  // Nav bar
  navBg: string;
  navBorder: string;
  navActiveBg: string;
  navActiveText: string;
  navInactiveText: string;
  // Preview
  dot: string;
}

export const APP_THEMES: Record<ThemeMode, ThemeConfig> = {
  midnight: {
    id: 'midnight',
    name: '极光午夜',
    tag: '深邃经典',
    desc: '群青暗夜底 · 晶白与天青卡片 · 靛蓝高亮',
    pageBg: 'bg-[#090d1a]',
    textPrimary: 'text-white',
    textSecondary: 'text-slate-200',
    textMuted: 'text-slate-400',
    cardBg: 'bg-[#151d30]',
    cardBorder: 'border-slate-700/80',
    cardInnerBg: 'bg-[#0c1222]',
    // 曾经写的是 border-slate-850——Tailwind 4 的 slate 调色板只有 800/900，
    // 这个类生成不出任何 CSS，border-color 于是回退成 currentColor，
    // 于是「很淡的深色描边」在屏幕上变成了纯白描边（构建和类型检查都不报错）。
    // 比外层 cardBorder（slate-700/80）更淡，形成层次而不是互抢。
    cardInnerBorder: 'border-slate-800/60',
    accentColor: 'indigo-500',
    accentBg: 'bg-indigo-600 hover:bg-indigo-500',
    accentText: 'text-indigo-400',
    accentRing: 'ring-indigo-400',
    accentHex: '#818cf8',
    navBg: 'bg-[#0f172a]',
    navBorder: 'border-slate-800',
    navActiveBg: 'bg-indigo-600/25',
    navActiveText: 'text-indigo-400',
    navInactiveText: 'text-slate-400',
    dot: 'bg-indigo-400',
  },
  pure_dark: {
    id: 'pure_dark',
    name: '深空纯黑 (OLED)',
    tag: '极致对比与省电',
    desc: '100%纯黑黑底 · 石墨黑实心卡片 · 锐利白字',
    pageBg: 'bg-[#000000]',
    textPrimary: 'text-white',
    textSecondary: 'text-zinc-200',
    textMuted: 'text-zinc-400',
    cardBg: 'bg-[#121214]',
    cardBorder: 'border-zinc-800',
    cardInnerBg: 'bg-[#08080a]',
    // 同 midnight：border-zinc-850 不存在，会回退成纯白描边。
    // 比外层 cardBorder（zinc-800）更淡。
    cardInnerBorder: 'border-zinc-800/60',
    accentColor: 'indigo-500',
    accentBg: 'bg-zinc-800 hover:bg-zinc-700',
    accentText: 'text-zinc-200',
    accentRing: 'ring-zinc-500',
    accentHex: '#d4d4d8',
    navBg: 'bg-[#000000]',
    navBorder: 'border-zinc-800',
    navActiveBg: 'bg-zinc-800/80',
    navActiveText: 'text-white',
    navInactiveText: 'text-zinc-500',
    dot: 'bg-zinc-200',
  },
  warm_amber: {
    id: 'warm_amber',
    name: '琥珀暖夜 (助眠)',
    tag: '褪黑素保护',
    desc: '深茶原木底 · 暖赭实心卡片 · 柔金色字符',
    pageBg: 'bg-[#18110b]',
    textPrimary: 'text-amber-50',
    textSecondary: 'text-amber-200',
    textMuted: 'text-amber-300/70',
    cardBg: 'bg-[#261c14]',
    cardBorder: 'border-amber-900/60',
    cardInnerBg: 'bg-[#2b1f13]',
    cardInnerBorder: 'border-amber-900/70',
    accentColor: 'amber-500',
    accentBg: 'bg-amber-600 hover:bg-amber-500',
    accentText: 'text-amber-300',
    accentRing: 'ring-amber-400',
    accentHex: '#fcd34d',
    navBg: 'bg-[#1f1610]',
    navBorder: 'border-amber-950',
    navActiveBg: 'bg-amber-600/30',
    navActiveText: 'text-amber-300',
    navInactiveText: 'text-amber-400/60',
    dot: 'bg-amber-400',
  },
  serene_blue: {
    id: 'serene_blue',
    name: '静谧深海 (舒缓)',
    tag: '平静安神',
    desc: '墨绿海渊底 · 藏青色实心卡片 · 冰川青高光',
    pageBg: 'bg-[#061320]',
    textPrimary: 'text-cyan-50',
    textSecondary: 'text-cyan-200',
    textMuted: 'text-cyan-300/70',
    cardBg: 'bg-[#0c2238]',
    cardBorder: 'border-cyan-900/60',
    cardInnerBg: 'bg-[#102a42]',
    cardInnerBorder: 'border-cyan-900/70',
    accentColor: 'cyan-400',
    accentBg: 'bg-cyan-600 hover:bg-cyan-500',
    accentText: 'text-cyan-300',
    accentRing: 'ring-cyan-400',
    accentHex: '#67e8f9',
    navBg: 'bg-[#07192b]',
    navBorder: 'border-cyan-950',
    navActiveBg: 'bg-cyan-600/30',
    navActiveText: 'text-cyan-300',
    navInactiveText: 'text-cyan-400/60',
    dot: 'bg-cyan-400',
  },
};
