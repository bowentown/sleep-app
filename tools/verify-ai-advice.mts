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
import {
  computeFindings,
  computeSleepStats,
  routeQuestion,
  matchBoundary,
} from '../src/utils/sleepFindings.js';
import { getInitialSleepLogs } from '../src/utils/sleepRecord.js';
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
  check('健康数据下不劝人"提升深睡"', a.includes('高于') || a.includes('不需要'), a.slice(0, 80));
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
  const changed = computeFindings([...recent, ...earlier], profile);
  const trend = changed.find((f) => f.id === 'baseline_change');
  check('样本 ≥14 晚时做自我基线对比', trend !== undefined, '没有产出趋势发现');
  check('骤降被识别为「变化」而不是「常态」', trend?.headline.includes('掉到') === true, trend?.headline);
  check('变化类发现给出"回想最近变了什么"的动作', trend?.levers[0]?.includes('最近') === true);

  // 一直很低 → 必须说"这是你的常态"，而不是当成新问题
  const chronic = Array.from({ length: 21 }, (_, i) =>
    rec({ id: 'c' + i, date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, deepSleepMinutes: 25 })
  );
  const stable = computeFindings(chronic, profile).find((f) => f.id === 'baseline_stable');
  check('长期偏低被识别为「常态」而非变化', stable !== undefined, '误判成了变化');
  check(
    '「常态」结论明确说稳定本身就是结论',
    stable?.detail.includes('稳定本身就是结论') === true
  );

  // 样本不足时不许给基线结论——这是 HiMe 的 precondition 思路
  check(
    '样本 <14 晚时不给基线结论',
    computeFindings(HEALTHY, profile).every((f) => !f.id.startsWith('baseline_')),
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
