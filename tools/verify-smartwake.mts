/**
 * 智能唤醒算法层：穷举验证。
 *
 * 这一层是「智能唤醒」里**唯一可验证的部分**——原生采样那段写不出来也测不了
 * （本仓库没有 android/ 工程）。所以这里必须查得比一般代码更狠：
 * 窗口边界、去抖、兜底，全部穷举。
 *
 * 最重要的一条性质：**智能唤醒只许提前，不许变成「闹钟有时候不响」**。
 * 找不到合适时机时必须退回目标时刻，而不是「再等等」。
 */
import {
  decideWake,
  smoothActivity,
  classifyLevel,
  firstRunStart,
  isNotStill,
  EPOCH_MS,
  DEFAULT_SMART_WAKE,
  SMART_WAKE_DISCLOSURE,
} from '../src/utils/smartWake.js';
import type { ActivitySample, SmartWakeConfig } from '../src/utils/smartWake.js';

let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ───────────────────────── 合成数据工具
const TARGET = 1_700_000_000_000; // 任意固定基准时刻

/** 用「每分钟一个数」造样本，起点为 `targetAt - count*EPOCH_MS`。 */
function series(counts: number[], targetAt = TARGET): ActivitySample[] {
  const start = targetAt - counts.length * EPOCH_MS;
  return counts.map((c, i) => ({ t: start + i * EPOCH_MS, count: c }));
}

const base = (over: Partial<SmartWakeConfig> = {}): SmartWakeConfig => ({
  targetAt: TARGET,
  windowMs: 30 * EPOCH_MS,
  ...DEFAULT_SMART_WAKE,
  ...over,
});

// 三档的典型活动量（阈值 stillMax 20 / lightMax 120）
const STILL = 5;
const LIGHT = 60;
const AWAKE = 300;

// ═══════════════════ 1. 平滑
{
  // 以 i 结尾的最近 n 项均值
  const s = series([0, 0, 0, 0, 100], TARGET);
  const m = smoothActivity(s, 5);
  check('平滑：第 5 项 = 最近 5 项均值', m[4] === 20, String(m[4]));
  check('平滑：前几项用已有样本数当分母', m[0] === 0 && m[1] === 0, `${m[0]},${m[1]}`);
  check('平滑：长度与输入一致', m.length === 5, String(m.length));
  check('平滑：n=1 时等于原值', smoothActivity(s, 1)[4] === 100, '');
  check('平滑：n 大于样本数也不崩', smoothActivity(series([10], TARGET), 99)[0] === 10, '');
  check('平滑：空输入返回空', smoothActivity([], 5).length === 0, '');

  // 单侧平均：最后一个样本一定会影响最后一个结果（不做中心平均=不预知未来）
  const a = smoothActivity(series([0, 0, 0, 0, 0], TARGET), 5);
  const b = smoothActivity(series([0, 0, 0, 0, 500], TARGET), 5);
  check('平滑是单侧（不预知未来）：最后一个样本只影响最后一项',
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] !== b[4],
    `${a.join(',')} vs ${b.join(',')}`);
}

// ═══════════════════ 2. 分档（边界闭区间）
{
  const cfg = base();
  const lv = classifyLevel([0, 20, 21, 120, 121, 1000], cfg);
  check('分档：≤stillMax 算安静', lv[0] === 'still' && lv[1] === 'still', lv.join(','));
  check('分档：刚超过 stillMax 算有动静', lv[2] === 'light', lv.join(','));
  check('分档：≤lightMax 算有动静', lv[3] === 'light', lv.join(','));
  check('分档：超过 lightMax 算在动', lv[4] === 'awake' && lv[5] === 'awake', lv.join(','));
  check('分档：负值也归安静（不崩）', classifyLevel([-5], cfg)[0] === 'still', '');
}

// ═══════════════════ 3. 运行段查找
{
  // 注意：不能用单字符缩写——`isNotStill` 比较的是完整档位名 `'still'`，
  // 传 `'s'` 进去会被判成「不安静」（`'s' !== 'still'` 为真），五个断言全错。
  // 这个坑是反向验证抓出来的：断言报错信息里显示的下标是 0，而不是没匹配。
  const L = (xs: string) =>
    xs.split('').map((c) => (c === 's' ? 'still' : c === 'l' ? 'light' : 'awake')) as any[];
  check('运行段：取起点不是终点',
    firstRunStart(L('sslls'), 2, isNotStill) === 2, String(firstRunStart(L('sslls'), 2, isNotStill)));
  check('运行段：不够长返回 null',
    firstRunStart(L('s l s'.replace(/ /g, '')), 2, isNotStill) === null, '');
  check('运行段：awake 也算「不安静」',
    firstRunStart(L('saals'), 2, isNotStill) === 1, String(firstRunStart(L('saals'), 2, isNotStill)));
  check('运行段：从 from 之后开始找',
    firstRunStart(L('llssll'), 2, isNotStill, 3) === 4, String(firstRunStart(L('llssll'), 2, isNotStill, 3)));
  check('运行段：minRun 传 0 也当作 1（不返回非法下标）',
    firstRunStart(L('sll'), 0, isNotStill) === 1, String(firstRunStart(L('sll'), 0, isNotStill)));
}

