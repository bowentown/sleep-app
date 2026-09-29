package com.somnacare.gemmallm;

import android.os.Build;
import android.content.Intent;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Future;

/**
 * 原生端侧大模型插件：MediaPipe LLM Inference (Gemma .task)。
 *
 * 与 WebView/WASM 方案的本质区别：
 * - 模型文件经 mmap 直接映射（无 MEMFS 双重驻留），峰值内存约为模型体积 + KV 缓存；
 * - 运行在 App 进程的原生层，不受 WebView 渲染进程的内存限制（此前 WASM 方案闪退的根因）；
 * - 下载支持 Bearer 令牌（Gemma 门控模型需要一次性 HF 授权）与断点续传。
 *
 * API 对齐 tasks-genai 0.10.32（经 AAR 反编译核对）：
 * - LlmInference.createFromOptions(Context, LlmInferenceOptions)
 * - LlmInferenceSession.createFromOptions(LlmInference, SessionOptions)
 * - session.generateResponseAsync(ProgressListener<String>)，监听器为 (String partial, boolean done)
 */
@CapacitorPlugin(name = "GemmaLLM")
public class GemmaLLMPlugin extends Plugin {

    private LlmInference llmInference;
    private volatile boolean downloadCancelled = false;
    private static final java.util.concurrent.ExecutorService BACKGROUND =
            java.util.concurrent.Executors.newSingleThreadExecutor();

    // ==== 能力探测与内存门控 ====

    // ==== 主题联动桌面图标（activity-alias） ====

    private static final String PREFS = "somnacare_prefs";
    private static final String KEY_PENDING_ICON = "pending_launcher_icon";
    private volatile String pendingIconTheme;

    /**
     * 主题色切换时请求换图标。注意：绝不能在前台立即改 activity-alias——
     * 禁用"正在运行的 Activity 所属的 alias"会让部分 ROM 强杀进程（每次切主题必闪退）。
     * 这里只记录待应用主题，真正切换延迟到 App 退后台（handleOnPause）时执行，
     * 用户回到桌面时图标已是新主题，即使系统杀进程也发生在后台、无感知。
     */
    @PluginMethod
    public void setLauncherIcon(PluginCall call) {
        String theme = call.getString("theme", "midnight");
        try {
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(KEY_PENDING_ICON, theme).apply();
        } catch (Exception ignored) {
        }
        pendingIconTheme = theme;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("deferred", true);
        call.resolve(ret);
    }

