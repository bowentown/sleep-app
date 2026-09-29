/**
 * 弹窗的键盘与读屏支持，**单一来源**。
 *
 * 背景：把整个 `src/` 搜一遍会发现三处空白——
 *   • `Escape` 出现 0 次：**没有任何弹窗能用键盘关掉**；
 *   • 没有 `.focus()` / `autoFocus`：**焦点从不进入弹窗**，
 *     于是键盘用户 Tab 一遍还在背景内容里游走（背景被遮住了却仍能聚焦）；
 *   • `role="dialog"` 只加在 2 个弹窗上，而且**都没有可访问名称**，
 *     读屏只会念「对话框」，不说是哪一个。
 *
 * 为什么抽出来：四个弹窗各写一遍必然会分叉——
 * 本项目的「睡前习惯」缺陷就是这么产生的（两个入口各存一份选项，其中一份没有 UI）。
 *
 * 为什么不用 `inert`：需要给背景容器加属性，而背景是 `App.tsx` 的兄弟节点，
 * 从弹窗内部改不到；焦点环路用 `Tab` 拦截等价且不侵入外部结构。
 */
import { useEffect, useRef, type RefObject } from 'react';

/** 可聚焦元素。与 WAI-ARIA 对话框实践一致的常见集合。 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  /** 读屏读出的对话框名称。必须是能说明「这是哪个弹窗」的具体词。 */
  label: string;
  /**
   * `Escape` 是否关闭。默认 `true`。
   *
   * ★ 睡眠会话那个弹窗要显式传 `false`：
   * 它代表一段**正在进行、尚未保存的睡眠记录**，
   * 误按 Escape 会直接把这一段丢掉，而它不像表单那样可以重新填。
   * 那里有关闭按钮（且已加 `aria-label`），键盘用户仍然出得去。
   */
  closeOnEscape?: boolean;
}

export interface ModalA11y {
  ref: RefObject<HTMLDivElement | null>;
  dialogProps: {
    role: 'dialog';
    'aria-modal': true;
    'aria-label': string;
    tabIndex: number;
  };
}

export function useModalA11y({ isOpen, onClose, label, closeOnEscape = true }: ModalA11yOptions): ModalA11y {
  const ref = useRef<HTMLDivElement | null>(null);

  // 关闭时把焦点还给打开弹窗之前那个元素，否则焦点会掉到 <body>，
  // 键盘用户要重新 Tab 一遍才能回到原来的位置。
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const root = ref.current;
    if (!root) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    // 焦点进入弹窗。容器自己带 tabIndex=-1，所以一定能聚焦。
    root.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      // 焦点环路：`aria-modal="true"` 承诺了「背景不可交互」，
      // 所以 Tab 不能跑到弹窗外面去。
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const prev = restoreRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
    };
  }, [isOpen, onClose, closeOnEscape]);

  return {
    ref,
    dialogProps: { role: 'dialog', 'aria-modal': true, 'aria-label': label, tabIndex: -1 },
  };
}
