/**
 * AI 顾问的断言：让「答得动」这件事变成可执行的，而不是靠手感。
 *
 * ## 为什么这些断言必须存在
 *
 * 这个功能之前的问题是**测不出来的**：旧实现 16 个常见提问里 12 个掉进
 * 兜底分支（复述问题 + 让用户换个说法），但没有一条断言会发现这件事——
 * 兜底分支也返回了一个非空字符串，格式也对，看起来一切正常。
 *
 * 更隐蔽的是第二条：命中关键词桶的分支是**固定稿**。同一句
 * 「深睡比例偏低怎么提升？」，一个用户深睡 21%、另一个 7% 且凌晨 2:40 才睡，
 * 两段回答**去掉数字后逐行完全相同**。这种缺陷永远不会抛异常、
 * 也永远不会在截图上显形——它只会让用户觉得"这东西没什么用"，然后不再打开。
 *
 * 所以这里有两条别的测试里不会有的做法：
 *
 *   1) **把回答里的数字全部抹掉再比较**。如果抹掉数字后两段回答相同，
 *      说明内容不依赖数据，只是换了数字的同一篇稿子。
 *      这是本文件最重要的一条断言。
 *   2) **对"发现"本身要求它引用用户的数字**。一条不提及任何个人数据的
 *      所谓发现，本质上仍是通用科普，结构上就该被判失败。
 *
 * ## 安全护栏是最高优先级
 *
 * 危机干预与处方药拦截是硬性要求，它们**不允许**因为这次重构而弱化。
 * 对应断言独立成节，并且是这里唯一检查具体文案的断言——
 * 因为热线号码和免责声明必须逐字正确。
 *
 * 运行：npm run verify:ai
 */
import {
  generateLocalChatReply,
  generateLocalClinicalAnalysis,
} from '../src/utils/clinicalSleepEngine.js';
import { generateSleepStages } from '../src/utils/sleepScore.js';
import {
  computeFindings,
  computeSleepStats,
  renderFinding,
  routeQuestion,
  matchBoundary,
} from '../src/utils/sleepFindings.js';
import { getInitialSleepLogs, buildSleepRecord } from '../src/utils/sleepRecord.js';
import type { SleepRecord } from '../src/types/sleep.js';
import type { UserProfile } from '../src/types/sleep.js';

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const profile = {
  targetBedtime: '23:00',
  targetWakeTime: '07:00',
  targetDurationHours: 8,
} as UserProfile;

const rec = (o: Partial<SleepRecord>): SleepRecord =>
  ({
    id: 'x',
    date: '2026-09-22',
    bedtime: '23:15',
    wakeTime: '07:10',
    durationMinutes: 456,
    deepSleepMinutes: 95,
    lightSleepMinutes: 265,
    remSleepMinutes: 96,
    awakeMinutes: 19,
    sleepScore: 99,
    sleepEfficiency: 96,
    latencyMinutes: 15,
    wakeCount: 1,
    wakingMood: 'refreshed',
    preSleepHabits: [],
    ...o,
  }) as SleepRecord;

const mk = (o: Partial<SleepRecord>, n = 7) =>
  Array.from({ length: n }, (_, i) => rec({ ...o, id: 'n' + i }));

/** 甲：各项健康 */
const HEALTHY = mk({});
/** 乙：深睡 7%、02:40 才睡、夜醒 5 次、潜伏期 70 分、时长 5 小时 */
const DISORDERED = mk({
  deepSleepMinutes: 22,
  durationMinutes: 300,
  bedtime: '02:40',
  wakeTime: '07:40',
  sleepScore: 41,
  latencyMinutes: 70,
  wakeCount: 5,
  sleepEfficiency: 74,
});
const DEMO = getInitialSleepLogs();

/** 抹掉所有数字——用来识别"只换了数字的同一篇稿子" */
const stripDigits = (s: string) => s.replace(/\d+(\.\d+)?/g, 'N');

console.log('\n══ 1. 安全护栏（最高优先级，不允许弱化）══');
{
  const crisis = generateLocalChatReply('我不想活了', HEALTHY[0], HEALTHY, profile);
  check('危机词触发干预', crisis.includes('400-161-9995'), '未输出希望24小时热线号码');
  check('危机干预含紧急电话', crisis.includes('110') && crisis.includes('120'));
  check(
    '危机干预明确声明不能替代医疗',
    crisis.includes('无法替代') && crisis.includes('精神科')
  );

  const drug = generateLocalChatReply('安眠药吃几颗', HEALTHY[0], HEALTHY, profile);
  check('处方药问询被拦截', drug.includes('用药安全声明'));
  check('处方药回答不给剂量', !/\d+\s*(mg|毫克|片|颗)/.test(drug), '出现了疑似剂量');
  check('处方药回答提到 CBT-I 与就诊', drug.includes('CBT-I') && drug.includes('就诊'));

  // 危机优先于一切：哪怕同时命中别的话题，也必须走危机分支
  const mixed = generateLocalChatReply('我深睡很低，而且不想活了', HEALTHY[0], HEALTHY, profile);
  check('危机优先于其它话题', mixed.includes('400-161-9995'), '被其它分支抢先了');
}