    private void applyLauncherIconNow(String theme) {
        String pkg = getContext().getPackageName();
        PackageManager pm = getContext().getPackageManager();
        String[] themes = {"midnight", "pure_dark", "warm_amber", "serene_blue"};
        String suffix;
        switch (theme) {
            case "pure_dark": suffix = "PureDark"; break;
            case "warm_amber": suffix = "WarmAmber"; break;
            case "serene_blue": suffix = "SereneBlue"; break;
            default: suffix = "Midnight";
        }
        try {
            pm.setComponentEnabledSetting(
                    new ComponentName(pkg, pkg + ".MainActivity" + suffix),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
            for (String t : themes) {
                if (t.equals(theme)) continue;
                String sfx;
                switch (t) {
                    case "pure_dark": sfx = "PureDark"; break;
                    case "warm_amber": sfx = "WarmAmber"; break;
                    case "serene_blue": sfx = "SereneBlue"; break;
                    default: sfx = "Midnight";
                }
                pm.setComponentEnabledSetting(
                        new ComponentName(pkg, pkg + ".MainActivity" + sfx),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
            }
        } catch (Exception ignored) {
            // 别名缺失等场景静默跳过，绝不影响前台体验
        }
    }

    /** App 退到后台：此时切换 alias 最安全（即使 ROM 杀进程，用户已在桌面，无感） */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        try {
            String t = pendingIconTheme;
            if (t == null) {
                t = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .getString(KEY_PENDING_ICON, null);
            }
            if (t != null) {
                applyLauncherIconNow(t);
                pendingIconTheme = null;
                getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit().remove(KEY_PENDING_ICON).apply();
            }
        } catch (Exception ignored) {
        }
    }

    // ==== 护眼滤镜（全局悬浮窗，需"显示在其他应用上层"权限） ====

    /** 查询悬浮窗权限是否已授予。 */
    @PluginMethod
    public void eyeCarePermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", android.provider.Settings.canDrawOverlays(getContext()));
        ret.put("sdkInt", android.os.Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** 跳转系统"显示在其他应用上层"授权页（直接定位到本应用）。 */
    @PluginMethod
    public void eyeCareOpenPermission(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // 个别 ROM 不支持带 package Uri 的授权页，回退到通用设置页
            try {
                android.content.Intent fallback = new android.content.Intent(
                        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        android.net.Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("无法打开授权页: " + e2.getMessage());
            }
        }
    }

    /** 启动/更新护眼滤镜（幂等：服务已运行则原地更新参数，不重建窗口）。 */
    @PluginMethod
    public void eyeCareStart(PluginCall call) {
        String warmColor = call.getString("warmColor", "#FFB26B");
        double warmAlphaIn = call.getDouble("warmAlpha", 0.2);
        double dimAlphaIn = call.getDouble("dimAlpha", 0.0);
        float warmAlpha = (float) Math.min(1.0, Math.max(0.0, warmAlphaIn));
        float dimAlpha = (float) Math.min(1.0, Math.max(0.0, dimAlphaIn));
        if (!android.provider.Settings.canDrawOverlays(getContext())) {
            call.reject("OVERLAY_PERMISSION_REQUIRED");
            return;
        }
        try {
            android.content.Intent intent = new android.content.Intent(getContext(), EyeCareService.class)
                    .setAction(EyeCareService.ACTION_APPLY)
                    .putExtra(EyeCareService.EXTRA_WARM_COLOR, warmColor)
                    .putExtra(EyeCareService.EXTRA_WARM_ALPHA, warmAlpha)
                    .putExtra(EyeCareService.EXTRA_DIM_ALPHA, dimAlpha);
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动护眼滤镜失败: " + e.getMessage());
        }
    }

    /** 停止护眼滤镜：先无条件同步移除滤镜层（保险丝，即使服务路径失败也立刻清屏），再停服务。 */
    @PluginMethod
    public void eyeCareStop(PluginCall call) {
        try {
            EyeCareService.removeOverlay(getContext());
            getContext().getSharedPreferences("somnacare_prefs", Context.MODE_PRIVATE)
                    .edit().putBoolean("eyecare_on", false).apply();
        } catch (Exception ignored) {
        }
        try {
            android.content.Intent intent = new android.content.Intent(getContext(), EyeCareService.class)
                    .setAction(EyeCareService.ACTION_STOP);
            getContext().startService(intent);
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    // ==== 鲸鱼娘桌宠悬浮窗 ====

    /** 悬浮窗权限状态（与护眼滤镜共用同一项系统授权）。 */
    @PluginMethod
    public void petPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", android.provider.Settings.canDrawOverlays(getContext()));
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void petOpenPermission(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                android.content.Intent fallback = new android.content.Intent(
                        android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        android.net.Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("无法打开授权页: " + e2.getMessage());
            }
        }
    }

    /**
     * 启动桌宠，并把 Web 侧算好的文案快照一并写入 SharedPreferences。
     * 原生只读这几行字符串，不解析任何业务数据——睡眠记录仍只活在 WebView 的 localStorage。
     */
    @PluginMethod
    public void petStart(PluginCall call) {
        if (!android.provider.Settings.canDrawOverlays(getContext())) {
            call.reject("OVERLAY_PERMISSION_REQUIRED");
            return;
        }
        try {
            writePetSnapshot(call);
            android.content.Intent intent = new android.content.Intent(getContext(), PetOverlayService.class)
                    .setAction(PetOverlayService.ACTION_START);
            if (Build.VERSION.SDK_INT >= 26) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("启动桌宠失败: " + e.getMessage());
        }
    }

    /** 仅刷新文案快照（服务已在运行时调用，不重建窗口）。 */
    @PluginMethod
    public void petSync(PluginCall call) {
        try {
            writePetSnapshot(call);
            android.content.Intent intent = new android.content.Intent(getContext(), PetOverlayService.class)
                    .setAction(PetOverlayService.ACTION_START);
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("同步桌宠文案失败: " + e.getMessage());
        }
    }

    /** 文案快照 + 播报频率 + 时段/情绪一次性落盘（petStart/petSync 共用）。 */
    private void writePetSnapshot(PluginCall call) {
        int every = 8;
        try {
            Integer e = call.getInt("bubbleEvery");
            if (e != null && e >= 1 && e <= 50) every = e;
        } catch (Exception ignored) {
        }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(PetOverlayService.K_PET_SAY, safe(call, "say", ""))
                .putInt(PetOverlayService.K_BUBBLE_EVERY, every)
                // 时段与情绪也是 Web 侧算好推来的**枚举字符串**，不是睡眠数据本身。
                // 原生只做映射，所以这条"数据不出 WebView"的边界没有被打破。
                .putString(PetOverlayService.K_PET_PHASE, safe(call, "phase", "day"))
                .putString(PetOverlayService.K_PET_MOOD, safe(call, "mood", "plain"))
                // 气泡旁边的表情贴图文件名（同样由 Web 侧选好，原生只按名取图）
                .putString(PetOverlayService.K_PET_STICKER, safe(call, "sticker", ""))
                .apply();
    }

    @PluginMethod
    public void petStop(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(getContext(), PetOverlayService.class)
                    .setAction(PetOverlayService.ACTION_STOP);
            getContext().startService(intent);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    /** 读取 App 上次退出前留在 SharedPreferences 的目标分区（桌宠点击行时写入）。 */
    @PluginMethod
    public void petConsumePendingTab(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.content.SharedPreferences sp =
                    getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String tab = sp.getString(PetOverlayService.K_PENDING_TAB, null);
            if (tab != null) {
                sp.edit().remove(PetOverlayService.K_PENDING_TAB).apply();
            }
            ret.put("tab", tab);
        } catch (Exception ignored) {
            ret.put("tab", (String) null);
        }
        call.resolve(ret);
    }

    private static String safe(PluginCall call, String key, String fallback) {
        String v = call.getString(key, fallback);
        return v == null ? fallback : v;
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("freeMemoryMb", getFreeMemoryMb());
        ret.put("sdkInt", android.os.Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    private long getFreeMemoryMb() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return -1;
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(info);
        return info.availMem / (1024 * 1024);
    }

    // ==== 模型下载（带进度、Bearer 令牌、断点续传、原子落盘、可取消） ====

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename");
        String token = call.getString("token", "");
        if (url == null || filename == null || filename.isEmpty()) {
            call.reject("url 与 filename 必填");
            return;
        }
        downloadCancelled = false;
        final String fToken = (token == null || token.trim().isEmpty()) ? null : token.trim();

        BACKGROUND.execute(() -> {
            File finalFile = new File(getContext().getFilesDir(), filename);
            File tempFile = new File(getContext().getFilesDir(), filename + ".part");
            long existing = tempFile.exists() ? tempFile.length() : 0L;

            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                if (fToken != null) conn.setRequestProperty("Authorization", "Bearer " + fToken);
                if (existing > 0) conn.setRequestProperty("Range", "bytes=" + existing + "-");

                int code = conn.getResponseCode();
                if (code == 416) { // 断点续传越界 = 文件已下完
                    if (!tempFile.renameTo(finalFile)) {
                        throw new IOException("重命名临时文件失败");
                    }
                    resolveDownloaded(call, finalFile);
                    return;
                }
                if (code < 200 || code >= 300) {
                    conn.disconnect();
                    call.reject("下载源响应异常 (HTTP " + code + ")");
                    return;
                }

                long total = conn.getContentLengthLong();
                boolean resume = code == 206 && existing > 0;
                long base = resume ? existing : 0;
                if (!resume && tempFile.exists()) tempFile.delete();

                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(tempFile, resume);
                byte[] buf = new byte[64 * 1024];
                long loaded = base;
                int lastPercent = -1;
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (downloadCancelled) {
                        in.close();
                        out.close();
                        conn.disconnect();
                        tempFile.delete();
                        call.reject("下载已取消");
                        return;
                    }
                    loaded += n;
                    out.write(buf, 0, n);
                    if (total > 0) {
                        int percent = (int) Math.min(99, ((loaded * 100) / total));
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject p = new JSObject();
                            p.put("loaded", loaded);
                            p.put("total", total);
                            p.put("percent", percent);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                out.flush();
                out.close();
                in.close();
                conn.disconnect();

                if (finalFile.exists()) finalFile.delete();
                if (!tempFile.renameTo(finalFile)) {
                    throw new IOException("下载完成后重命名失败");
                }

                JSObject p = new JSObject();
                p.put("percent", 100);
                p.put("path", finalFile.getAbsolutePath());
                notifyListeners("downloadProgress", p);
                resolveDownloaded(call, finalFile);
            } catch (Exception e) {
                if (!downloadCancelled) tempFile.delete();
                call.reject("下载失败: " + e.getMessage());
            }
        });
    }

    private void resolveDownloaded(PluginCall call, File f) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("path", f.getAbsolutePath());
        ret.put("size", f.length());
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancelled = true;
        call.resolve();
    }

    @PluginMethod
    public void isModelDownloaded(PluginCall call) {
        String filename = call.getString("filename");
        File f = new File(getContext().getFilesDir(), filename);
        JSObject ret = new JSObject();
        ret.put("downloaded", f.exists() && f.length() > 0);
        ret.put("size", f.exists() ? f.length() : 0);
        ret.put("path", f.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String filename = call.getString("filename");
        File f = new File(getContext().getFilesDir(), filename);
        unloadInternal();
        JSObject ret = new JSObject();
        ret.put("deleted", !f.exists() || f.delete());
        call.resolve(ret);
    }

    // ==== 加载与流式生成 ====

    @PluginMethod
    public void loadModel(PluginCall call) {
        String filename = call.getString("filename");
        int maxTokens = call.getInt("maxTokens", 1024);
        File f = new File(getContext().getFilesDir(), filename);
        if (!f.exists() || f.length() == 0) {
            call.reject("模型文件不存在，请先下载");
            return;
        }
        try {
            unloadInternal();
            Context context = getContext();
            LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                    .setModelPath(f.getAbsolutePath())
                    .setMaxTokens(maxTokens)
                    .setPreferredBackend(LlmInference.Backend.CPU)
                    .build();
            llmInference = LlmInference.createFromOptions(context, options);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("freeMemoryMb", getFreeMemoryMb());
            call.resolve(ret);
        } catch (Exception e) {
            unloadInternal();
            call.reject("模型加载失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void generate(PluginCall call) {
        JSArray messages = call.getArray("messages");
        if (llmInference == null) {
            call.reject("模型尚未加载");
            return;
        }
        if (messages == null) {
            call.reject("messages 必填");
            return;
        }
        BACKGROUND.execute(() -> {
            StringBuilder full = new StringBuilder();
            LlmInferenceSession session = null;
            try {
                // 每轮生成使用全新 session（JS 侧每次都传完整历史，避免原生上下文无界增长）
                LlmInferenceSession.LlmInferenceSessionOptions sessionOptions =
                        LlmInferenceSession.LlmInferenceSessionOptions.builder()
                                .setTemperature(0.7f)
                                .setTopK(40)
                                .build();
                session = LlmInferenceSession.createFromOptions(llmInference, sessionOptions);

                for (Object o : messages.toList()) {
                    if (o instanceof JSObject) {
                        String content = ((JSObject) o).getString("content", "");
                        if (content != null && !content.isEmpty()) session.addQueryChunk(content);
                    }
                }

                Future<String> future = session.generateResponseAsync((String partial, boolean done) -> {
                    JSObject p = new JSObject();
                    p.put("text", partial == null ? "" : partial);
                    p.put("done", done);
                    notifyListeners("llmToken", p);
                });
                String result = future.get();
                if (result != null) full.append(result);
                JSObject ret = new JSObject();
                ret.put("text", full.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("生成失败: " + e.getMessage());
            } finally {
                try {
                    if (session != null) session.close();
                } catch (Exception ignored) {
                }
            }
        });
    }

    @PluginMethod
    public void unload(PluginCall call) {
        unloadInternal();
        call.resolve();
    }

    private void unloadInternal() {
        try {
            if (llmInference != null) llmInference.close();
        } catch (Exception ignored) {
        }
        llmInference = null;
    }

    @Override
    protected void handleOnDestroy() {
        // 应用销毁时释放原生资源
        unloadInternal();
        super.handleOnDestroy();
    }
}