// ═══════════════════ 4. ★ 穷举不变量：只许提前，且不早于窗口
{
  let n = 0, viol = 0, detail = '';
  const windowChoices = [0, EPOCH_MS, 10 * EPOCH_MS, 30 * EPOCH_MS];
  // 用 0/1 的二进制模式穷举长度 1..8 的所有「安静/在动」组合
  for (let len = 1; len <= 8; len++) {
    for (let mask = 0; mask < 1 << len; mask++) {
      const counts: number[] = [];
      for (let i = 0; i < len; i++) counts.push(mask & (1 << i) ? AWAKE : STILL);
      for (const w of windowChoices) {
        for (const mc of [1, 2, 3]) {
          const cfg = base({ windowMs: w, minConsecutiveLight: mc });
          const d = decideWake(series(counts, TARGET), cfg);
          n++;
          if (d.effectiveAt > cfg.targetAt) { viol++; detail = `推后了: ${d.effectiveAt} > ${cfg.targetAt}`; }
          if (w > 0 && d.effectiveAt < cfg.targetAt - w) {
            viol++; detail = `早于窗口: ${d.effectiveAt} < ${cfg.targetAt - w}`;
          }
        }
      }
    }
  }
  check(`穷举 ${n} 组：唤醒时刻永不晚于目标、永不早于窗口`, viol === 0, detail);
}

// ═══════════════════ 5. ★ 兜底：没有数据/没时机时必须按目标时刻叫醒
{
  check('无样本 → 目标时刻', decideWake([], base()).effectiveAt === TARGET, '');
  check('无样本 → reason=no-data', decideWake([], base()).reason === 'no-data', '');
  check('windowMs=0 → 目标时刻', decideWake(series([AWAKE, AWAKE], TARGET), base({ windowMs: 0 })).effectiveAt === TARGET, '');
  check('windowMs=0 → reason=window-disabled',
    decideWake(series([AWAKE], TARGET), base({ windowMs: 0 })).reason === 'window-disabled', '');
  check('windowMs 为负 → 目标时刻', decideWake(series([AWAKE], TARGET), base({ windowMs: -5000 })).effectiveAt === TARGET, '');

  const allStill = decideWake(series(Array(30).fill(STILL), TARGET), base());
  check('全程安静 → 目标时刻（不提前把人叫醒）', allStill.effectiveAt === TARGET, String(allStill.effectiveAt));
  check('全程安静 → reason=no-light-in-window', allStill.reason === 'no-light-in-window', allStill.reason);

  // 样本全在窗口之外
  const outside = [{ t: TARGET - 60 * EPOCH_MS, count: AWAKE }];
  const d = decideWake(outside, base({ windowMs: 10 * EPOCH_MS }));
  check('样本全在窗口外 → 目标时刻', d.effectiveAt === TARGET, String(d.effectiveAt));
  check('样本全在窗口外 → reason=window-empty', d.reason === 'window-empty', d.reason);
}

// ═══════════════════ 6. ★ 窗口边界：窗口外的一记大动作绝不能触发提前唤醒
{
  // 窗口是最后 10 个 epoch。前 20 个 epoch 全是「在动」，最后 10 个全安静。
  const counts = [...Array(20).fill(AWAKE), ...Array(10).fill(STILL)];
  const cfg = base({ windowMs: 10 * EPOCH_MS, smoothEpochs: 1 });
  const d = decideWake(series(counts, TARGET), cfg);
  check('窗口外的剧烈活动不触发提前唤醒', d.effectiveAt === TARGET, String(d.effectiveAt));

  // 反向：把同样的活动挪进窗口，就应该触发
  const counts2 = [...Array(20).fill(STILL), ...Array(10).fill(AWAKE)];
  const d2 = decideWake(series(counts2, TARGET), cfg);
  check('同样的活动放进窗口就会触发（证明上一条不是空跑）',
    d2.effectiveAt === TARGET - 10 * EPOCH_MS, String(d2.effectiveAt));
}