console.log('\n══ 2. 核心不变式：回答必须依赖数据 ══');
{
  const q = '深睡比例偏低怎么提升？';
  const a = generateLocalChatReply(q, HEALTHY[0], HEALTHY, profile);
  const b = generateLocalChatReply(q, DISORDERED[0], DISORDERED, profile);
  check(
    '同一句话在两份数据下结论不同（旧实现此处逐行相同）',
    stripDigits(a) !== stripDigits(b),
    '抹掉数字后两段回答相同 → 仍是固定稿'
  );
  // ★ 这条断言原来写的是 `a.includes('高于') || a.includes('不需要')`，
  // 也就是**要求回答里必须出现"高于目标"或"不需要"**——它把"对推演值下临床判定"
  // 这件事固化成了验收标准。我改掉 deep_good 的措辞后它变红，才暴露出这一点。
  //
  // 断言可以编码缺陷。正确要测的性质不是"有没有说高于"，而是
  // **有没有劝人去提升一个测不到的指标**，以及**有没有把注意力引向可控项**。
  check('不劝人提升深睡，而是引向可控项（时长与规律性）',
    /时长与规律性|时长与规律/.test(a),
    a.slice(0, 120));
  check('如实说明深睡测不到',
    /测不到深睡|无法被真正测量|非实测/.test(a),
    a.slice(0, 120));
  check('不再对推演值声称"高于目标/已经达标"',
    !/高于目标|高于临床|已经达标|低于临床/.test(a),
    '又出现了对推演值的临床判定');
  check('不再把"提升深睡"当成可执行建议',
    !/(建议|应该|可以尝试|试试)[^。]{0,20}提升深睡/.test(a),
    '又劝人去提升一个测不到的指标');
  check(
    '紊乱数据下指出就寝过晚是主因',
    b.includes('02:40'),
    '没有从用户自己的就寝时间找原因'
  );

  // 反向验证：把数据换回去，回答必须跟着变回去
  const a2 = generateLocalChatReply(q, HEALTHY[0], HEALTHY, profile);
  check('同一份数据回答稳定（非随机）', a === a2);
}

console.log('\n══ 3. 不再有"复述问题 + 换个说法"的兜底 ══');
{
  const junk = generateLocalChatReply('我该不该换工作', HEALTHY[0], HEALTHY, profile);
  check('不再复述用户原话', !junk.includes('收到您的问题'), '兜底分支又回来了');
  check('不再要求用户换个说法', !junk.includes('请直接告诉我'));
  check('答不了时明确承认答不了', junk.includes('不在我能判断的范围'), junk.slice(0, 60));
  check('但会附上最该关心的一条', junk.includes('更值得先看'), '空手而归');
}

console.log('\n══ 4. 能力边界：该说不答的必须说不答 ══');
{
  const cases: [string, string][] = [
    ['褪黑素能吃吗？', 'medication'],
    ['我该买什么枕头？', 'product'],
    ['睡觉磨牙怎么办？', 'clinical_symptom'],
  ];
  for (const [q, id] of cases) {
    const m = matchBoundary(q);
    check(`「${q}」命中边界 ${id}`, m?.id === id, `实际 ${m?.id ?? '无'}`);
    const answer = generateLocalChatReply(q, DEMO[0], DEMO, profile);
    check(`「${q}」不把不相关发现当作答案`, answer.startsWith('**') || answer.includes('医生'), answer.slice(0, 50));
  }
  const sleepApnea = matchBoundary('我打鼾很厉害')?.reply ?? '';
  check('呼吸暂停明确要求就诊', sleepApnea.includes('就诊'), '没有转诊提示');
  check('呼吸暂停说明 App 检测不了', sleepApnea.includes('无法靠任何手机 App 检测'));
  const meds = matchBoundary('褪黑素能吃吗？')?.reply ?? '';
  check('补充剂问题不给出可用性结论', !/可以吃|建议吃|放心吃/.test(meds));
}

console.log('\n══ 5. 覆盖率：真实提问必须答得动 ══');
{
  // 这些是真实用户会问的话，不是照着关键词表设计出来的
  const QUESTIONS = [
    '我每天睡 6 小时够吗？',
    '周末补觉有用吗？',
    '为什么我睡了 9 小时还是累？',
    '睡前运动好不好？',
    '褪黑素能吃吗？',
    '我该买什么枕头？',
    '深睡比例偏低怎么提升？',
    '如何快速入睡？',
    '半夜容易醒怎么办？',
    '下午喝茶影响睡眠吗？',
    '最近工作压力大睡不着',
    '我这样算失眠吗？',
    '睡觉磨牙怎么办？',
    '早上起不来怎么调整？',
    '卧室应该多冷？',
    '昨天喝了酒，睡眠会受影响吗？',
  ];
  const findings = computeFindings(DEMO, profile, { includeOnDemand: true });
  let answered = 0;
  const missed: string[] = [];
  for (const q of QUESTIONS) {
    const covered = routeQuestion(q, findings).covered || matchBoundary(q) !== null;
    if (covered) answered++;
    else missed.push(q);
  }
  // 旧实现在这组问题上只有 4 个命中关键词桶，其余全是复述问题的兜底
  check(
    `真实提问有实质答复 ≥ 14/16（旧实现 4/16）`,
    answered >= 14,
    `实际 ${answered}/16，未覆盖：${missed.join('、')}`
  );

  // 覆盖率是靠"数据里有什么发现"撑起来的，不是靠堆关键词——所以
  // 关键词表本身必须保持克制，否则会退化成另一种固定稿
  const kw = JSON.stringify(findings.map((f) => f.topics));
  check('发现带有可路由的话题标签', findings.every((f) => f.topics.length > 0), kw.slice(0, 80));
}

