/**
 * 校验睡眠分期配色是否真的可分辨。
 *
 * 为什么需要这个：深睡和 REM 同属紫蓝家族时，正常视觉下勉强能分，
 * 但红绿色盲下会直接糊成一个颜色。实测旧配色（泳道图）在绿色盲下
 * 四阶段两两最小 ΔE00 只有 7.2；趋势页那套更糟——红色盲下浅睡与 REM
 * 的 ΔE 是 0.7，等于完全分不出来。而这两种情况在正常视觉下都不明显。
 *
 * 所以配色不能靠眼睛挑，要按色差算。本工具用 CIEDE2000 计算四阶段两两
 * 色差，并模拟绿色盲(deutan)与红色盲(protan)（Viénot/Brettel 在 LMS
 * 空间的投影），要求三种视觉下的最小值都过阈值。
 *
 * 经验阈值：ΔE00 ≥ 10 可分辨，≥ 20 清晰，< 5 基本分不出。
 */
import { SLEEP_STAGE_COLORS } from '../src/utils/sleepStageColors.js';

type RGB = [number, number, number];

const THRESHOLD = 20;

const hex2rgb = (h: string): RGB => {
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
};
const srgb2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin2srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const mul = (m: number[][], v: number[]) => m.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));

const RGB2LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
];
const LMS2RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
];
const PROTAN = [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]];
const DEUTAN = [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]];

const simulate = (hex: string, kind: 'protan' | 'deutan' | null): RGB => {
  if (!kind) return hex2rgb(hex);
  const lms = mul(RGB2LMS, hex2rgb(hex).map(srgb2lin));
  const out = mul(LMS2RGB, mul(kind === 'protan' ? PROTAN : DEUTAN, lms)).map((c) =>
    clamp(lin2srgb(clamp(c)))
  );
  return [out[0], out[1], out[2]];
};

const rgb2lab = (rgb: RGB): RGB => {
  const [r, g, b] = rgb.map(srgb2lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};

const de2000 = (a: RGB, b: RGB): number => {
  const [L1, a1, b1] = rgb2lab(a);
  const [L2, a2, b2] = rgb2lab(b);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (x: number, y: number) => {
    const h = (Math.atan2(y, x) * 180) / Math.PI;
    return h >= 0 ? h : h + 360;
  };
  const hp1 = Cp1 === 0 ? 0 : hp(ap1, b1);
  const hp2 = Cp2 === 0 ? 0 : hp(ap2, b2);
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * Math.PI) / 360);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (Cp1 + Cp2) / 2;
  let hbp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbp += hbp < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin((2 * dTh * Math.PI) / 180) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh)
  );
};

const STAGES = ['deep', 'light', 'rem', 'awake'] as const;
const KINDS = [null, 'deutan', 'protan'] as const;
const kindLabel = (k: (typeof KINDS)[number]) =>
  k === null ? '正常视觉' : k === 'deutan' ? '绿色盲' : '红色盲';

const failures: string[] = [];
let pass = 0;

console.log('\n四阶段配色（来源 utils/sleepStageColors.ts）');
for (const s of STAGES) {
  console.log(`  ${SLEEP_STAGE_COLORS[s].label.padEnd(4)} ${SLEEP_STAGE_COLORS[s].hex}  ${SLEEP_STAGE_COLORS[s].className}`);
}

// 深睡必须比浅睡暗，否则「深」这个字在视觉上不成立
const L = (hex: string) => rgb2lab(hex2rgb(hex))[0];
const deepL = L(SLEEP_STAGE_COLORS.deep.hex);
const lightL = L(SLEEP_STAGE_COLORS.light.hex);
if (deepL < lightL) {
  pass++;
  console.log(`\n✅ 深睡比浅睡暗（L* ${deepL.toFixed(0)} < ${lightL.toFixed(0)}）`);
} else {
  failures.push(`深睡的明度 L*=${deepL.toFixed(0)} 不低于浅睡 L*=${lightL.toFixed(0)}：「深睡」应当读起来更深`);
}

console.log(`\n两两色差（阈值 ΔE00 ≥ ${THRESHOLD}）：`);
for (const k of KINDS) {
  const pairs: string[] = [];
  let min = Infinity;
  let worst = '';
  for (let i = 0; i < STAGES.length; i++) {
    for (let j = i + 1; j < STAGES.length; j++) {
      const d = de2000(
        simulate(SLEEP_STAGE_COLORS[STAGES[i]].hex, k),
        simulate(SLEEP_STAGE_COLORS[STAGES[j]].hex, k)
      );
      pairs.push(`${SLEEP_STAGE_COLORS[STAGES[i]].label}/${SLEEP_STAGE_COLORS[STAGES[j]].label}=${d.toFixed(1)}`);
      if (d < min) {
        min = d;
        worst = `${SLEEP_STAGE_COLORS[STAGES[i]].label}/${SLEEP_STAGE_COLORS[STAGES[j]].label}`;
      }
    }
  }
  const ok = min >= THRESHOLD;
  if (ok) pass++;
  else {
    failures.push(
      `${kindLabel(k)}下最难分的是 ${worst}，ΔE00=${min.toFixed(1)} < ${THRESHOLD}`
    );
  }
  console.log(`  ${ok ? '✅' : '❌'} ${kindLabel(k).padEnd(6)} ${pairs.join('  ')}`);
}

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 分期配色可分辨性通过（${pass} 项）`);
} else {
  console.log(`❌ ${failures.length} 项不达标：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  console.log(
    '\n提示：二色觉下只剩「明度」和「蓝-黄」两条轴，把 REM 改成紫色这类\n' +
      '只动色相的做法会让它与浅睡在绿色盲下更接近。要分开必须拉开明度差。'
  );
  process.exit(1);
}