// ═══════════════════ 6b. ★「有动静」这一档：介于安静与在动之间
// 原来的用例只造了 STILL 和 AWAKE，于是「light 会不会被误判成安静」从来没被验证过——
// 而 light 恰恰是设计上最主要的触发档。
{
  const cfg = base({ windowMs: 6 * EPOCH_MS, smoothEpochs: 1, minConsecutiveLight: 2 });
  const d = decideWake(series([STILL, STILL, LIGHT, LIGHT, STILL, STILL], TARGET), cfg);
  check('「有动静」档能触发唤醒（它是最主要的触发档）',
    d.effectiveAt === TARGET - 4 * EPOCH_MS, String(d.effectiveAt));
  check('「有动静」的触发理由是 found-light', d.reason === 'found-light', d.reason);

  const d1 = decideWake(series([STILL, STILL, LIGHT, STILL, STILL, STILL], TARGET), cfg);
  check('单个「有动静」样本不触发（去抖对 light 同样生效）',
    d1.effectiveAt === TARGET, String(d1.effectiveAt));

  const levels = classifyLevel([STILL, LIGHT, AWAKE], cfg);
  check('light 不被归为安静', levels[1] === 'light', levels.join(','));
  check('三档互不相同', new Set(levels).size === 3, levels.join(','));

  // 平滑会把「有动静」拉向相邻的安静——这是设计意图（压掉单点噪声），
  // 但也意味着阈值必须按**平滑后**的值标定。钉住这个耦合。
  const sm = smoothActivity(series([STILL, STILL, LIGHT, STILL, STILL], TARGET), 5);
  check('平滑后「有动静」被相邻安静拉低（阈值要按平滑后的值标定）',
    sm[2]! < LIGHT && sm[2]! > STILL, String(sm[2]));
}

// ═══════════════════ 7. 触发点：运行段的起点
{
  // 窗口 5 个 epoch：静 静 动 动 动 → 应停在「动」的第一个（下标 2）
  const cfg = base({ windowMs: 5 * EPOCH_MS, smoothEpochs: 1, minConsecutiveLight: 2 });
  const d = decideWake(series([STILL, STILL, AWAKE, AWAKE, AWAKE], TARGET), cfg);
  check('在运行段起点触发，不是在终点',
    d.fireAt === TARGET - 3 * EPOCH_MS, `${d.fireAt} vs ${TARGET - 3 * EPOCH_MS}`);
  check('reason=found-light', d.reason === 'found-light', d.reason);
}

// ═══════════════════ 8. 去抖：单点噪声不该把人叫醒
{
  const cfg = base({ windowMs: 6 * EPOCH_MS, smoothEpochs: 1, minConsecutiveLight: 2 });
  const d1 = decideWake(series([STILL, STILL, AWAKE, STILL, STILL, STILL], TARGET), cfg);
  check('单个孤立样本不触发（去抖生效）', d1.effectiveAt === TARGET, String(d1.effectiveAt));

  const d2 = decideWake(series([STILL, STILL, AWAKE, AWAKE, STILL, STILL], TARGET), cfg);
  check('连续两个样本才触发（证明去抖阈值是 2）',
    d2.effectiveAt === TARGET - 4 * EPOCH_MS, String(d2.effectiveAt));
}

// ═══════════════════ 9. 输入乱序 / 重复时间戳也要稳住
{
  const ordered = series([STILL, STILL, AWAKE, AWAKE], TARGET);
  const shuffled = [ordered[2]!, ordered[0]!, ordered[3]!, ordered[1]!];
  const cfg = base({ windowMs: 4 * EPOCH_MS, smoothEpochs: 1, minConsecutiveLight: 2 });
  check('乱序输入结果与有序一致',
    decideWake(shuffled, cfg).effectiveAt === decideWake(ordered, cfg).effectiveAt,
    `${decideWake(shuffled, cfg).effectiveAt} vs ${decideWake(ordered, cfg).effectiveAt}`);
}

// ═══════════════════ 10. 声明文案必须自带限制，且不许用分期术语
{
  check('披露文案说明了只测活动、分不出浅睡深睡',
    /测不到脑电|分不出浅睡和深睡/.test(SMART_WAKE_DISCLOSURE.full), SMART_WAKE_DISCLOSURE.full.slice(0, 60));
  check('披露文案说明了找不到就按原时间叫醒',
    /找不到合适时机/.test(SMART_WAKE_DISCLOSURE.full), '');
  check('披露文案不含「深睡占比」「临床」这类它给不出的说法',
    !/临床|占比/.test(SMART_WAKE_DISCLOSURE.full + SMART_WAKE_DISCLOSURE.short), '');
  check('短说明写明了运行前提', SMART_WAKE_DISCLOSURE.short.length > 0, '');
  check('短说明不空口承诺准确率', !/准确|精准|保证/.test(SMART_WAKE_DISCLOSURE.short), SMART_WAKE_DISCLOSURE.short);
}

// ═══════════════════ 11. epoch 长度是这套阈值的隐含前提
{
  check('EPOCH_MS 是 1 分钟（阈值按此标定）', EPOCH_MS === 60_000, String(EPOCH_MS));
  check('默认平滑窗口 ≥ 1', DEFAULT_SMART_WAKE.smoothEpochs >= 1, '');
  check('默认阈值有序 stillMax < lightMax',
    DEFAULT_SMART_WAKE.stillMax < DEFAULT_SMART_WAKE.lightMax, '');
}

// ═══════════════════ 汇总
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ 智能唤醒算法层全部通过（${pass} 项断言）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
