import React from 'react';
import { Info } from 'lucide-react';
import type { ThemeConfig } from '../utils/themeStyles';

/**
 * 折叠起来的「口径说明」。
 *
 * 起因：我把工程论证直接写进了界面——比如 SRI 那一段
 * 「24 小时前后处于同一睡/醒状态的概率（Phillips 等，2017），按自报卧床区间估算，
 * 参考区间取自 6 万人加速度计队列的中位数 81（Windred 等，2024）……」
 * 一段 90 多字。这类内容有两个问题：
 *
 *   1. 它属于**方法学披露**，不是用户打开 App 想看的东西。默认视图里出现长段落，
 *      卡片立刻显得拥挤，主要数字（87.5）反而被淹没。
 *   2. 但它又不能删。删掉用户就会拿自报数值去跟加速度计队列比，得出错误结论。
 *
 * 所以用「默认收起、一点即开」来同时满足两边：默认视图只剩数字和一句话，
 * 想深究的人一层就能拿到完整口径。
 *
 * 实现上用原生 <details>/<summary> 而不是自己写 useState：
 *   - 内容**始终在 DOM 里**，SSR 输出包含它，于是断言仍能覆盖「这段话没被删掉」；
 *     如果用条件渲染，收起来时内容就不在 HTML 里，断言会失效，
 *     等于把诚实性交给一个没人测的分支。
 *   - 键盘可达、屏幕阅读器可读，都是浏览器原生行为，不用自己补。
 *   - 不引入状态，卡片不会因为展开而重渲染整页。
 */
export const InfoNote: React.FC<{
  theme?: ThemeConfig;
  children: React.ReactNode;
  /** 收起时显示的提示词。默认「口径」两个字符，尽量不占地方。 */
  summary?: string;
}> = ({ theme, children, summary = '口径' }) => (
  <details className="group">
    <summary
      className={`list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex items-center gap-1
        text-[11px] ${theme?.textMuted || 'text-slate-400'} hover:text-white/70 transition-colors select-none`}
    >
      <Info className="w-3.5 h-3.5 shrink-0" />
      <span className="group-open:hidden">{summary}</span>
      <span className="hidden group-open:inline">收起</span>
    </summary>
    <p className={`mt-2 text-xs ${theme?.textMuted || 'text-slate-400'} leading-relaxed`}>{children}</p>
  </details>
);