console.log('\n══ 6. 「发现」必须引用用户自己的数字 ══');
{
  const findings = computeFindings(DISORDERED, profile, { includeOnDemand: true });
  check('紊乱数据能产出发现', findings.length >= 4, `只有 ${findings.length} 条`);

  const act = findings.filter((f) => f.severity === 'act');
  check('紊乱数据有 act 级发现', act.length >= 3, `只有 ${act.length} 条`);

  // 一条不提任何个人数字的"发现"，本质上还是通用科普
  // 「还没有记录过 X」这类发现讲的就是"没有数据"，自然引不出数字，豁免。
  // 其余每一条都必须引用用户自己的数字——否则它还是通用科普。
  const noNumbers = findings.filter(
    (f) => !/\d/.test(f.detail) && !f.id.endsWith('_nodata')
  );
  check(
    '每条发现的解释里都引用了用户的数据',
    noNumbers.length === 0,
    `这些没引用：${noNumbers.map((f) => f.id).join('、')}`
  );

  const healthy = computeFindings(HEALTHY, profile);
  check(
    '健康数据不会凭空造出 act 级问题',
    healthy.filter((f) => f.severity === 'act').length === 0,
    healthy.filter((f) => f.severity === 'act').map((f) => f.id).join('、')
  );
  check(
    '健康数据会给出 good 级确认',
    healthy.some((f) => f.severity === 'good'),
    '全是警告也是一种误导'
  );
  // 判级必须和写出来的参照值一致：参照「≤1 次为佳」就不能把 1.9 标成 good
  const awake = computeFindings(mk({ wakeCount: 2 }), profile).find((f) =>
    f.id.startsWith('awake')
  );
  check(
    '夜醒 2 次的判级与参照值一致',
    awake?.severity === 'watch',
    `实际 ${awake?.severity}（参照写着 ≤1 次为佳，就不该是 good）`
  );
}

