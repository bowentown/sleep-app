import { SleepRecord, SleepAnalysisResult, UserProfile } from '../types/sleep';
import {
  computeFindings,
  routeQuestion,
  matchBoundary,
  renderFinding,
  ANSWER_ANCHORS,
  type Finding,
} from './sleepFindings';

/**
 * 极光睡眠 (SomnaCare) 厚实规则与临床对话引擎 (Phase 0 深度增强版)
 *
 * 特性：
 * 1. 严格危机安全护栏：无条件拦截自伤、极端绝望、药物处方风险；
 * 2. 深度意图识别分类：深度睡眠、早醒失眠、咖啡因腺苷代谢、节律紊乱、噩梦情绪、睡眠限制(CBT-I)；
 * 3. 动态生理数据插值：将昨夜真实深睡比例、就寝点、时型(Chronotype)、睡眠债务结合推断；
 * 4. 0MB 本地零成本秒级响应，无需任何网络。
 */

// 危机关键词拦截表（严禁绕过，优先输出救助热线与医疗建议）
const CRISIS_KEYWORDS = [
  '想死',
  '自杀',
  '不想活',
  '活着没意思',
  '自残',
  '自伤',
  '割腕',
  '轻生',
  '跳楼',
  '绝望到极点',
  '安眠药吃多少会死',
  '吞安眠药',
];

// 处方药物问询拦截表（严禁提供药物剂量或开药指引）
const DRUG_KEYWORDS = [
  '安眠药吃几颗',
  '阿普唑仑剂量',
  '佐匹克隆怎么吃',
  '地西泮推荐',
  '开点药',
  '推荐处方药',
  '艾司唑仑吃多少',
];

export interface IntentResult {
  category:
    | 'crisis'
    | 'drug_inquiry'
    | 'deep_sleep'
    | 'sleep_latency'
    | 'night_awakening'
    | 'early_awakening'
    | 'caffeine_lifestyle'
    | 'dreams_anxiety'
    | 'circadian_shift'
    | 'nap_recovery'
    | 'detection_principles'
    | 'general_advice';
  matchedKeywords: string[];
}

export function classifyIntent(text: string): IntentResult {
  const lower = text.toLowerCase();

  // 1. 危机检测最高优先级
  for (const kw of CRISIS_KEYWORDS) {
    if (lower.includes(kw)) {
      return { category: 'crisis', matchedKeywords: [kw] };
    }
  }

  // 2. 处方药限制
  for (const kw of DRUG_KEYWORDS) {
    if (lower.includes(kw)) {
      return { category: 'drug_inquiry', matchedKeywords: [kw] };
    }
  }

  // 3. 常见睡眠意图路由
  if (lower.includes('深睡') || lower.includes('慢波') || lower.includes('深度睡眠') || lower.includes('恢复体力')) {
    return { category: 'deep_sleep', matchedKeywords: ['深睡'] };
  }

  if (
    lower.includes('睡不着') ||
    lower.includes('入睡困难') ||
    lower.includes('翻来覆去') ||
    lower.includes('躺很久') ||
    lower.includes('失眠')
  ) {
    return { category: 'sleep_latency', matchedKeywords: ['入睡困难'] };
  }

  if (
    lower.includes('半夜醒') ||
    lower.includes('醒来好几次') ||
    lower.includes('容易醒') ||
    lower.includes('夜醒') ||
    lower.includes('起夜')
  ) {
    return { category: 'night_awakening', matchedKeywords: ['夜醒'] };
  }

  if (lower.includes('早醒') || lower.includes('凌晨三点') || lower.includes('凌晨四点') || lower.includes('再也睡不着')) {
    return { category: 'early_awakening', matchedKeywords: ['早醒'] };
  }

  if (
    lower.includes('咖啡') ||
    lower.includes('奶茶') ||
    lower.includes('浓茶') ||
    lower.includes('抽烟') ||
    lower.includes('喝酒') ||
    lower.includes('夜宵')
  ) {
    return { category: 'caffeine_lifestyle', matchedKeywords: ['生活习惯'] };
  }

  if (lower.includes('做梦') || lower.includes('噩梦') || lower.includes('心慌') || lower.includes('焦虑') || lower.includes('压力大')) {
    return { category: 'dreams_anxiety', matchedKeywords: ['梦境与焦虑'] };
  }

  if (
    lower.includes('熬夜') ||
    lower.includes('倒时差') ||
    lower.includes('生物钟') ||
    lower.includes('晚睡') ||
    lower.includes('通宵') ||
    lower.includes('昼夜')
  ) {
    return { category: 'circadian_shift', matchedKeywords: ['昼夜节律'] };
  }

  if (lower.includes('午睡') || lower.includes('打盹') || lower.includes('小憩') || lower.includes('下午困')) {
    return { category: 'nap_recovery', matchedKeywords: ['午间小憩'] };
  }

  if (
    lower.includes('原理') ||
    lower.includes('怎么测') ||
    lower.includes('打呼噜') ||
    lower.includes('脑电') ||
    lower.includes('准确')
  ) {
    return { category: 'detection_principles', matchedKeywords: ['检测原理'] };
  }

  return { category: 'general_advice', matchedKeywords: [] };
}

