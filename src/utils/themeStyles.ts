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
  /** 文本选中高亮。写法必须是完整字面量类名，不能运行期拼前缀。 */
  selectionBg: string;
  /** 强调色描边（border- 前缀完整类） */
  accentBorder: string;
  /**
   * 输入框聚焦时的强调色描边。**必须是字面量**。
   *
   * 这里不能写成 `${'focus:' + accentBorder}` 或 `focus:${theme.accentBorder}`：
   * Tailwind 4 是在构建时静态扫描源码文本里出现的类名字符串来生成 CSS 的，
   * 它扫不到运行期才拼出来的 `focus:border-indigo-400` 这个字面量，
   * 于是这条规则**根本不会生成**，聚焦描边色静默失效——不报错、不警告、
   * 类型检查也通过。（实测：用户源码里 7 处 `focus:${theme.accentBorder}`，
   * 构建产物中 `focus:border-*` 出现 0 次，而非 focus 版本出现 3 次。）
   */
  accentFocusBorder: string;
  accentColor: string;
  accentBg: string;
  /** accentBg 上该用什么前景色。深色底用浅字、浅色底用深字——
   *  这就是原先缺失的那一格：13 处按钮都硬编码 text-white，
   *  在琥珀(3.20:1)与青(3.62:1)两套主题上低于 4.5:1。 */
  accentFg: string;
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
    cardBg: 'bg-gradient-to-b from-[#1a2338] to-[#121a2c]',
    cardBorder: 'border-slate-700/80',
    cardInnerBg: 'bg-[#0c1222]',
    // 曾经写的是 border-slate-850——Tailwind 4 的 slate 调色板只有 800/900，
    // 这个类生成不出任何 CSS，border-color 于是回退成 currentColor，
    // 于是「很淡的深色描边」在屏幕上变成了纯白描边（构建和类型检查都不报错）。
    // 比外层 cardBorder（slate-700/80）更淡，形成层次而不是互抢。
    cardInnerBorder: 'border-slate-800/60',
    accentColor: 'indigo-500',
    accentBg: 'bg-indigo-600 hover:bg-indigo-500',
    accentFg: 'text-white',
    accentText: 'text-indigo-400',
    accentRing: 'ring-indigo-400',
    accentHex: '#818cf8',
    selectionBg: 'selection:bg-indigo-500/30',
    accentBorder: 'border-indigo-400',
    accentFocusBorder: 'focus:border-indigo-400',
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
    cardBg: 'bg-gradient-to-b from-[#19191d] to-[#101012]',
    cardBorder: 'border-zinc-800',
    cardInnerBg: 'bg-[#08080a]',
    // 同 midnight：border-zinc-850 不存在，会回退成纯白描边。
    // 比外层 cardBorder（zinc-800）更淡。
    cardInnerBorder: 'border-zinc-800/60',
    accentColor: 'indigo-500',
    accentBg: 'bg-zinc-800 hover:bg-zinc-700',
    accentFg: 'text-white',
    accentText: 'text-zinc-200',
    accentRing: 'ring-zinc-500',
    accentHex: '#d4d4d8',
    selectionBg: 'selection:bg-zinc-500/30',
    accentBorder: 'border-zinc-500',
    accentFocusBorder: 'focus:border-zinc-400',
    navBg: 'bg-[#000000]',
    navBorder: 'border-zinc-800',
    navActiveBg: 'bg-zinc-800/80',
    navActiveText: 'text-white',
    navInactiveText: 'text-zinc-400',
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
    cardBg: 'bg-gradient-to-b from-[#2d2117] to-[#221911]',
    cardBorder: 'border-amber-900/60',
    cardInnerBg: 'bg-[#2b1f13]',
    cardInnerBorder: 'border-amber-900/70',
    accentColor: 'amber-500',
    accentBg: 'bg-amber-600 hover:bg-amber-500',
    accentFg: 'text-slate-950',
    accentText: 'text-amber-300',
    accentRing: 'ring-amber-400',
    accentHex: '#fcd34d',
    selectionBg: 'selection:bg-amber-500/30',
    accentBorder: 'border-amber-400',
    accentFocusBorder: 'focus:border-amber-300',
    navBg: 'bg-[#1f1610]',
    navBorder: 'border-amber-950',
    navActiveBg: 'bg-amber-600/30',
    navActiveText: 'text-amber-300',
    navInactiveText: 'text-amber-200/90',
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
    cardBg: 'bg-gradient-to-b from-[#102b46] to-[#0a1d31]',
    cardBorder: 'border-cyan-900/60',
    cardInnerBg: 'bg-[#102a42]',
    cardInnerBorder: 'border-cyan-900/70',
    accentColor: 'cyan-400',
    accentBg: 'bg-cyan-600 hover:bg-cyan-500',
    accentFg: 'text-slate-950',
    accentText: 'text-cyan-300',
    accentRing: 'ring-cyan-400',
    accentHex: '#67e8f9',
    selectionBg: 'selection:bg-cyan-500/30',
    accentBorder: 'border-cyan-400',
    accentFocusBorder: 'focus:border-cyan-300',
    navBg: 'bg-[#07192b]',
    navBorder: 'border-cyan-950',
    navActiveBg: 'bg-cyan-600/30',
    navActiveText: 'text-cyan-300',
    navInactiveText: 'text-cyan-200/90',
    dot: 'bg-cyan-400',
  },
};
