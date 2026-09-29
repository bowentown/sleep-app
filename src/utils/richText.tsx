/**
 * 极简富文本：把 `**粗体**` 渲染成 <strong>。
 *
 * 起因：项目里有 **79 处**用户可见文案写了 Markdown 粗体（`sleepFindings.ts` 67 处、
 * `clinicalSleepEngine.ts` 12 处），但 JSX **不解析 Markdown**——它把这些星号当普通字符，
 * 于是用户看到的是字面的 `**`。
 *
 * 最严重的一处是危机求助文案：
 *
 *     ❤️ **请珍重您的生命，您并不孤单！**
 *     • **全国希望24小时生命求助热线**：400-161-9995
 *
 * 这段是**纯文本渲染**进聊天气泡的（`AIAdvicePanel` 里就是 `{msg.content}` 一个文本节点），
 * 所以在用户最需要它的时候，它带着星号出现。
 *
 * 为什么在渲染层修，而不是逐条删掉 `**`：
 *
 *   - 这些字符串**同时**被用作 LLM 提示词（那里 Markdown 是合适的），
 *     删掉会同时削掉两个用途的表达力；
 *   - 79 处逐条改，改漏一处不会有任何提示——正是这个项目反复吃亏的模式；
 *   - 强调本身是有用的：`**这是变化，不是常态**` 的重点就在那几个字上。
 *
 * 这个坑在这个项目里踩过三次（闹钟徽标、AI 设置弹窗、危机文案），
 * 前两次都是「看到截图才发现」。所以这次修在唯一能一次覆盖全部的位置。
 */
import type { ReactNode } from 'react';

/**
 * 把文本里成对的 `**…**` 转成 <strong>，其余部分原样返回。
 *
 * 有意保持极简：
 *   - 只支持粗体一种标记，不支持标题/列表/链接——需求就只有粗体；
 *   - 不解析不成对的 `**`（原样输出），避免把 `2**10` 这种内容吃掉；
 *   - 不注入 HTML（不用 dangerouslySetInnerHTML），返回 React 节点，没有 XSS 面。
 */
export function renderEmphasis(text: string): ReactNode {
  if (!text || !text.includes('**')) return text;

  // ★ 边界规则是必须的，不是洁癖。第一版用 /(\*\*[^*]+\*\*)/g，
  // 在 `2**10 与 **未闭合` 上把 `**10 与 **` 整段吞成了粗体——
  // 把不属于标记的内容静默改格式。
  //   - 开标记前面不能是字母/数字：避免把 `2**10` 当成粗体开始
  //   - 闭标记后面不能是字母/数字
  //   - 标记内不能为空、首尾不能是空白
  const BOLD = /(?<![\w*])\*\*(?=[^*\s])([^*\n]+?)(?<=[^*\s])\*\*(?![\w*])/g;

  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(BOLD)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <strong key={key++} className="font-bold">
        {m[1]}
      </strong>
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length > 0 ? out : text;
}