/**
 * 完整睡眠分析报告（规则推导）
 */
export function generateLocalClinicalAnalysis(
  recentLogs: SleepRecord[] = [],
  userProfile?: UserProfile
): SleepAnalysisResult {
  const count = recentLogs.length;
  const avgDuration =
    count > 0
      ? Math.round(recentLogs.reduce((acc, r) => acc + (r.durationMinutes || 0), 0) / count)
      : 450;
  const avgDeep =
    count > 0
      ? Math.round(recentLogs.reduce((acc, r) => acc + (r.deepSleepMinutes || 0), 0) / count)
      : 95;
  const avgRem =
    count > 0
      ? Math.round(recentLogs.reduce((acc, r) => acc + (r.remSleepMinutes || 0), 0) / count)
      : 90;
  const avgScore =
    count > 0
      ? Math.round(recentLogs.reduce((acc, r) => acc + (r.sleepScore || 0), 0) / count)
      : 82;
  const avgEfficiency =
    count > 0
      ? Math.round(recentLogs.reduce((acc, r) => acc + (r.sleepEfficiency || 0), 0) / count)
      : 88;
  const avgLatency =
    count > 0
      ? Math.round(recentLogs.reduce((acc, r) => acc + (r.latencyMinutes || 15), 0) / count)
      : 16;
  const avgWake =
    count > 0
      ? (recentLogs.reduce((acc, r) => acc + (r.wakeCount || 0), 0) / count).toFixed(1)
      : '1.0';

  const deepPct = avgDuration > 0 ? Math.round((avgDeep / avgDuration) * 100) : 21;
  const remPct = avgDuration > 0 ? Math.round((avgRem / avgDuration) * 100) : 20;

  // 1. 推断昼夜节律时型 (Chronotype)
  let chronotype = '平衡蜂鸟型 (Hummingbird Chronotype)';
  let chronotypeDesc =
    '您的昼夜生物钟具备良好的弹性与适应力，体内皮质醇与褪黑素节律平稳。维持固定作息即可巩固深睡波峰。';

  if (recentLogs[0]?.bedtime) {
    const [h] = recentLogs[0].bedtime.split(':').map(Number);
    if (h >= 21 && h < 23) {
      chronotype = '晨型云雀型 (Lark Chronotype)';
      chronotypeDesc =
        '天生具备早睡早起节律，清晨皮质醇迅速攀升，前一日深度睡眠启动早，适宜早间高专注度工作。';
    } else if (h >= 0 || (h >= 23 && Number(recentLogs[0].bedtime.split(':')[1]) >= 45)) {
      chronotype = '夜型猫头鹰型 (Owl Chronotype)';
      chronotypeDesc =
        '褪黑素分泌峰值较常规推迟1-2小时，晚间思维活跃。建议睡前调暗卧室照度，避免强光抑制入眠。';
    }
  }

  // 2. 评定健康等级
  let healthGrade = '良好 A';
  if (avgScore >= 88) healthGrade = '优良 A+';
  else if (avgScore >= 75) healthGrade = '良好 A';
  else if (avgScore >= 65) healthGrade = '亚健康 B';
  else healthGrade = '需调理 C';

  // 3. 提取睡前行为阻碍
  const allHabits = new Set<string>();
  recentLogs.forEach((r) => {
    (r.preSleepHabits || []).forEach((h) => allHabits.add(h));
  });

  const issues: string[] = [];
  if (allHabits.has('screen_time')) {
    issues.push('睡前屏幕蓝光刺激视黑素受体，延迟褪黑素自然分泌约30-45分钟');
  }
  if (allHabits.has('caffeine')) {
    issues.push('午后摄入咖啡因阻断腺苷受体清除，削弱夜间蓄积的睡眠压力（Sleep Drive）');
  }
  if (Number(avgWake) > 1.2) {
    issues.push(`夜间平均觉醒 ${avgWake} 次，截断慢波深睡（N3）的周期连续性`);
  }
  if (avgLatency > 22) {
    issues.push('入睡潜伏期偏长（超20分钟），表明睡前交感神经过度兴奋未能顺利切换');
  }
  if (issues.length === 0) {
    issues.push('作息节律相对稳定，保持良好起卧规律即可');
  }

  const hours = (avgDuration / 60).toFixed(1);
  const targetH = userProfile?.targetDurationHours || 8;
  const debt = (targetH - Number(hours)).toFixed(1);

  // 报告不再自成一篇文章，而是从同一份「发现」里长出来。
  // 原先这里硬写 1403 字散文，和卡片上的结论各说各话；
  // 现在报告与聊天读的是同一批数据、同一套阈值，不可能互相矛盾。
  const findings = computeFindings(recentLogs, userProfile);
  const act = findings.filter((f) => f.severity === 'act');
  const watch = findings.filter((f) => f.severity === 'watch');
  const byId = (id: string) => findings.find((f) => f.id === id);
  const brief = (id: string, fallback: string) => byId(id)?.headline ?? fallback;

  const TIME_WINDOWS: Record<string, string> = {
    deep: '夜间睡眠微气候',
    latency: '睡前减速期 (21:30 - 22:45)',
    duration: '就寝提前',
    awakening: '夜间睡眠微气候',
    regularity: '固定起床时间',
    habit: '白天 / 睡前习惯',
  };
  const windowFor = (f: Finding) => {
    const key = Object.keys(TIME_WINDOWS).find((k) => f.id.includes(k) || f.topics.includes(k));
    return key ? TIME_WINDOWS[key] : '全天';
  };

  const recs = [...act, ...watch].slice(0, 3).map((f) => ({
    timeWindow: windowFor(f),
    action: f.headline,
    detail: f.detail,
    impact: f.levers[0] ?? '继续记录，观察该指标是否改善',
  }));

  return {
    chronotype,
    chronotypeDescription: chronotypeDesc,
    overallHealthGrade: healthGrade,
    scoreSummary:
      act.length > 0
        ? `近${count || 7}天有 ${act.length} 项指标需要处理：${act.map((f) => f.metric).join('、')}。`
        : `近${count || 7}天各项指标都在正常范围。`,
    clinicalMetricsAnalysis: {
      durationAssessment: brief('duration_short', `平均 ${hours} 小时（目标 ${targetH} 小时）`) + '。',
      deepSleepAssessment: brief('deep_low', `深睡占比 ${deepPct}%，在 13–23% 区间内`) + '。',
      remSleepAssessment: `REM 平均 ${avgRem} 分钟，占比 ${remPct}%（参考 20–25%）。`,
      efficiencyAssessment: `睡眠效率 ${avgEfficiency}%（>85% 为佳），平均夜醒 ${avgWake} 次。`,
      sleepLatencyAssessment: brief('latency_high', `入睡潜伏期 ${avgLatency} 分钟，在正常范围内`) + '。',
    },
    identifiedIssues: act.length > 0 ? act.map((f) => f.headline) : ['各项指标均在正常范围'],
    personalizedRecommendations: recs.length > 0 ? recs : [{
      timeWindow: '全天',
      action: '保持当前作息',
      detail: '各项指标都在正常范围内，此时最有价值的做法是不去改动它。',
      impact: '维持现有节律',
    }],
    mindsetAffirmation:
      '允许思绪如云朵般悄然飘过，黑夜是身体自我治愈的神圣时刻，今晚您将拥有一场深沉安稳的修复之旅。',
  };
}

