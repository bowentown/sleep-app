/**
 * 大肥鱼桌宠的表情贴图目录。
 *
 * 素材取自 blue-fish-archive（蓝色大肥鱼档案馆，205 张鲸鱼娘同人表情），
 * 署名链与使用限制见 `plugins/cap-gemma-llm/android/src/main/assets/pet/stickers/NOTICE.md`。
 *
 * ★ 为什么不是 205 张全带上：
 * 那 205 张原图合计约 **29 MB**（平均 141 KB，最大 3.2 MB）。全部塞进 APK
 * 会让安装包无谓地涨几十兆，而气泡一次只显示一张。所以这里只取 **8 张**、
 * 缩到 300px、WebP q82，合计约 **154 KB**，并按"用途"归类——
 * 这是权衡后的选择，不是遗漏；NOTICE 里逐张写了来源索引，可回溯。
 *
 * ★ 贴图与文案的关系：
 * 贴图是**装饰**，语义由捎报词那条文本承担。所以分类只按"情绪/时段"粗分，
 * 不追求图文精确对应——硬凑会变成看图说话，反而更假。
 */
import type { PetMood, PetPhase } from './petOverlay';

/** 一张贴图。`file` 是不带扩展名的文件名，原生按这个名字去 assets 取图。 */
export interface PetSticker {
  /** 文件标识，须满足 `[a-z0-9_-]+`（原生侧会做同样的白名单校验，防路径穿越）。 */
  file: string;
  /** 给人看的中文名，用于设置页预览的替代文本。 */
  label: string;
  /** 原始档案馆里的条目序号，用于回溯（NOTICE 里逐张对应）。 */
  sourceIndex: number;
  /** 适合哪些情绪/时段；`always` 表示默认问候。 */
  use: 'always' | 'sleepy' | 'happy' | 'low' | 'alert' | 'day';
}

/**
 * 目录。顺序即优先级，`pickSticker` 按这个顺序找第一个命中的。
 *
 * 每张的 `use` 都对应一个**真实存在**的状态来源：
 *   sleepy ← 时段 night / noon
 *   happy  ← 情绪 good
 *   low    ← 情绪 low
 *   alert  ← 提醒（就寝到点）
 *   day    ← 时段 day / afternoon / dusk
 *   always ← 兜底
 */
export const PET_STICKERS: PetSticker[] = [
  { file: 'deepsleep', label: '趴睡的大肥鱼',  sourceIndex: 41,  use: 'sleepy' },
  { file: 'happy',     label: '比耶的大肥鱼',  sourceIndex: 190, use: 'happy'  },
  { file: 'tsundere',  label: '嘴硬的大肥鱼',  sourceIndex: 95,  use: 'low'    },
  { file: 'surprised', label: '瞪眼的大肥鱼',  sourceIndex: 54,  use: 'alert'  },
  { file: 'study',     label: '上课的大肥鱼',  sourceIndex: 0,   use: 'day'    },
  { file: 'shopping',  label: '扫货的大肥鱼',  sourceIndex: 163, use: 'day'    },
  { file: 'rice',      label: '白饭大肥鱼',    sourceIndex: 136, use: 'always' },
  { file: 'hello',     label: '打招呼的大肥鱼', sourceIndex: 204, use: 'always' },
];

/** 文件名的合法字符集，与原生 `loadSticker` 的白名单保持一致。 */
export const STICKER_FILE_RE = /^[a-z0-9_-]+$/;

/**
 * 按当前时段与情绪挑一张贴图。
 *
 * 优先级：情绪 > 时段 > 兜底。情绪优先是因为"昨晚睡得好不好"比"现在几点"
 * 更值得被看见。
 */
export function pickSticker(
  phase: PetPhase,
  mood: PetMood,
  /** 是否处于"就寝到点"提醒中；true 时优先用 alert 那张。 */
  alerting = false,
): PetSticker {
  const find = (u: PetSticker['use']) => PET_STICKERS.find((s) => s.use === u);
  if (alerting) {
    const a = find('alert');
    if (a) return a;
  }
  if (mood === 'good') {
    const h = find('happy');
    if (h) return h;
  }
  if (mood === 'low') {
    const l = find('low');
    if (l) return l;
  }
  if (phase === 'night' || phase === 'noon') {
    const s = find('sleepy');
    if (s) return s;
  }
  if (phase === 'day' || phase === 'afternoon' || phase === 'dusk') {
    const d = find('day');
    if (d) return d;
  }
  const always = find('always');
  if (always) return always;
  // 目录被清空时的兜底：仍然返回一个合法结构，避免调用方拿到 undefined
  return { file: 'hello', label: '大肥鱼', sourceIndex: 204, use: 'always' };
}

/** 贴图在 Web 侧的静态路径（`public/pet-stickers/`，与原生 assets 是同一批字节）。 */
export function stickerUrl(file: string): string {
  return `pet-stickers/${file}.webp`;
}
