<div align="center">

<img src="native-resources/icon-512.png" width="120" alt="极光睡眠 SomnaCare 图标" />

# 极光睡眠 SomnaCare

**懂睡眠，更懂你。**

一款 100% 离线优先的 Android 睡眠记录与分析应用 · React 19 + Capacitor 8 原生封装

[![Build APK](https://github.com/bowentown/somnacare/actions/workflows/build-apk.yml/badge.svg)](../../actions/workflows/build-apk.yml)
[![Release](https://img.shields.io/badge/下载-最新%20Release-blue)](../../releases/latest)

</div>

---

## ✨ 功能总览

应用共五个分区（底栏切换）：

| 分区 | 功能 |
|---|---|
| 🌙 **睡眠** | 一键就寝 / 醒来记录；实时床头监测（真实麦克风环境声级采样 + 频谱可视化，本地 RMS→dBFS 计算，不上传任何音频）；睡眠分期图表；晨间总结与醒来心情 |
| 📊 **趋势** | 7 天睡眠时长 / 评分趋势图、90 分钟睡眠周期推演图（分级色块）、逐条记录管理与删除 |
| ✨ **AI 顾问** | 睡眠医学风格评估 + 对话式咨询。支持三种引擎：**DeepSeek 云端 API**（填自己的 Key）、**端侧离线模型**（wllama + Qwen3-0.6B 或原生 MediaPipe + Gemma 3 1B int4）、**纯本地规则引擎**（零配置离线兜底） |
| 👁 **护眼** | 全局护眼滤镜（SYSTEM_ALERT_WINDOW 悬浮窗，所有应用上方生效）：暖色减蓝光 + 屏幕减光双层，四场景预设（夜间 / 阅读 / 游戏 / 助眠）+ 自定义调色盘，定时开关支持跨午夜时段，通知栏一键关闭 |
| ⚙️ **偏好** | 四套主题（午夜蓝 / 纯黑 / 暖琥珀 / 宁静青绿，**桌面图标随主题联动换色**）、自定义闹钟（温和铃声 / 旋律，原生精确闹钟通道 + 30 秒渐弱钟声）、作息目标三字段联动编辑器、数据备份导入导出、PWA 导出 |

**其他特性**

- 🎨 Honor 风格三段式品牌开屏动画（水滴 → 月亮顺时针渲染 → 极光 + slogan）
- 🔊 五种 Web Audio 实时合成的助眠音（雨声 / 海浪 / 夜林虫鸣 / 粉噪音 / 颂钵），无任何音频文件下载
- 🌐 PWA 可安装版（桌面浏览器访问 dist 部署即可）
- 📴 断网可用：核心功能全部本地运行

## 📱 下载安装

**方式一（推荐）：GitHub Release 直链** —— 无需登录 GitHub：

1. 打开 [Releases 页面](../../releases/latest)；
2. 下载 `SomnaCare-vX.X.X-debug.apk`；
3. 手机上点开安装（需允许"安装未知来源应用"）；
4. 若之前装过旧版本，**请先卸载再安装**（桌面启动器会缓存旧图标）。

> 说明：APK 为 debug 签名（CI 自动构建），适合个人与朋友间分发；上架应用商店需自行配置正式签名。

**方式二：自己动手构建** —— 见下方[构建](#️-构建与开发)章节。

## 🔒 隐私与数据说明（诚实声明）

- **所有睡眠数据只存在手机本地**（WebView localStorage），无任何账号系统，不上传服务器；
- 睡眠分期是**基于作息起止点与 90 分钟超昼夜节律的科学模型推演值**——App 未读取体动 / 脑波传感器，各期时长与占比为估算值，界面上均已标注，**不能替代多导睡眠监测（PSG）等临床检测，不构成医疗建议**；
- 使用云端 AI 顾问需要**你自己的** DeepSeek API Key（存在本地，仅用于直连 DeepSeek 官方接口）；不填 Key 也能用端侧模型或纯本地规则引擎；
- 护眼滤镜需要系统"显示在其他应用上层"权限；全局滤镜的透明度按 Android 12+ 规范控制在触摸穿透豁免范围内，不影响任何应用的正常操作。

## 🔐 权限用途一览

| 权限 | 用途 |
|---|---|
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | 闹钟精确唤醒 |
| `POST_NOTIFICATIONS` | 闹钟响铃通道 / 护眼常驻通知 |
| `WAKE_LOCK` | 息屏后维持响铃流程 |
| `RECORD_AUDIO` | 仅"床头监测"页的环境声级采样（用户点击开启，可拒绝，拒绝后该功能诚实降级） |
| `RECEIVE_BOOT_COMPLETED` | 预留：重启后恢复闹钟调度 |
| `SYSTEM_ALERT_WINDOW` | 护眼全局滤镜悬浮窗（用户在系统设置中主动授权） |
| `FOREGROUND_SERVICE(+SPECIAL_USE)` | 护眼滤镜前台服务常驻 |

## 🧬 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS，Web Audio API 实时合成音效，手写 PNG/SVG 生成器产出全套品牌视觉（`tools/` 目录）
- **原生封装**：Capacitor 8（minSdk 24），GitHub Actions 全自动出包
- **端侧 LLM**：
  - Web 路径：[wllama](https://github.com/transformersjs/wllama)（llama.cpp WASM）+ Qwen3-0.6B GGUF，Cache API 自管理存储；
  - 原生路径：自定义 Capacitor 插件 [`plugins/cap-gemma-llm`](plugins/cap-gemma-llm) 封装 Google **MediaPipe LLM Inference**（Gemma 3 1B int4 `.task`，mmap 加载，支持断点续传 / Bearer 令牌 / 流式生成）；
- **护眼滤镜**：自定义前台服务 + `TYPE_APPLICATION_OVERLAY` 双悬浮层（暖色 + 减光），窗口级 alpha 按 Android 12+ 非信任触摸豁免规范控制，真实物理分辨率全屏覆盖

## 🏗️ 项目结构

```
somnacare/
├── src/
│   ├── components/        # 五大分区 UI、开屏动画、闹钟管理、声音播放器等
│   ├── utils/             # 睡眠评分/分期推演、临床规则引擎、端侧 LLM 引擎、
│   │                      # 原生闹钟调度、护眼滤镜、主题系统
│   └── types/             # 领域模型
├── server.ts              # 本地 AI 代理（DeepSeek/Gemini），含 SSRF 白名单
├── ssrfGuard.ts           # 自定义服务端地址的 SSRF 校验（独立模块以便被自检覆盖）
├── plugins/cap-gemma-llm/ # 本地 Capacitor 插件（MediaPipe Gemma + 护眼服务 + 图标切换）
├── tools/                 # 图标/启动屏 PNG 生成器、manifest 注入脚本、
│                          # verify-invariants.mts（数据不变量与安全断言）
├── native-resources/      # 全密度图标、自适应前景、四主题图标、启动屏、铃声
├── public/                # PWA 图标
└── .github/workflows/     # CI：自动构建 APK；打 v* tag 自动发 Release
```

## 🛠️ 构建与开发

```bash
# 本地开发（浏览器）
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000

# 构建 Web 产物
npm run build

# Android APK（需要 Android SDK / JDK 21）
npm run build && npx cap add android && npx cap sync android
cd android && ./gradlew assembleDebug
```

**不想配环境？** 推送代码到 `main` 分支，GitHub Actions 会自动构建 APK（Actions 页面下载，需登录）；**打一个 `v*` 标签**（如 `v1.0.1`）则会自动构建并发布到公开的 [Releases](../../releases)，任何人无需登录即可下载。

## ✅ 数据一致性自检

睡眠记录里有若干**必须恒成立**的字段关系。任何一条录入路径（床头实时记录 / 手动补录 / 一键记录 / 演示数据 / 备份导入）只要违反其中一条，图表和评分就会自相矛盾。这些关系已写成可执行断言：

```bash
npm run verify         # 数据不变量 + SSRF 断言 + 渲染层断言 + 分期配色（无需浏览器、无需网络）
npm run verify:data    # 只跑数据/安全断言
npm run verify:render  # 只跑渲染层断言（SSR 出 HTML 后直接校验其中的数值）
npm run verify:colors  # 只跑分期配色的可分辨性（CIEDE2000 + 红/绿色盲模拟）
npm run check          # tsc --noEmit && verify && vite build && verify:theme，提交前跑这个
```

四层断言各管一件事，缺一不可：

- **数据层**（`tools/verify-invariants.mts`）：记录内部字段必须自洽。
- **渲染层**（`tools/verify-render.mts`）：把组件渲染成 HTML 后校验其中的数值。
  数据自洽不等于图画对了——真实案例是睡眠结构堆叠条用总睡眠做分母去划分
  含「清醒」的四段，四段之和超过 100% 被 `overflow-hidden` 裁掉：数据全对、
  图是错的，只有渲染层断言能抓到。
- **配色层**（`tools/verify-stage-colors.mts`）：四个睡眠阶段的颜色必须在正常
  视觉、绿色盲、红色盲下都能两两分开。旧配色在绿色盲下浅睡与 REM 的色差只有
  ΔE00 7.2、红色盲下 0.7，肉眼在正常视觉下看不出来。配色不能靠眼睛挑，要按色差算。
- **构建产物层**（`tools/verify-theme-classes.mts`，**必须在 `vite build` 之后跑**）：
  Tailwind 里不存在的类名不会报错，只会静默生成不出 CSS。真实案例是
  `border-slate-850`（Tailwind 4 的 slate 只有 800/900），失效后 `border-color`
  回退成 `currentColor`，本该「几乎看不见的深色描边」在屏幕上成了纯白描边。

**睡眠分期配色只有一处定义**：`src/utils/sleepStageColors.ts`。这四段是数据的
编码而非界面装饰，所以**不跟随主题换色**。曾经趋势页的「深睡」用的是主题色，
导致同一阶段在四个主题下分别是靛蓝/浅灰/黄/青，其中「静谧深海」主题的深睡
（青）与浅睡（天蓝）几乎分不出来。

约定（与临床/科研口径一致）：

| 记号 | 含义 | 在本项目中的字段 |
| --- | --- | --- |
| TIB | 卧床时长 = 起床 − 上床 | 由 `bedtime`/`wakeTime` 推出，**不是**持久化字段 |
| TST | 总睡眠时长 = 深睡 + 浅睡 + REM | `durationMinutes` |
| SOL | 入睡潜伏期 | `latencyMinutes`（**包含在** `awakeMinutes` 内） |
| WASO | 入睡后清醒 | `awakeMinutes − latencyMinutes` |
| SE | 睡眠效率 = TST / TIB | `sleepEfficiency` |

因此恒有：`分期总和 === durationMinutes + awakeMinutes === TIB`，且 `wakeCount` 必须等于分期中觉醒段数减一（首段为入睡潜伏期）。

所有记录都必须经 `src/utils/sleepRecord.ts` 的 `buildSleepRecord()` 构造——它是唯一入口，负责推导上述全部字段，避免各处手写导致口径漂移。**不要在组件里手拼 `SleepRecord` 字面量。**

## ⚠️ 免责声明

本项目为个人作品，仅供学习与个人使用。所有睡眠分析结果均为模型估算值，不构成医疗诊断或治疗建议；如有睡眠障碍请咨询专业医生。

## 📄 License

[MIT](LICENSE)