/**
 * 做厚做深的高质量本地对话引擎（意图驱动 + 临床插值 + 安全护栏）
 */
export function generateLocalChatReply(
  userText: string,
  latestRecord?: SleepRecord,
  records: SleepRecord[] = [],
  userProfile?: UserProfile
): string {
  const intent = classifyIntent(userText);

  // 1. 危机干预安全护栏（无条件熔断，一字不动）
  if (intent.category === 'crisis') {
    return `❤️ **请珍重您的生命，您并不孤单！**\n\n我们非常关心您的安危与身心感受。当睡眠困难伴随极度的情绪痛苦时，请立刻寻求专业心理与危机支持：\n\n• **全国希望24小时生命求助热线**：400-161-9995\n• **北京心理危机研究与干预中心**：010-82951332 / 800-810-1117\n• **紧急求助电话**：110 / 120\n\n极光睡眠是健康科普工具，无法替代急诊与专业精神科医生。请立刻放下手机，联系身边的亲友或拨打上方免费热线，专业人员随时准备倾听并帮助您度过此刻难关！`;
  }

  // 2. 处方药物咨询安全护栏
  if (intent.category === 'drug_inquiry') {
    return `⚠️ **用药安全声明**：\n\n作为离线睡眠健康顾问，我无法为您提供处方药物（如安眠药、镇静催眠类处方剂）的具体用量、处方推荐或开药指引。\n\n• **医学原则**：镇静催眠类药物属于国家严格管制的处方药，个体耐受性、代谢速度差异极大，必须由具备执业资质的精神心理科或神经内科医生面诊后开具；\n• **无药干预优先**：在临床上，失眠认知行为疗法（CBT-I）是慢性失眠的一线疗法，有效率与持久度均优于短期药物依赖。\n\n如失眠已连续超过 3 周并严重影响白天工作生活，建议前往当地公立医院睡眠医学中心就诊。`;
  }


  // 3. 能力边界：这类问题**主动说不答**。
  //    硬塞一条不相关的发现给一个问用药的人，比承认答不了更糟——
  //    会让他以为自己在接受用药建议。
  const boundary = matchBoundary(userText);
  const all = records.length > 0 || latestRecord ? computeFindings(
    records.length > 0 ? records : (latestRecord ? [latestRecord] : []),
    userProfile,
    { includeOnDemand: true }
  ) : [];

  if (boundary) {
    const urgent = all.find((f) => f.severity === 'act');
    const tail = urgent
      ? `\n\n---\n\n另外，你的记录里有一件事更要紧：**${urgent.headline}**。${urgent.detail}`
      : '';
    return boundary.reply + tail;
  }

  // 4. 把发现渲染成回答。提问只用来**选**哪条发现，不负责生成内容。
  const routed = routeQuestion(userText, all);

  if (routed.covered && routed.matched.length > 0) {
    // 先给有出处的常识锚点，再叠个人数据——只给个人数据没有参照系
    const anchorKey = Object.keys(ANSWER_ANCHORS).find((k) =>
      routed.matched.some((f) => f.topics.includes(k))
    );
    const anchor = anchorKey ? `${ANSWER_ANCHORS[anchorKey]}\n\n` : '';
    return anchor + routed.matched.slice(0, 2).map((f) => renderFinding(f)).join('\n\n---\n\n');
  }

  // 5. 答不了就直说答不了，但**不能空手**——附上他当前最该关心的那条。
  //    旧实现在这里复述问题 + 让用户换个说法，实测 75% 的提问都掉进这里。
  const top = routed.fallback ?? all[0];
  const head =
    `这个问题不在我能判断的范围内——我的能力是睡眠记录与作息指标，不是通用医学问答。` +
    `与其给你一个看似合理的猜测，不如直说。`;
  return top
    ? `${head}\n\n不过你的记录里有一件事更值得先看：\n\n${renderFinding(top)}`
    : head;
}
