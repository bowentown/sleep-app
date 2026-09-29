import React, { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  CheckCircle2,
  Eye,
  EyeOff,
  X,
  Search,
  Loader2,
  UserCheck,
  HardDrive,
  Download,
  Trash2,
} from 'lucide-react';
import { CustomAIConfig, AIProvider } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';
import { useModalA11y } from '../utils/modalA11y';
import {
  
  
  getActiveModelLabel,
  isNativeLlmAvailable,
  getHfToken,
  setHfToken,
  getLocalLlmSupport,
  getLocalLlmCacheState,
  downloadLocalLlm,
  deleteLocalLlm,
  ensureStoragePersistence,
  consumeLlmCrashFlag,
  type LocalLlmSupport,
  type LocalLlmCacheState,
} from '../utils/localLlmEngine';

interface CustomAISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CustomAIConfig;
  onSaveConfig: (cfg: CustomAIConfig) => void;
  theme: ThemeConfig;
}

export const CustomAISettingsModal: React.FC<CustomAISettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  theme,
}) => {
  const [provider, setProvider] = useState<AIProvider>(config.provider || 'deepseek');
  const [deepseekApiKey, setDeepseekApiKey] = useState(config.deepseekApiKey || '');
  const [deepseekModel, setDeepseekModel] = useState(config.deepseekModel || 'deepseek-flash');
  const [customBaseUrl, setCustomBaseUrl] = useState(config.customBaseUrl || 'https://api.deepseek.com');
  const [customApiKey, setCustomApiKey] = useState(config.customApiKey || '');
  const [customModelName, setCustomModelName] = useState(config.customModelName || 'deepseek-flash');

  const [systemPersona, setSystemPersona] = useState(
    config.systemPersona ||
      '你是一位循证的睡眠与生理节律助手。以温暖、关怀、务实的语气，依据公开的睡眠研究共识提供作息调整建议，并如实说明哪些事这个 App 做不到。'
  );

  const [showDeepseekKey, setShowDeepseekKey] = useState(false);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Model Query Tool State
  const [isQueryingModels, setIsQueryingModels] = useState(false);
  const [queriedModels, setQueriedModels] = useState<string[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);

  // 端侧小模型状态（支持性 / 缓存 / 下载进度 / 错误）
  const [llmSupport, setLlmSupport] = useState<LocalLlmSupport | null>(null);
  const [llmCache, setLlmCache] = useState<LocalLlmCacheState | null>(null);
  const [llmProgress, setLlmProgress] = useState<number | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [hfTokenVal, setHfTokenVal] = useState(getHfToken());
  const [llmCrashNote, setLlmCrashNote] = useState<string | null>(null);
  const llmAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const crash = consumeLlmCrashFlag();
    if (crash && !cancelled) {
      setLlmCrashNote(
        crash === 'loading'
          ? '上次会话在加载端侧模型时被系统终止（大概率内存不足）。已自动改用更保守的内存配置；若再次发生，建议删除模型并改用规则引擎档位。'
          : '上次会话在端侧模型生成回复时被系统终止（大概率内存不足）。若反复出现，建议删除模型并改用规则引擎档位。'
      );
    }
    Promise.all([getLocalLlmSupport(), getLocalLlmCacheState()]).then(([s, c]) => {
      if (!cancelled) {
        setLlmSupport(s);
        setLlmCache(c);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleDownloadLlm = async () => {
    setLlmError(null);
    await ensureStoragePersistence();
    setLlmProgress(0);
    const ac = new AbortController();
    llmAbortRef.current = ac;
    try {
      await downloadLocalLlm((percent) => setLlmProgress(percent), ac.signal);
    } catch (e: any) {
      if (!ac.signal.aborted) {
        const detail = e?.message || String(e);
        setLlmError(
          `下载失败：${detail}。请检查网络能否访问 hf-mirror.com；若持续失败，请换 Chrome 浏览器重试，并把浏览器控制台（F12）里的红色报错发给我。`
        );
      }
    }
    llmAbortRef.current = null;
    setLlmProgress(null);
    const [s, c] = await Promise.all([getLocalLlmSupport(), getLocalLlmCacheState()]);
    setLlmSupport(s);
    setLlmCache(c);
  };

  const handleDeleteLlm = async () => {
    setLlmError(null);
    try {
      await deleteLocalLlm();
    } catch (e: any) {
      setLlmError(`删除模型失败：${e?.message || e}`);
    }
    const [s, c] = await Promise.all([getLocalLlmSupport(), getLocalLlmCacheState()]);
    setLlmSupport(s);
    setLlmCache(c);
  };

  const { ref: dialogRef, dialogProps } = useModalA11y({ isOpen, onClose, label: 'AI 服务设置' });

  if (!isOpen) return null;

  // Real-time API Endpoint Model Query Function
  const handleQueryRemoteModels = async () => {
    setIsQueryingModels(true);
    setQueryError(null);
    setQueriedModels([]);

    const baseUrl = provider === 'deepseek' ? 'https://api.deepseek.com' : customBaseUrl;
    const apiKey = provider === 'deepseek' ? deepseekApiKey : customApiKey;

    if (!apiKey) {
      setQueryError('请先填入 API 密钥，再执行端口查询');
      setIsQueryingModels(false);
      return;
    }

    try {
      const cleanUrl = baseUrl.replace(/\/+$/, '');
      const modelsEndpoint = cleanUrl.endsWith('/v1') ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;

      const res = await fetch(modelsEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`端点响应 HTTP ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.data)) {
        const ids = data.data.map((m: any) => m.id).filter(Boolean);
        setQueriedModels(ids);
      } else {
        throw new Error('未在返回数据中检测到 models 数组');
      }
    } catch (err: any) {
      setQueryError(`查询失败 (${err.message})。服务商若不支持 /v1/models 查询，可直接手动填写`);
      if (provider === 'deepseek') {
        setQueriedModels(['deepseek-flash', 'deepseek-pro', 'deepseek-chat', 'deepseek-reasoner']);
      }
    } finally {
      setIsQueryingModels(false);
    }
  };

  const handleSave = () => {
    onSaveConfig({
      provider,
      deepseekApiKey: deepseekApiKey.trim(),
      deepseekModel: deepseekModel.trim(),
      customBaseUrl: customBaseUrl.trim(),
      customApiKey: customApiKey.trim(),
      customModelName: customModelName.trim(),
      systemPersona: systemPersona.trim(),
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div
      {...dialogProps}
      ref={dialogRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 overflow-y-auto outline-none"
    >
      <div className={`${theme.cardBg} border border-slate-700 rounded-3xl w-full max-w-md p-5 text-white shadow-2xl relative my-auto max-h-[92vh] overflow-y-auto no-scrollbar`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">AI 顾问模型设置</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-7 h-7 rounded-full bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center text-xs cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Provider Selection Tabs - 3-Tier Fallback Chain */}
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <button
              type="button"
              onClick={() => setProvider('deepseek')}
              className={`py-2 px-1 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                provider === 'deepseek'
                  ? 'bg-indigo-600 border-white text-white'
                  : `${theme.cardInnerBg} border-slate-700 text-slate-300`
              }`}
            >
              DeepSeek
            </button>

            <button
              type="button"
              onClick={() => setProvider('local_rules')}
              className={`py-2 px-1 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                provider === 'local_rules'
                  ? 'bg-indigo-600 border-white text-white'
                  : `${theme.cardInnerBg} border-slate-700 text-slate-300`
              }`}
            >
              规则引擎
            </button>

            <button
              type="button"
              onClick={() => setProvider('local_llm')}
              className={`py-2 px-1 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                provider === 'local_llm'
                  ? 'bg-indigo-600 border-white text-white'
                  : `${theme.cardInnerBg} border-slate-700 text-slate-300`
              }`}
            >
              端侧小模型
            </button>

            <button
              type="button"
              onClick={() => setProvider('custom_openai')}
              className={`py-2 px-1 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                provider === 'custom_openai'
                  ? 'bg-indigo-600 border-white text-white'
                  : `${theme.cardInnerBg} border-slate-700 text-slate-300`
              }`}
            >
              自建 API
            </button>
          </div>

          {/* 1. Offline Clinical Rule Engine Pane (0MB Download - High Quality Base) */}
          {provider === 'local_rules' && (
            <div className={`p-4 rounded-2xl ${theme.cardInnerBg} border border-slate-700 space-y-3 text-xs`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white">本地睡眠规则引擎 (Phase 0)</span>
                </div>
                <span className="text-xs text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-600">
                  0MB 即刻可用 · 零延迟
                </span>
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed">
                建议方向与失眠认知行为治疗（CBT-I）一致——它不替代 CBT-I 治疗，
                只是把同样的原则用在你可以自己做的事上；时长与环境区间参照美国睡眠医学会
                与睡眠研究学会的共识（7–9 小时、18–21℃）。内置关键词意图分类与生命危机熔断护栏，
                并结合你当夜的时长、入睡潜伏期与作息记录取值。
              </p>

              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/60 text-[11px] text-emerald-300 space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>覆盖十类睡眠话题与生命安全护栏</span>
                </div>
                <p className="text-slate-300 text-xs">
                  覆盖入睡困难、夜间醒转、早醒、咖啡因与酒精代谢、作息规律性等话题，以及危机热线即时阻断。不包含「提升深睡」——深睡无法被本 App 测量。
                </p>
              </div>
            </div>
          )}

          {/* 2. On-Device Local LLM Pane (Qwen3-0.6B via llama.cpp WASM) */}
          {provider === 'local_llm' && (
            <div className={`p-4 rounded-2xl ${theme.cardInnerBg} border border-slate-700 space-y-3 text-xs`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  <span className="font-bold text-white">端侧小模型 · {getActiveModelLabel()}</span>
                </div>
                <span className="text-xs text-indigo-300 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-600">
                  离线可用 · 隐私不上传
                </span>
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed">
                {isNativeLlmAvailable()
                  ? 'APK 内使用原生 MediaPipe 引擎在本机推理（Gemma 3 1B int4，约 529 MB，mmap 加载），稳定性优于 WASM 方案。仅接管日常聊天；报告始终由规则引擎完成；危机与用药安全护栏优先于模型。'
                  : '基于 llama.cpp WASM 在本机推理（Qwen3-0.6B Q4 量化，约 462 MB）。仅接管日常聊天；睡眠小结始终由规则引擎完成；命中自伤或药物处方疑问时安全护栏优先于模型。'}
              </p>

              {/* 上次崩溃警告 */}
              {llmCrashNote && provider === 'local_llm' && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-[11px] text-amber-200 leading-relaxed">
                  ⚠️ {llmCrashNote}
                </div>
              )}

              {/* 设备支持性 */}
              {llmSupport && (
                <div
                  className={`p-3 rounded-xl border text-[11px] leading-relaxed ${
                    llmSupport.supported
                      ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                      : 'bg-amber-950/30 border-amber-800/60 text-amber-300/90'
                  }`}
                >
                  {llmSupport.supported ? (
                    <>
                      ✓ 设备满足运行要求（内存档位 {llmSupport.deviceMemoryGB ?? '未知'}GB，可用存储{' '}
                      {llmSupport.freeStorageGB !== null ? `${llmSupport.freeStorageGB.toFixed(1)}GB` : '未知'}）
                    </>
                  ) : (
                    <>⚠ 本设备不建议启用：{llmSupport.reason}。聊天仍可使用规则引擎档位。</>
                  )}
                </div>
              )}
              {!llmSupport && !llmError && (
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700 text-[11px] text-slate-400">
                  正在检测设备支持性...
                </div>
              )}

              {/* 错误信息 */}
              {llmError && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-[11px] text-rose-200 leading-relaxed">
                  ❌ {llmError}
                </div>
              )}

              {/* HF 门控模型令牌（仅原生） */}
              {isNativeLlmAvailable() && (
                <div className={`p-3 rounded-xl bg-[#0a0f1d] border border-slate-700 space-y-2`}>
                  <span className="text-[11px] font-bold text-white block">HuggingFace 访问令牌（首次下载需要）</span>
                  <input
                    type="password"
                    value={hfTokenVal}
                    onChange={(e) => {
                      setHfTokenVal(e.target.value);
                      setHfToken(e.target.value);
                    }}
                    placeholder="hf_xxxxxxxxxxxx"
                    className="w-full bg-[#0a0f1d] border border-slate-600 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                  />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Gemma 为门控模型：在 huggingface.co 登录 → 打开 litert-community/gemma-3-1b-it →
                    同意许可 → Settings → Access Tokens 生成只读令牌粘贴于此。令牌仅保存在本机。
                  </p>
                </div>
              )}

              {/* 下载管理 */}
              <div className={`p-3 rounded-xl bg-[#0a0f1d] border border-slate-700 space-y-2`}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-white">模型文件（首次需下载，建议 Wi-Fi）</span>
                  {llmCache?.cached && (
                    <span className="text-emerald-400 font-mono">{(llmCache.cachedBytes / 1024 ** 2).toFixed(0)} MB 已就绪</span>
                  )}
                </div>

                {llmProgress !== null ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-[11px] text-slate-300">
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                        正在下载端侧模型...
                      </span>
                      <button
                        type="button"
                        onClick={() => llmAbortRef.current?.abort()}
                        className="text-slate-400 hover:text-white underline cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div style={{ width: `${llmProgress}%` }} className="h-full bg-indigo-500 transition-all duration-300" />
                    </div>
                    <div className="text-right text-xs text-slate-400 font-mono">{llmProgress}%</div>
                  </div>
                ) : llmCache?.cached ? (
                  <button
                    type="button"
                    onClick={handleDeleteLlm}
                    className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-rose-300 font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除模型，释放存储空间</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleDownloadLlm}
                    disabled={llmSupport !== null && !llmSupport.supported}
                    className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold flex items-center justify-center gap-2 shadow cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载端侧模型（约 462 MB）</span>
                  </button>
                )}
              </div>

              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700 text-xs text-slate-400 leading-relaxed">
                ⚡ 性能说明：本引擎在 WebView 内以 WASM 单线程运行（未开跨域隔离），生成速度约每秒几个字，适合睡前从容对话；
                首次对话加载模型需数秒。模型文件缓存在本机私有存储，卸载应用或删除模型即彻底清除。
              </div>
            </div>
          )}

          {/* 2. DeepSeek Form */}
          {provider === 'deepseek' && (
            <div className={`p-4 rounded-2xl ${theme.cardInnerBg} border border-slate-700 space-y-3 text-xs`}>
              <div>
                <label className="text-xs text-white font-bold block mb-1">DeepSeek API Key</label>
                <div className="relative">
                  <input
                    type={showDeepseekKey ? 'text' : 'password'}
                    value={deepseekApiKey}
                    onChange={(e) => setDeepseekApiKey(e.target.value)}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-[#0a0f1d] border border-slate-600 rounded-xl px-3 py-2 text-xs text-white font-mono pr-8 focus:outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                  >
                    {showDeepseekKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-white font-bold">模型版本</label>
                  <button
                    type="button"
                    onClick={handleQueryRemoteModels}
                    disabled={isQueryingModels}
                    className="text-xs text-indigo-300 hover:text-white flex items-center gap-1 font-bold bg-indigo-950 px-2 py-0.5 rounded border border-indigo-700/60 cursor-pointer"
                  >
                    {isQueryingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    <span>查询可用模型</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setDeepseekModel('deepseek-flash')}
                    className={`py-2 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      deepseekModel === 'deepseek-flash'
                        ? 'bg-indigo-600 border-white text-white'
                        : 'bg-[#0a0f1d] border-slate-700 text-slate-300'
                    }`}
                  >
                    ⚡ deepseek-flash
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeepseekModel('deepseek-pro')}
                    className={`py-2 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      deepseekModel === 'deepseek-pro'
                        ? 'bg-indigo-600 border-white text-white'
                        : 'bg-[#0a0f1d] border-slate-700 text-slate-300'
                    }`}
                  >
                    🧠 deepseek-pro
                  </button>
                </div>

                {queriedModels.length > 0 && (
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-700 space-y-1">
                    <span className="text-xs text-slate-400 block">端口支持的模型（点击选用）：</span>
                    <div className="flex flex-wrap gap-1">
                      {queriedModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDeepseekModel(m)}
                          className="px-2 py-0.5 rounded text-xs font-mono bg-indigo-950 text-indigo-200 border border-indigo-700"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {queryError && (
                  <p className="text-xs text-amber-300 mt-1">{queryError}</p>
                )}
              </div>
            </div>
          )}

          {/* 3. Custom OpenAI Form */}
          {provider === 'custom_openai' && (
            <div className={`p-4 rounded-2xl ${theme.cardInnerBg} border border-slate-700 space-y-2 text-xs`}>
              <div>
                <label className="text-xs text-white font-bold block mb-1">接口地址 (Base URL)</label>
                <input
                  type="text"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-[#0a0f1d] border border-slate-600 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="text-xs text-white font-bold block mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showCustomKey ? 'text' : 'password'}
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-[#0a0f1d] border border-slate-600 rounded-xl px-3 py-2 text-xs text-white font-mono pr-8 focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomKey(!showCustomKey)}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                  >
                    {showCustomKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-white font-bold">模型名称 (Model ID)</label>
                  <button
                    type="button"
                    onClick={handleQueryRemoteModels}
                    disabled={isQueryingModels}
                    className="text-xs text-emerald-300 hover:text-white flex items-center gap-1 font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-700 cursor-pointer"
                  >
                    {isQueryingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    <span>查询可用模型</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={customModelName}
                  onChange={(e) => setCustomModelName(e.target.value)}
                  placeholder="如 gpt-4o-mini 或 qwen-plus"
                  className="w-full bg-[#0a0f1d] border border-slate-600 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>
          )}

          {/* AI Persona Prompt */}
          <div className={`p-3 rounded-2xl ${theme.cardInnerBg} border border-slate-700/60 space-y-2`}>
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
              <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
              <span>顾问角色设定 (System Prompt)</span>
            </div>
            <textarea
              rows={2}
              value={systemPersona}
              onChange={(e) => setSystemPersona(e.target.value)}
              placeholder="设定顾问身份与风格..."
              className="w-full bg-[#0a0f1d] border border-slate-600 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400 leading-relaxed"
            />
          </div>

          {/* Privacy & Key Security Notice */}
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 leading-relaxed">
            🛡️ 存储与安全提示：自配的 API Key 以明文形式保存在您当前设备浏览器的 LocalStorage 中，不会上传存储至我们的服务器；请勿在他人共用的公用设备上保存敏感 Key。
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between">
          <div className="text-xs">
            {saveSuccess && (
              <span className="text-emerald-400 flex items-center gap-1 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>已保存！</span>
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
