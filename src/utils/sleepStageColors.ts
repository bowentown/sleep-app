import { SleepStage } from '../types/sleep';

/**
 * 睡眠分期的唯一配色来源。
 *
 * 为什么要单独抽出来：这些颜色原先分散在 SleepHypnogram（写死 hex）和
 * TrendsTab（用 Tailwind 类，且「深睡」用的是主题色 theme.accentHex）里。
 * 结果是同一个阶段在两个页面上颜色不同——实测四个主题下 TrendsTab 的深睡
 * 分别是 #818cf8 / #d4d4d8（浅灰）/ #fcd34d（黄）/ #67e8f9（青），
 * 而泳道图永远用 #6366f1。其中「静谧深海」主题下深睡的青和浅睡的 sky-400
 * 几乎分不出来；午夜主题下 TrendsTab 的深睡 #818cf8 又正好等于泳道图的 REM 色。
 *
 * 这四段是数据的编码，不是界面的装饰，所以不应该跟随主题换色：
 * 主题色变了会让「哪个颜色代表深睡」失去稳定含义。
 *
 * 配色是算出来的，不是挑出来的。取「四阶段两两 CIEDE2000 色差」在
 * 正常 / 绿色盲(deutan) / 红色盲(protan) 三种视觉下的最小值，在 Tailwind
 * 调色板里做约束搜索（约束：深睡明度必须低于浅睡，且都足够在深色底上可见）：
 *
 *              正常    绿色盲   红色盲
 *   旧配色      11.9     7.2     11.1     ← 泳道图；二色觉下已接近难辨
 *   旧·趋势页    11.3     4.3      0.7     ← 红色盲下浅睡与 REM 几乎完全相同
 *   本配色      31.7    25.8     24.4
 *
 * 经验阈值：ΔE00 ≥ 10 可分辨，≥ 20 清晰，< 5 基本分不出。
 *
 * 注意「深睡」是此处唯一的深蓝，别因为好看把 REM 或醒来的颜色往蓝紫方向挪：
 * 二色觉下只剩明度和蓝-黄两条轴，把 REM 改成紫色会让它与浅睡在绿色盲下
 * 的色差从 7.2 掉到 1.7（实测）。要分开它们必须靠明度差，不是色相差。
 *
 * 已知取舍：「清醒」只能用暖色——REM 的品红与原本的 rose 清醒在绿色盲下
 * 只差 ΔE00 13.7，是整套配色的瓶颈，所以清醒取橙。副作用是「琥珀暖夜」
 * 主题的主色也是橙色，两者观感接近；但一个用于界面控件、一个用于数据分段，
 * 语境不同，不影响读图。
 */
export const SLEEP_STAGE_COLORS: Record<SleepStage, { hex: string; className: string; label: string }> = {
  deep: { hex: '#4f46e5', className: 'bg-indigo-600', label: '深睡' },
  light: { hex: '#38bdf8', className: 'bg-sky-400', label: '浅睡' },
  rem: { hex: '#db2777', className: 'bg-pink-600', label: 'REM' },
  awake: { hex: '#fdba74', className: 'bg-orange-300', label: '清醒' },
};
