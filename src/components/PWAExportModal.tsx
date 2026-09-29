import React, { useState } from 'react';
import { Download, Smartphone, X, Check, Share, ExternalLink, Github, Terminal, Copy } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useModalA11y } from '../utils/modalA11y';

interface PWAExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PWAExportModal: React.FC<PWAExportModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedGitCmd, setCopiedGitCmd] = useState(false);
  const [activeTab, setActiveTab] = useState<'quick' | 'github'>('quick');

  const { ref: dialogRef, dialogProps } = useModalA11y({ isOpen, onClose, label: '导出与安装' });

  if (!isOpen) return null;

  const currentUrl = 'https://ais-pre-qqsdcdevp5v3ylegvrg7db-131161072923.asia-southeast1.run.app';
  const gitInitScript = `# 1. 在本地解压源代码
tar -xzf somna-sleep-app-source.tar.gz && cd sleep-app

# 2. 初始化 Git 并推送到您的公开仓库 (睡眠app)
git init
git add .
git commit -m "feat: 初次提交极光睡眠全套开源代码与 Android APK Actions 构建流"
git branch -M main
# 将 YOUR_USERNAME 替换为您的 GitHub 用户名
git remote add origin https://github.com/YOUR_USERNAME/睡眠app.git
git push -u origin main`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(currentUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleCopyGitCmd = () => {
    navigator.clipboard.writeText(gitInitScript).then(() => {
      setCopiedGitCmd(true);
      setTimeout(() => setCopiedGitCmd(false), 2000);
    });
  };

  const handleDirectInstall = async () => {
    const success = await install();
    if (success) {
      onClose();
    }
  };

  return (
    <div
      {...dialogProps}
      ref={dialogRef}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 outline-none"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 text-slate-100 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-indigo-400" />
            <h3 className="text-[17px] font-bold text-white">移动端安装与 GitHub 开源打包</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950/80 rounded-xl mb-4 text-xs">
          <button
            onClick={() => setActiveTab('quick')}
            className={`py-2 rounded-lg font-medium transition-all ${
              activeTab === 'quick'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📱 手机即装即用 (WebAPK)
          </button>
          <button
            onClick={() => setActiveTab('github')}
            className={`py-2 rounded-lg font-medium transition-all ${
              activeTab === 'github'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🐙 GitHub 开源与 APK 构建
          </button>
        </div>

        <div className="space-y-4 text-xs leading-relaxed">
          {activeTab === 'quick' ? (
            <>
              {isInstallable && (
                <button
                  onClick={handleDirectInstall}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-950 transition-all active:scale-98"
                >
                  <Download className="w-4 h-4" />
                  <span>一键直接安装到手机桌面</span>
                </button>
              )}

              {isInstalled ? (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>应用已成功以原生独立形态安装在您的设备上！</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                    <div className="font-semibold text-slate-200 mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>手机直接生成本地独立 App（无需外部工具）</span>
                    </div>
                    <p className="text-slate-400 text-xs mt-1">
                      在安卓手机浏览器（Chrome 或自带浏览器）打开本页面，点击右上角【⋮】选择【添加到主屏幕】或【安装应用】。
                    </p>
                    <div className="mt-2 text-indigo-300/90 text-[11px] bg-indigo-950/40 p-2 rounded-lg border border-indigo-900/50">
                      ✨ 手机系统将通过 Android WebAPK 机制直接在底层生成独立的 APK 原生容器，拥有专属星月图标、独立窗口无地址栏。
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                <div className="font-semibold text-slate-200 mb-1 flex items-center gap-2">
                  <Github className="w-4 h-4 text-indigo-400" />
                  <span>开源至公开仓库「睡眠app」并编译 APK</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  已为您打包好完整的干净源码包，并内置了 <strong>GitHub Actions 自动构建 APK 工作流</strong>（<code>.github/workflows/build-apk.yml</code>）：
                </p>
                
                {/* Steps */}
                <div className="mt-3 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div>
                      <span className="text-slate-300 font-medium">1. 下载全套源码压缩包</span>
                      <p className="text-xs text-slate-400">Mac / Windows 双击直接解压</p>
                    </div>
                    <a
                      href="/somna-sleep-app-source.zip"
                      download="somna-sleep-app-source.zip"
                      className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1 text-xs shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>下载 .ZIP 格式 (146KB)</span>
                    </a>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                    <div className="font-medium mb-1 text-white">2. 在 GitHub 新建公开仓库：</div>
                    <p className="text-slate-400 text-[11px]">
                      访问 <a href="https://github.com/new" target="_blank" rel="noreferrer" className="text-indigo-400 underline inline-flex items-center gap-0.5">github.com/new <ExternalLink className="w-2.5 h-2.5" /></a>，仓库名填写 <code>睡眠app</code>，选择 <strong>Public（公开）</strong>。
                    </p>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-white flex items-center gap-1">
                        <Terminal className="w-3 h-3 text-indigo-400" />
                        <span>3. 一键推送代码</span>
                      </span>
                      <button
                        onClick={handleCopyGitCmd}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                      >
                        {copiedGitCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedGitCmd ? '已复制' : '复制命令'}</span>
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded overflow-x-auto max-h-24">
                      {gitInitScript}
                    </pre>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                    <div className="font-medium text-white">4. 自动生成并下载 APK：</div>
                    <p className="text-slate-400 text-xs mt-0.5">
                      推送到 GitHub 后，仓库的 <strong>Actions</strong> 标签页会自动触发云端打包，完成后在 <strong>Artifacts</strong> 中即可直接点击下载打包好的 <code>.apk</code> 文件！
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Copy Share Link */}
          <div className="pt-2 border-t border-slate-800/80">
            <button
              onClick={handleCopyLink}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-medium flex items-center justify-center gap-2 transition-colors border border-slate-700"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>已复制应用链接</span>
                </>
              ) : (
                <>
                  <Share className="w-4 h-4 text-indigo-400" />
                  <span>复制手机端访问链接</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