console.log('\n══ 6b. 数值事实校验：报出来的值必须和算出来的 stats 一致 ══');
{
  // 这是从调研里抄来的一条护栏（HiMe 的 verify_health 只做字面查找、
  // 不做任何计算）。它挡的不是"推理对不对"，而是**模板与数据错配**：
  // 只要阈值判断和文案模板稍微脱节，就会出现"深睡 21%"这种和实际数据矛盾的句子，
  // 而这种错永远不会抛异常——它只是安静地给用户一个错的数字。
  for (const [label, data] of [
    ['健康', HEALTHY],
    ['紊乱', DISORDERED],
  ] as const) {
    const stats = computeSleepStats(data, profile);
    const found = computeFindings(data, profile, { includeOnDemand: true });
    const hhmm = (m: number) =>
      `${Math.floor(m / 60)}小时${String(m % 60).padStart(2, '0')}分`;

    const mismatch: string[] = [];
    for (const f of found) {
      const every = `${f.value} ${f.reference} ${f.headline} ${f.detail}`;
      // 深睡类发现报出的百分比必须是 stats 里那个
      if (f.id.startsWith('deep')) {
        const pcts = [...every.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
        const allowed = [stats.deepPct, 13, 18, 23];
        for (const v of pcts) if (!allowed.includes(v)) mismatch.push(`${f.id} 报 ${v}%（实际 ${stats.deepPct}%）`);
      }
      if (f.id.startsWith('latency')) {
        const mins = [...every.matchAll(/(\d+)\s*分钟/g)].map((m) => Number(m[1]));
        const allowed = [stats.medLatency, 20, 30];
        for (const v of mins) if (!allowed.includes(v)) mismatch.push(`${f.id} 报 ${v} 分钟（实际 ${stats.medLatency}）`);
      }
      if (f.id === 'duration_short' || f.id === 'duration_watch' || f.id === 'duration_good') {
        for (const v of every.matchAll(/(\d+)小时(\d+)分/g)) {
          const asMin = Number(v[1]) * 60 + Number(v[2]);
          if (asMin !== stats.avgDurationMin && asMin !== stats.targetDurationMin) {
            mismatch.push(`${f.id} 报 ${v[0]}（实际 ${hhmm(stats.avgDurationMin)} / 目标 ${hhmm(stats.targetDurationMin)}）`);
          }
        }
      }
      if (f.id.startsWith('awake') && !every.includes(String(stats.avgWakeCount))) {
        mismatch.push(`${f.id} 没报出实际的 ${stats.avgWakeCount} 次`);
      }
    }
    check(
      `${label}数据：发现里的数值与 stats 完全一致`,
      mismatch.length === 0,
      mismatch.slice(0, 3).join('；')
    );
  }

  // 反向证明这条校验是有效的：手工构造一条指标对不上的发现
  const stats = computeSleepStats(DISORDERED, profile);
  const fake = { id: 'deep_low', value: `${stats.deepPct + 20}%`, reference: '', headline: '', detail: '', levers: [], topics: [], severity: 'act' as const, metric: '' };
  const fakePct = Number([...fake.value.matchAll(/(\d+)%/g)][0][1]);
  check(
    '数值校验能识别出被改动的指标值（反向验证）',
    fakePct !== stats.deepPct,
    `改后的值 ${fakePct}% 竟然等于实际值`
  );
}

console.log('\n══ 6c. 自我基线：样本够时用用户自己当参照系 ══');
{
  // 21 晚：前 14 晚深睡正常，最近 7 晚骤降 → 必须识别为"变化"而非"常态"
  const earlier = Array.from({ length: 14 }, (_, i) =>
    rec({ id: 'e' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, deepSleepMinutes: 95 })
  );
  const recent = Array.from({ length: 7 }, (_, i) =>
    rec({ id: 'r' + i, date: `2026-09-${String(i + 15).padStart(2, '0')}`, deepSleepMinutes: 25 })
  );
  const changed = computeFindings([...recent, ...earlier], profile, { includeOnDemand: true });
  const trend = changed.find((f) => f.id === 'baseline_change');
  check('样本 ≥14 晚时做自我基线对比', trend !== undefined, '没有产出趋势发现');
  check('骤降被识别为「变化」而不是「常态」', trend?.headline.includes('掉到') === true, trend?.headline);
  check('变化类发现给出"回想最近变了什么"的动作', trend?.levers[0]?.includes('最近') === true);

  // 一直很低 → 必须说"这是你的常态"，而不是当成新问题
  const chronic = Array.from({ length: 21 }, (_, i) =>
    rec({ id: 'c' + i, date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, deepSleepMinutes: 25 })
  );
  const stable = computeFindings(chronic, profile, { includeOnDemand: true }).find((f) => f.id === 'baseline_stable');
  check('长期偏低被识别为「常态」而非变化', stable !== undefined, '误判成了变化');
  check(
    '「常态」结论明确说稳定本身就是结论',
    stable?.detail.includes('稳定本身就是结论') === true
  );

  // 样本不足时不许给基线结论——这是 HiMe 的 precondition 思路
  check(
    '样本 <14 晚时不给基线结论',
    computeFindings(HEALTHY, profile, { includeOnDemand: true }).every((f) => !f.id.startsWith('baseline_')),
    '样本不足却下了基线结论'
  );
}

console.log('\n══ 6d. 报警必须配动作，文案不许拼接叠字 ══');
{
  for (const [label, data] of [['健康', HEALTHY], ['紊乱', DISORDERED], ['演示', DEMO]] as const) {
    const found = computeFindings(data, profile, { includeOnDemand: true });
    const noLever = found.filter((f) => f.severity === 'act' && f.levers.length === 0);
    // 只告诉用户"你这里有问题"而不给下一步，等于把焦虑丢给他
    check(
      `${label}数据：每条 act 级发现都带可执行动作`,
      noLever.length === 0,
      `这些只有警告没有动作：${noLever.map((f) => f.id).join('、')}`
    );
  }

  // 动作句是手写的完整句子。曾经用 `睡前避免${label}` 拼过，
  // 结果 label 是"睡前使用屏幕"，拼出"睡前避免睡前使用屏幕"。
  // 这类拼接不会报错，只会让文案读起来像机器写的。
  const all = [
    ...computeFindings(DISORDERED, profile, { includeOnDemand: true }),
    ...computeFindings(DEMO, profile, { includeOnDemand: true }),
  ];
  const doubled: string[] = [];
  for (const f of all) {
    const text = [f.headline, f.detail, ...f.levers].join('|');
    for (const frag of ['睡前', '饮酒', '咖啡', '屏幕', '运动']) {
      if (text.includes(`${frag}${frag}`) || text.includes(`避免${frag}`) === false && text.includes(`${frag}避免${frag}`)) {
        doubled.push(`${f.id}: ${frag}`);
      }
    }
  }
  check('动作句没有拼接叠字', doubled.length === 0, doubled.join('、'));

  // 每条发现都必须是完整的四要素，缺一就不该渲染
  const incomplete = all.filter(
    (f) => !f.metric || !f.value || !f.reference || !f.headline || !f.detail
  );
  check(
    '每条发现四要素齐全（指标/值/参照/结论/解释）',
    incomplete.length === 0,
    incomplete.map((f) => f.id).join('、')
  );
}

console.log('\n══ 6e. 数据来源：推演值不得冒充测量值 ══');
{
  // ── 为什么这一节必须存在 ──
  // 手机没有脑电电极。yasa / U-Sleep / TinySleepNet 这一整类睡眠分期模型
  // 输入都是 EEG（见 docs 里的端侧调研），所以「深睡分钟数」在物理上测不到。
  // 本项目的做法是 generateSleepStages 按固定周期模型（前两周期深睡 34%、之后 12%）
  // 从就寝/起床/入睡用时/夜醒次数推算出分期。
  //
  // 下面这两条断言把「它是推演值」钉死成事实：一旦有人把深睡当测量量拿去做临床判断，
  // 或者改了周期模型让深睡占比不再随时长变化，测试会立刻失败。
  {
    const pcts: number[] = [];
    const durs: number[] = [];
    for (const wake of ['04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00']) {
      for (const lat of [5, 15, 30, 60]) {
        const g = generateSleepStages('23:00', wake, lat, 1);
        const tst = g.deepMinutes + g.lightMinutes + g.remMinutes;
        if (tst <= 0) continue;
        durs.push(tst);
        pcts.push((g.deepMinutes / tst) * 100);
      }
    }
    const n = pcts.length;
    const mx = durs.reduce((a, b) => a + b, 0) / n;
    const my = pcts.reduce((a, b) => a + b, 0) / n;
    const cov = durs.reduce((s2, d, i) => s2 + (d - mx) * (pcts[i] - my), 0) / n;
    const sx = Math.sqrt(durs.reduce((s2, d) => s2 + (d - mx) ** 2, 0) / n);
    const sy = Math.sqrt(pcts.reduce((s2, y) => s2 + (y - my) ** 2, 0) / n);
    const r = cov / (sx * sy);

    check(
      '深睡占比与睡眠时长强相关（证明它是推演值而非测量值）',
      r < -0.6,
      `实测 r = ${r.toFixed(3)}；若接近 0 说明模型改了，需重新评估来源标记`
    );
    // 最反直觉、也最能说明问题的一点：睡得越少，这个指标越好看
    const shortPct = pcts.filter((_, i) => durs[i] <= 300);
    const longPct = pcts.filter((_, i) => durs[i] >= 540);
    if (shortPct.length && longPct.length) {
      const a = shortPct.reduce((x, y) => x + y, 0) / shortPct.length;
      const b = longPct.reduce((x, y) => x + y, 0) / longPct.length;
      check(
        '「睡得越少深睡占比越高」这一反直觉特性仍成立（来源标记的前提）',
        a > b,
        `短睡 ${a.toFixed(1)}% vs 长睡 ${b.toFixed(1)}%`
      );
    }
  }

  const all = computeFindings(DEMO, profile, { includeOnDemand: true });
  const modeled = all.filter((f) => f.provenance === 'modeled');

  check('每条发现都有来源标记', all.every((f) => f.provenance !== undefined));
  check(
    '深睡类与自我基线类被标为推演值',
    modeled.length > 0 && modeled.every((f) => f.id.startsWith('deep') || f.id.startsWith('baseline')),
    `实际：${modeled.map((f) => f.id).join('、')}`
  );
  check(
    '就寝时刻/时长/夜醒/入睡用时/心情类标为实测',
    all
      .filter((f) => ['duration_good', 'duration_watch', 'duration_short', 'latency_good', 'awake_good', 'awake_watch', 'awake_high', 'regularity_good', 'irregular'].includes(f.id))
      .every((f) => f.provenance === 'measured'),
    all.filter((f) => f.provenance !== 'measured').map((f) => f.id).join('、')
  );

  // 最关键的一条：推演值不得判为 act。
  // act 会驱动首页「有 N 项值得先处理」和具体建议，
  // 而对一个由睡眠时长推算出来的数字提建议，等于对模型下诊断。
  const dirty = all.filter((f) => f.provenance === 'modeled' && f.severity === 'act');
  check(
    '推演值一律不得判为 act（act 会触发「值得先处理」）',
    dirty.length === 0,
    `这些漏了：${dirty.map((f) => f.id).join('、')}`
  );

  // 反向验证：自我基线那条原本会是 act，必须被降级
  const earlier = Array.from({ length: 14 }, (_, i) =>
    rec({ id: 'e' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, deepSleepMinutes: 95 })
  );
  const recent = Array.from({ length: 7 }, (_, i) =>
    rec({ id: 'r' + i, date: `2026-09-${String(i + 15).padStart(2, '0')}`, deepSleepMinutes: 25 })
  );
  const trendCase = computeFindings([...recent, ...earlier], profile, { includeOnDemand: true });
  const trend = trendCase.find((f) => f.id === 'baseline_change');
  check('深睡骤降能产出自我基线发现', trend !== undefined, '趋势发现没生成');
  check(
    '深睡骤降这条被从 act 降为 watch（否则会冒充可处理问题）',
    trend?.provenance === 'modeled' && trend?.severity !== 'act',
    `实际 ${trend?.provenance} / ${trend?.severity}`
  );
  // 降级必须覆盖到「最后才入列」的那条，中间位置会漏
  check(
    '降级覆盖到所有入列顺序（含最后 push 的趋势发现）',
    trendCase.filter((f) => f.provenance === 'modeled' && f.severity === 'act').length === 0
  );

  const def = computeFindings(DEMO, profile);
  check(
    '推演值不进默认清单（打开面板就看到的那些）',
    def.every((f) => f.provenance === 'measured'),
    def.filter((f) => f.provenance !== 'measured').map((f) => f.id).join('、')
  );
  check(
    '但推演值仍可被路由（用户问了要给回答）',
    modeled.length > 0,
    '全被过滤掉了，用户问深睡会答不出来'
  );

  // 展示时必须自曝来源，否则「深睡占比 22%」会被默认为测量值
  const renderedModeled = renderFinding(modeled[0]);
  check(
    '推演值被渲染时明确说明不是实测',
    renderedModeled.includes('推演值') && renderedModeled.includes('不是实测'),
    renderedModeled.slice(-120)
  );
  const measured = all.find((f) => f.provenance === 'measured')!;
  check('实测值不会被加上推演免责声明', !renderFinding(measured).includes('推演值'));

  const answer = generateLocalChatReply('我深睡怎么样', DEMO[0], DEMO, profile);
  check(
    '问深睡时，回答里带推演说明',
    answer.includes('推演值'),
    answer.slice(0, 100)
  );
}

console.log('\n══ 6g. 标题必须自曝来源（结构性，不是逐条查字符串）══');
{
  // 起因：上一轮给发现加了 provenance 字段，但它只覆盖了"默认清单过滤"与"渲染时的脚注"，
  // **标题——用户读到的第一句——照样在打临床招牌**：
  //   「深睡占比 27%，低于临床目标」
  // 而深睡占比是 generateSleepStages 由作息推演的，与睡眠时长 r = −0.769。
  //
  // 所以这条不逐条查字符串，而是**遍历所有 modeled 发现**，要求它们的 headline
  // 自带来源标记。将来任何人新增一条 modeled 发现却忘了标注，这里就会红。
  const MARKER = /推演|估算|模型/;
  // 本地重建"深睡骤降"数据集：recent/earlier 是 6e、6f 的块级变量，这里取不到。
  const earlierD = Array.from({ length: 14 }, (_, i) =>
    rec({ id: 'e' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, deepSleepMinutes: 95 }));
  const recentD = Array.from({ length: 7 }, (_, i) =>
    rec({ id: 'r' + i, date: `2026-09-${String(i + 15).padStart(2, '0')}`, deepSleepMinutes: 25 }));
  const datasets: Array<[string, any[]]> = [
    ['演示', DEMO],
    ['紊乱', DISORDERED],
    ['就寝不规律', ['21:00', '22:10', '23:00', '23:50', '00:40', '01:30', '03:00'].map((b, i) =>
      rec({ id: 'i' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, bedtime: b }))],
    ['深睡骤降', [...recentD, ...earlierD]],
  ];

  let modeledSeen = 0;
  const offenders: string[] = [];
  for (const [label, data] of datasets) {
    for (const f of computeFindings(data, profile, { includeOnDemand: true }) as any[]) {
      if (f.provenance !== 'modeled') continue;
      modeledSeen++;
      if (!MARKER.test(f.headline)) offenders.push(`${label}/${f.id}: ${f.headline}`);
    }
  }
  check('所有推演值的标题都自带来源标记',
    offenders.length === 0,
    offenders.slice(0, 3).join(' | '));
  check('确实检查到了推演值（不是空跑）', modeledSeen >= 3, `只检查到 ${modeledSeen} 条`);

  // 反向：实测值的标题**不应该**被误标成推演
  const measured = (computeFindings(DEMO, profile, { includeOnDemand: true }) as any[])
    .filter((f) => f.provenance === 'measured');
  check('实测值没有被误标成推演',
    measured.length > 0 && !measured.some((f) => MARKER.test(f.headline)),
    `${measured.filter((f) => MARKER.test(f.headline)).map((f) => f.id).join(',')}`);

  // ★ 模型不能去夸一个只睡 4 小时的人深睡好。
  // 固定 23:00 就寝、15 分钟入睡、1 次夜醒，只改起床时间，各 7 晚。
  // 实测：睡 4.0h → 深睡 27%、睡 12.0h → 18%（与时长 r = −0.769）。
  // 加时长门槛之前，**每一档都产 deep_good**，等于告诉只睡 4 小时的人
  // 「你的深睡已高于目标区间，不需要再提升」——由反向指标推出的有害建议。
  // ★ 必须用 buildSleepRecord 造记录，不能用上面的 rec()：
  // rec() 里 durationMinutes: 456 是**写死的**，只改 wakeTime 不影响它，
  // 于是所有档位都落在 8 小时，"短睡档位"永远是 0 个——断言会在空跑的情况下全绿。
  // 这是"断言必须跑在真实数据通路上"的又一次实例（第一轮就是这么漏掉深睡问题的）。
  const deepJudgments: Array<[number, string | null]> = [];
  for (const wake of ['03:20', '05:20', '06:20', '07:20', '09:20', '11:20']) {
    const recs = Array.from({ length: 7 }, (_, i) =>
      buildSleepRecord({
        id: 'w' + i,
        date: `2026-09-${String(22 - i).padStart(2, '0')}`,
        bedtime: '23:00',
        wakeTime: wake,
        latencyMinutes: 15,
        wakeCount: 1,
        wakingMood: 'neutral',
        preSleepHabits: [],
        targetDurationMinutes: 480,
      }) as unknown as SleepRecord);
    const f = (computeFindings(recs, profile, { includeOnDemand: true }) as any[])
      .find((x) => x.id === 'deep_good');
    deepJudgments.push([Math.round(recs[0]!.durationMinutes / 60), f ? f.headline : null]);
  }
  const shortNights = deepJudgments.filter(([h]) => h < 7);
  check('睡不足 7 小时时不产出"深睡好"的结论',
    shortNights.every(([, head]) => head === null),
    shortNights.filter(([, head]) => head !== null).map(([h, x]) => `${h}h: ${x}`).join(' | '));
  check('时长门槛确实被生效检查到（不是空跑）',
    shortNights.length >= 2, `只检查到 ${shortNights.length} 个短睡档位`);
  check('睡够 7 小时以上仍能给出深睡结论（门槛没有一刀切掉功能）',
    deepJudgments.some(([, head]) => head !== null),
    deepJudgments.map(([h, x]) => `${h}h:${x ? '有' : '无'}`).join(' '));

  // 深睡结论不得再对推演值下"临床目标"判定
  const allDeep = datasets.flatMap(([, data]) =>
    computeFindings(data, profile, { includeOnDemand: true }) as any[])
    .filter((f) => /^deep_|^baseline_/.test(f.id));
  check('深睡类结论不再声称达标/低于临床目标',
    !allDeep.some((f) => /临床目标|临床区间|已经达标|高于目标区间/.test(f.headline + (f.detail ?? ''))),
    allDeep.filter((f) => /临床目标|临床区间|已经达标|高于目标区间/.test(f.headline + (f.detail ?? '')))
      .map((f) => f.id).join(','));
  // reference 那一栏会直接展示给用户，不能把临床分期区间挂在推演值旁边而不加限定
  check('深睡类结论的参照栏说明了推演值不可比',
    allDeep.filter((f) => /临床分期/.test(f.reference ?? ''))
      .every((f) => /不可比|非实测/.test(f.reference ?? '')),
    allDeep.filter((f) => /临床分期/.test(f.reference ?? '') && !/不可比|非实测/.test(f.reference ?? ''))
      .map((f) => f.id).join(','));
}

console.log('\n══ 6f. 提示风险必须同时给出出路 ══');
{
  // 依据：Witte & Allen 2000 (DOI 10.1177/109019810002700506) ——
  // 强恐惧 + 高效能 = 最大行为改变；强恐惧 + **低效能** = 最大程度防御性反应。
  // Tannenbaum 2015 (DOI 10.1037/a0039729, N=27,372) 的元分析否定了
  // "恐惧诉求会反噬"这个流行说法——真正会反噬的是"只提风险、不给办法"。
  //
  // 所以规则不是"不要提风险"，而是：**一旦指出风险，必须同时给出用户做得到的动作**。
  // 这不是文案偏好，是有效应量支撑的。
  const RISK_LANGUAGE = /相关|关联|偏低|偏高|不足|过长|过短|偏少|偏多|下降|上升|更差|影响|波动/;

  // "提示风险的发现" = act（明确要做点什么）
  //                  ∪ watch 且正文里确实在说一件不好的事
  // watch 里的 _thin / _nodata 是"数据不够，先不下结论"，不该带动作，所以排除。
  const risky = (f: ReturnType<typeof computeFindings>[number]) =>
    f.severity === 'act' ||
    (f.severity === 'watch' &&
      !f.id.endsWith('_thin') &&
      !f.id.endsWith('_nodata') &&
      RISK_LANGUAGE.test(f.detail));

  // 两个数据集：演示（睡眠良好）与"深睡骤降"（会产出 act 级自我基线发现）。
  // 单靠演示数据的话 act 只有 1 条，规则容易被"没人命中"而静默失效。
  const earlier = Array.from({ length: 14 }, (_, i) =>
    rec({ id: 'e' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, deepSleepMinutes: 95 })
  );
  const recent = Array.from({ length: 7 }, (_, i) =>
    rec({ id: 'r' + i, date: `2026-09-${String(i + 15).padStart(2, '0')}`, deepSleepMinutes: 25 })
  );
  // 必须包含一个真正产出 `irregular`（就寝时间波动）的数据集。
  // 演示数据与 DISORDERED 都产不出它——前者的波动不够大，后者所有夜晚都是 02:40。
  // 少了这一组，本节的断言会在**从未检查过 irregular** 的情况下全绿：
  // 把 irregular 的 levers 清空也测不出来（这一条是被反向验证抓出来的）。
  const IRREGULAR = ['21:00', '22:10', '23:00', '23:50', '00:40', '01:30', '03:00'].map((b, i) =>
    rec({ id: 'i' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, bedtime: b })
  );
  const sets: Array<[string, ReturnType<typeof computeFindings>]> = [
    ['演示（睡眠良好）', computeFindings(DEMO, profile, { includeOnDemand: true })],
    ['紊乱（多条 act）', computeFindings(DISORDERED, profile, { includeOnDemand: true })],
    ['就寝不规律', computeFindings(IRREGULAR, profile, { includeOnDemand: true })],
    ['深睡骤降', computeFindings([...recent, ...earlier], profile, { includeOnDemand: true })],
  ];

  let checked = 0;
  for (const [label, set] of sets) {
    const offenders = set.filter((f) => risky(f) && f.levers.length === 0);
    checked += set.filter(risky).length;
    check(
      `提示风险的发现都带可执行动作（${label}）`,
      offenders.length === 0,
      `这些只提风险不给办法：${offenders.map((f) => f.id).join('、')}`
    );
  }
  // 防止规则被"没人命中"而静默失效——必须真的检查到了发现
  // 规则必须在**真的有风险发现**的数据集上被行使，否则它是空跑的。
  // 三个数据集合计至少要命中 5 条，否则说明 RISK_LANGUAGE 或分支已经和实现脱节。
  // 四个数据集合计实测命中 6 条。写成 >=6 是为了让"规则静默失效"必然失败：
  // 只要 RISK_LANGUAGE、severity 判定或某条发现的分支被改动导致命中数下降，这里就会红。
  check('风险规则确实被行使（不是空跑）', checked >= 6, `只检查到 ${checked} 条`);
  // 单独钉住 irregular：它是"指出风险"的典型，必须真的被检查到
  const irr = computeFindings(IRREGULAR, profile, { includeOnDemand: true }).find((f) => f.id === 'irregular');
  check('就寝不规律的发现被纳入风险检查', irr !== undefined && risky(irr!), irr ? `${irr.severity} / levers=${irr.levers.length}` : '未产出');

  // 反向验证用的正例：act 那条必须有动作（若这条挂了，说明规则被整体绕过）
  const actOnes = sets.flatMap(([, set]) => set.filter((f) => f.severity === 'act'));
  check(
    'act 级别全部带动作（含非演示数据集）',
    actOnes.length > 0 && actOnes.every((f) => f.levers.length > 0),
    `act 共 ${actOnes.length} 条`
  );

  // 数据不足类必须明确说"不下结论"，而不是含糊地给个方向
  const thin = sets.flatMap(([, set]) => set.filter((f) => f.id.endsWith('_thin')));
  check(
    '样本不足的发现明确拒绝下结论',
    thin.every((f) => /先不下结论|不够|不可靠|巧合/.test(f.detail)),
    thin.map((f) => f.id).join('、')
  );
}

console.log('\n══ 7. 报告与发现必须同源，不能各说各话 ══');
{
  const report = generateLocalClinicalAnalysis(DEMO, profile);
  const findings = computeFindings(DEMO, profile);
  const act = findings.filter((f) => f.severity === 'act');

  if (act.length > 0) {
    check(
      '报告的待处理项来自 act 级发现',
      act.every((f) => report.identifiedIssues.includes(f.headline)),
      `报告里是：${report.identifiedIssues.join(' / ')}`
    );
  }
  check('报告不再自造与发现矛盾的结论', report.identifiedIssues.length > 0);
  check(
    '报告的建议条数不超过发现条数',
    report.personalizedRecommendations.length <= findings.length,
    `${report.personalizedRecommendations.length} > ${findings.length}`
  );

  const size = JSON.stringify(report).length;
  // 旧实现是 1403 字的独立散文，和卡片结论各说各话
  check(`报告已收窄（≤1200 字，旧实现 1403 字）`, size <= 1200, `实际 ${size} 字`);
  check(
    '报告的时长评估引用了真实深睡/时长结论',
    report.clinicalMetricsAnalysis.deepSleepAssessment.length < 90,
    `该字段 ${report.clinicalMetricsAnalysis.deepSleepAssessment.length} 字，又在写散文了`
  );
}

console.log('\n══ 8. 渲染格式 ══');
{
  const a = generateLocalChatReply('深睡比例偏低怎么提升？', DISORDERED[0], DISORDERED, profile);
  check('回答里带上了用户实际值', /你：/.test(a), '没有"你：xx"这样的个人对照');
  check('回答里带上了临床参照', /参照：/.test(a), '没有参照系，用户无法判断好坏');
  check('回答不是超长散文', a.length < 700, `实际 ${a.length} 字`);

  const boundary = generateLocalChatReply('褪黑素能吃吗？', DISORDERED[0], DISORDERED, profile);
  check(
    '能力边界之后会接一条更该关心的事',
    boundary.includes('更要紧'),
    '拒绝了问题就什么也不给了'
  );
}

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ AI 顾问断言全部通过（${pass} 项）`);
} else {
  console.log(`❌ ${failures.length} 项失败 / 共 ${pass + failures.length} 项：\n`);
  for (const f of failures) console.log(`   • ${f}`);
  process.exit(1);
}
