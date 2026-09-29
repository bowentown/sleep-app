import React, { useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  RefreshCw,
  Zap,
  Moon,
} from 'lucide-react';
import { SleepRecord, SleepAnalysisResult, ChatMessage, UserProfile } from '../types/sleep';
import { generateLocalClinicalAnalysis, generateLocalChatReply, classifyIntent } from '../utils/clinicalSleepEngine';
import { computeFindings, type Finding } from '../utils/sleepFindings';
import {
  getActiveModelLabel,
  generateLocalLlmReply,
  getLocalLlmSupport,
  getLocalLlmCacheState,
} from '../utils/localLlmEngine';
import { ThemeConfig } from '../utils/themeStyles';

interface AIAdvicePanelProps {
  records: SleepRecord[];
  userProfile: UserProfile;
  theme: ThemeConfig;
}

export const AIAdvicePanel: React.FC<AIAdvicePanelProps> = ({ records, userProfile, theme }) => {
  const [analysis, setAnalysis] = useState<SleepAnalysisResult | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [activeProviderName, setActiveProviderName] = useState<string>(() => {
    // 初始标签反映用户已保存的档位，而非写死的默认值
    switch (userProfile.aiConfig?.provider) {
      case 'local_llm':
        return getActiveModelLabel();
      case 'local_rules':
        return '本地临床规则引擎';
      case 'custom_openai':
        return '自建 API';
      default:
        return 'DeepSeek';
    }
  });

  // Chat consultation state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '今晚有什么睡眠困扰？我可以结合你最近的作息给建议。',
      timestamp: '刚刚',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [localStage, setLocalStage] = useState<'loading' | 'generating' | null>(null);
  const localGenAbortRef = useRef<AbortController | null>(null);

  // 「发现」在打开面板时就算好，不需要用户先点一下"生成评估"。
  // 原先要点按钮才出现内容，等于默认状态什么都不告诉你——
  // 而这个功能的价值恰恰在于**主动指出问题**，而不是等你问对问题。
  const findings = useMemo(
    () => (records.length > 0 ? computeFindings(records, userProfile) : []),
    [records, userProfile]
  );
  const actFindings = findings.filter((f) => f.severity === 'act');

  const QUICK_PROMPTS = [
    '深睡比例偏低怎么提升？',
    '如何快速入睡？',
    '半夜容易醒怎么办？',
    '下午喝茶影响睡眠吗？',
  ];

  const fetchAIAnalysis = async () => {
    setIsLoadingAnalysis(true);

    try {
      const response = await fetch('/api/sleep/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recentLogs: records.slice(0, 7),
          userProfile,
          aiConfig: userProfile.aiConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('API unavailable');
      }

      const data = await response.json();
      setAnalysis(data);
    } catch (_err: any) {
      const localResult = generateLocalClinicalAnalysis(records, userProfile);
      setAnalysis(localResult);
      setActiveProviderName('端侧离线引擎');
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isSendingChat) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setInputText('');
    setIsSendingChat(true);

    try {
      const latestRecord = records[0];
      const cfg = userProfile.aiConfig;
      const customPersona =
        cfg?.systemPersona ||
        '你是一位资深临床睡眠医学顾问。结合用户的睡眠打分与周期推演数据（模型估算值，非传感器实测），以关怀、科学、富有实操性的语气为用户答疑解惑，并如实说明估算边界。';

      // 1. 端侧小模型（Qwen3-0.6B, llama.cpp WASM）：危机/用药安全护栏最高优先级，不经过任何模型
      if (cfg?.provider === 'local_llm') {
        const intent = classifyIntent(text);
        if (intent.category === 'crisis' || intent.category === 'drug_inquiry') {
          setActiveProviderName('本地引擎（安全护栏接管）');
          const guardReply = generateLocalChatReply(text, latestRecord, records);
          setChatMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: 'assistant',
              content: guardReply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          return;
        }

        const [support, cache] = await Promise.all([getLocalLlmSupport(), getLocalLlmCacheState()]);
        if (!support.supported || !cache.cached) {
          setActiveProviderName('本地引擎（端侧模型未就绪）');
          const hint = support.supported
            ? '\n\n（提示：可在 设置 → AI 顾问模型设置 中下载启用端侧小模型）'
            : `\n\n（端侧模型在当前设备不可用：${support.reason}）`;
          const fallbackReply = generateLocalChatReply(text, latestRecord, records) + hint;
          setChatMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: 'assistant',
              content: fallbackReply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          return;
        }

        setActiveProviderName(getActiveModelLabel());
        const aiId = `ai-${Date.now()}`;
        setChatMessages((prev) => [
          ...prev,
          {
            id: aiId,
            role: 'assistant' as const,
            content: '……',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        localGenAbortRef.current = new AbortController();
        try {
          const systemContent = `${customPersona}\n用户当前数据：昨夜得分 ${latestRecord?.sleepScore || 85}分，时长 ${latestRecord ? (latestRecord.durationMinutes / 60).toFixed(1) : 7.5}h，深睡 ${latestRecord?.deepSleepMinutes || 90}分。回答保持简短（200字内），语气温和。`;
          const history = newHistory.slice(-4).map((m) => ({
            role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: m.content,
          }));
          await generateLocalLlmReply(
            [{ role: 'system', content: systemContent }, ...history],
            {
              onToken: (token) =>
                setChatMessages((prev) =>
                  prev.map((m) => (m.id === aiId ? { ...m, content: m.content === '……' ? token : m.content + token } : m))
                ),
              onStage: (stage) => setLocalStage(stage),
            },
            localGenAbortRef.current.signal
          );
          // 极端情况下模型无输出时兜底到规则引擎
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === aiId && m.content.trim() === '' ? { ...m, content: generateLocalChatReply(text, latestRecord, records) } : m
            )
          );
        } catch (err: any) {
          const aborted =
            localGenAbortRef.current?.signal.aborted || err?.name === 'AbortError' || /abort/i.test(String(err?.message));
          if (aborted) {
            setChatMessages((prev) =>
              prev.map((m) => (m.id === aiId && m.content.trim() === '' ? { ...m, content: '（已停止生成）' } : m))
            );
          } else {
            setActiveProviderName('本地引擎（端侧模型异常，规则兜底）');
            const fallbackReply = generateLocalChatReply(text, latestRecord, records);
            setChatMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: fallbackReply } : m)));
          }
        } finally {
          localGenAbortRef.current = null;
          setLocalStage(null);
        }
        return;
      }

      // 1b. Local Clinical Offline Rule Engine
      if (cfg?.provider === 'local_rules' || (cfg?.provider as string) === 'local_gemma') {
        setActiveProviderName('本地临床规则引擎');
        // Fast local clinical response without external network dependence
        await new Promise((resolve) => setTimeout(resolve, 260));
        const localReply = generateLocalChatReply(text, latestRecord, records);
        const aiReply: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: localReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChatMessages((prev) => [...prev, aiReply]);
        return;
      }

      // 2. If user configured DeepSeek directly in APK: call DeepSeek client-side directly
      if (cfg?.provider === 'deepseek' && cfg.deepseekApiKey) {
        const modelToUse = cfg.deepseekModel || 'deepseek-flash';
        setActiveProviderName(`DeepSeek (${modelToUse})`);

        const dsRes = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: modelToUse === 'deepseek-flash' ? 'deepseek-chat' : modelToUse === 'deepseek-pro' ? 'deepseek-reasoner' : modelToUse,
            messages: [
              {
                role: 'system',
                content: `${customPersona}\n用户当前数据：昨夜得分 ${latestRecord?.sleepScore || 85}分，时长 ${latestRecord ? (latestRecord.durationMinutes / 60).toFixed(1) : 7.5}h，深睡 ${latestRecord?.deepSleepMinutes || 90}分。`,
              },
              ...newHistory.map((m) => ({ role: m.role, content: m.content })),
            ],
            temperature: 0.7,
          }),
        });

        if (dsRes.ok) {
          const dsData = await dsRes.json();
          const replyText = dsData.choices?.[0]?.message?.content || '已收到，为您调整睡眠建议。';
          const aiReply: ChatMessage = {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: replyText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
          setChatMessages((prev) => [...prev, aiReply]);
          return;
        }
      }

      // 3. Fallback to app server proxy
      const response = await fetch('/api/sleep/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: newHistory.slice(-6),
          recentLogs: records.slice(0, 3),
          userProfile,
          aiConfig: userProfile.aiConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat API network error');
      }

      const data = await response.json();
      if (data.provider) {
        setActiveProviderName(data.provider);
      }
      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.reply || '已收到您的反馈，正在分析...',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, aiReply]);
    } catch (_err) {
      const localReplyText = generateLocalChatReply(text, records[0], records);
      const aiReply: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: localReplyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, aiReply]);
    } finally {
      setIsSendingChat(false);
    }
  };

  // 只有问候语 = 还没开始对话。此时把快捷提问铺进消息区当欢迎列表用，
  // 否则卡片撑满屏幕后中间会留一大片空白（原先固定 h-[460px] 也盖不住）。
  const isFreshChat = chatMessages.length <= 1;

  return (
    // flex-1 min-h-0（而不是 h-full）让根节点占满 main 剩下的高度：
    // main 是 flex 列容器，h-full 的百分比高度在实测中解析不到，
    // 会导致下面的 flex-1 卡片塌缩成内容高度。
    <div className={`space-y-3 flex flex-col flex-1 min-h-0 ${theme.textPrimary}`}>
      {/* 1. Concise Assessment Banner */}
      <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} flex items-center justify-between gap-3`}>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-bold text-white">睡眠医学完整报告</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">模型：{activeProviderName} · 评分为模型估算，非医疗诊断</p>
        </div>

        <button
          type="button"
          onClick={fetchAIAnalysis}
          disabled={isLoadingAnalysis}
          className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow active:scale-95 shrink-0 whitespace-nowrap"
        >
          {isLoadingAnalysis ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>评估中</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3" />
              <span>{analysis ? '刷新完整报告' : '展开完整报告'}</span>
            </>
          )}
        </button>
      </div>

      {/* 2. 待处理清单——默认就在，不用点按钮 */}
      {actFindings.length > 0 && (
        <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} space-y-3`}>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <h3 className="text-xs font-bold text-white">
              有 {actFindings.length} 项值得先处理
            </h3>
          </div>
          {actFindings.slice(0, 3).map((f) => (
            <div
              key={f.id}
              className={`${theme.cardInnerBg} rounded-2xl p-3 border-l-3 border-amber-400 space-y-1`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-white">{f.headline}</span>
                <span className="text-[11px] font-mono text-amber-300 shrink-0 whitespace-nowrap">
                  {f.value}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{f.detail}</p>
              {f.levers[0] && (
                <p className="text-[11px] text-indigo-300 font-medium">→ {f.levers[0]}</p>
              )}
            </div>
          ))}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            这些结论来自你自己的记录，不是通用建议；改动后重新记录即可看到变化。
          </p>
        </div>
      )}

      {/* 3. 全部指标（含正常项）——知道哪些不用担心，和知道哪些要处理一样重要 */}
      {findings.length > 0 && (
        <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder}`}>
          <h3 className="text-xs font-bold text-white mb-3">全部指标</h3>
          <div className="space-y-2">
            {findings.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    f.severity === 'act'
                      ? 'bg-amber-400'
                      : f.severity === 'watch'
                        ? 'bg-slate-400'
                        : 'bg-emerald-400'
                  }`}
                />
                <span className="text-slate-300 flex-1 min-w-0 truncate">{f.metric}</span>
                <span className="font-mono text-white shrink-0">{f.value}</span>
                <span className="text-slate-500 shrink-0 hidden sm:inline">{f.reference}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assessment result */}
      {analysis && (
        <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} space-y-3 animate-in fade-in`}>
          <div className={`text-xs text-white ${theme.cardInnerBg} p-3 rounded-2xl border-l-3 border-indigo-400 leading-relaxed font-medium`}>
            “{analysis.scoreSummary}”
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className={`p-3 rounded-2xl ${theme.cardInnerBg} border ${theme.cardInnerBorder}`}>
              <span className="text-[11px] font-bold text-indigo-300 block mb-1">深睡机能恢复</span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {analysis.clinicalMetricsAnalysis.deepSleepAssessment}
              </p>
            </div>
            <div className={`p-3 rounded-2xl ${theme.cardInnerBg} border ${theme.cardInnerBorder}`}>
              <span className="text-[11px] font-bold text-emerald-300 block mb-1">入睡与睡眠效率</span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {analysis.clinicalMetricsAnalysis.efficiencyAssessment}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. Interactive AI Consultation Chat
          flex-1 + min-h-0 让卡片占满页签剩下的高度，消息区自己滚动。
          原先写死 h-[460px]：视口高时下方留空，视口矮时又得整页滚。 */}
      <div className={`${theme.cardBg} rounded-3xl p-4 border ${theme.cardBorder} flex flex-col flex-1 min-h-0`}>
        {/* Message feed */}
        <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-3 pr-1 text-xs no-scrollbar">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3 py-2 leading-relaxed text-xs ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white font-medium rounded-br-none'
                    : `${theme.cardInnerBg} text-white border ${theme.cardInnerBorder} rounded-bl-none`
                }`}
              >
                {msg.content}
              </div>
              <span className="text-[11px] text-slate-500 mt-1 px-1 font-mono">{msg.timestamp}</span>
            </div>
          ))}

          {isSendingChat && (
            <div className="flex items-center gap-2 text-indigo-400 text-xs py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                {localStage === 'loading'
                  ? '正在加载端侧模型（首次约需数秒）...'
                  : localStage === 'generating'
                  ? '端侧模型生成中（CPU 推理较慢，请稍候）...'
                  : '顾问正在组织回复...'}
              </span>
              {localStage && (
                <button
                  type="button"
                  onClick={() => localGenAbortRef.current?.abort()}
                  className="ml-1 text-slate-400 hover:text-white border border-slate-700 rounded-lg px-2 py-0.5 text-xs cursor-pointer"
                >
                  停止
                </button>
              )}
            </div>
          )}

          {/* 全新对话：把快捷提问铺在消息区里，顺便把空白用「能问什么」填上 */}
          {isFreshChat && (
            <div className="pt-2 space-y-2">
              {/* 空态品牌化：一块空白区域如果什么都不放，会被读成「坏了/没加载出来」。
                  放一个品牌标记既填了空白，又交代了这是「还没开始」。
                  光晕用主题强调色，跟着四套主题走；aria-hidden 是因为它对读屏
                  用户没有信息量，纯装饰。 */}
              <div className="flex flex-col items-center justify-center pt-1 pb-5 gap-3 select-none" aria-hidden>
                <div className="relative">
                  <div
                    className="absolute -inset-5 rounded-full blur-xl opacity-40"
                    style={{ background: `radial-gradient(circle, ${theme.accentHex}55, transparent 70%)` }}
                  />
                  <Moon className={`w-10 h-10 ${theme.accentText} relative`} />
                </div>
                <span className={`text-[11px] ${theme.accentText} font-bold tracking-[0.3em] pl-[0.3em]`}>
                  懂睡眠 · 更懂你
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono">不知道从哪问起？试试这些：</p>
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(prompt)}
                  disabled={isSendingChat}
                  className={`w-full text-left text-xs px-3 py-2 rounded-xl ${theme.cardInnerBg} hover:opacity-80 text-slate-300 border ${theme.cardInnerBorder} transition-all cursor-pointer disabled:opacity-50`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick prompt suggestions — 只在对话开始后出现。
            换行而非横向滚动：隐藏滚动条会让被截断的 chip 看起来像故障。
            全新对话时这几条已经铺在消息区里了，再显示一遍是重复。
            这里用条件渲染而不是 hidden：flex 与 hidden 都设 display，
            谁生效取决于 Tailwind 的生成顺序，不可靠。 */}
        {!isFreshChat && (
          <div className="py-2 flex flex-wrap items-center gap-2 shrink-0 border-t border-slate-700/50">
            {QUICK_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSendMessage(prompt)}
                disabled={isSendingChat}
                className={`text-xs whitespace-nowrap px-3 py-1 rounded-full ${theme.cardInnerBg} hover:opacity-80 text-slate-300 border ${theme.cardInnerBorder} transition-all cursor-pointer disabled:opacity-50`}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Chat input box */}
        <div className="pt-3 border-t border-slate-700/50 flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage();
            }}
            placeholder="输入睡眠疑问..."
            className={`flex-1 ${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400 font-medium`}
          />
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isSendingChat}
            className="p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-all cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
