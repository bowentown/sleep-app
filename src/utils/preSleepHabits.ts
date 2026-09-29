/**
 * 睡前行为习惯：**单一来源**。
 *
 * 抽出来的原因是一个真实缺陷：两个记录入口各自维护了一份选项与默认值——
 *   • `ManualLogModal`（手动补记）：有完整的选择 UI，默认勾了「阅读 + 温水澡」
 *   • `ActiveSleepModal`（主动睡眠会话，用户主力流程）：**没有 UI**，
 *     但保存时写死 `preSleepHabits: ['hot_bath', 'reading']`
 *
 * 于是**每一晚通过主动睡眠会话记录的睡眠，都会被标上"泡了温水澡、读了书"**，
 * 而 `computeHabitFindings` 会拿这些标签做「有该习惯 vs 无该习惯」的对照，
 * 并把结论标成 `provenance: 'measured'`。
 *
 * 也就是说：**编造的习惯标签在产出标着「实测」的习惯-效果结论**，
 * 而且它对照的其实是两种**记录方式**的差异，不是习惯的差异。
 * 这与第一轮的编造深睡、第三轮被丢弃的感受属于同一类。
 *
 * 修法两条：
 *   1. 选项与切换逻辑收到这里，两个入口共用；
 *   2. **默认不勾选任何一项**——用户没说就是不知道，
 *      预勾选会让记录在用户没注意时就是错的。
 */
import { Smartphone, Coffee, Bath, Flower2, BookOpen, Dumbbell, Wine, Utensils, type LucideIcon } from 'lucide-react';

export interface HabitOption {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const HABIT_OPTIONS: HabitOption[] = [
  { id: 'screen_time', label: '睡前玩手机', icon: Smartphone },
  { id: 'caffeine', label: '下午喝咖啡/茶', icon: Coffee },
  { id: 'hot_bath', label: '睡前温水澡', icon: Bath },
  { id: 'meditation', label: '冥想/腹式呼吸', icon: Flower2 },
  { id: 'reading', label: '纸质书阅读', icon: BookOpen },
  { id: 'workout', label: '晚间运动', icon: Dumbbell },
  { id: 'alcohol', label: '睡前饮酒', icon: Wine },
  { id: 'heavy_meal', label: '夜宵饱腹', icon: Utensils },
];

/**
 * 默认值：**空数组**。
 *
 * 不要改回预勾选。`computeHabitFindings` 会拿这些标签算「有它 vs 没它」的差异，
 * 预勾选等于把「用户没勾」记成「用户做了」，直接污染结论。
 */
export const DEFAULT_HABITS: string[] = [];

/** 切换一个习惯。纯函数，两个入口共用同一份语义。 */
export function toggleHabit(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((h) => h !== id) : [...list, id];
}
