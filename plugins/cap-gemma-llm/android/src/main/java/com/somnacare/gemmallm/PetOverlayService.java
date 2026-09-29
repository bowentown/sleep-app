package com.somnacare.gemmallm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 大肥鱼桌宠悬浮窗（原型是社区共创的 DeepSeek 蓝色大肥鱼人设）。
 *
 * 交互刻意做得极简（参考 AutoJs6 悬浮窗）：点角色只弹两个圆形按钮——
 * 「消息」看她的傲娇播报、「护眼」就地开关滤镜。没有大卡片、没有成段文字，
 * 长文案只出现在头顶气泡里。气泡与按钮是两个窗口、两套动画。
 *
 * 触摸可达性：本服务是前台服务，满足 Android 12+ "可信触摸"豁免，
 * 因此角色窗可以正常接收事件而不必把窗口整体不透明度抬到 0.78。
 */
public class PetOverlayService extends Service {

    public static final String ACTION_START = "com.somnacare.gemmallm.pet.START";
    public static final String ACTION_STOP = "com.somnacare.gemmallm.pet.STOP";

    private static final String CHANNEL_ID = "somnacare-pet";
    private static final int NOTIFICATION_ID = 20260930;

    private static final String PREFS = "somnacare_prefs";
    // Web 侧推送的播报词库（\n 分隔多条，逐条轮播）；原生只读，不解析业务数据
    static final String K_PET_SAY = "pet_say";
    // 每 N 次点击角色自动播报 1 次，其余点击弹按钮
    static final String K_BUBBLE_EVERY = "pet_bubble_every";
    // 拉起 App 时要落的分区，由 Web 侧写入、App 读取后清除（保留给后续入口用）
    static final String K_PENDING_TAB = "somnacare_pending_tab";
    // Web 侧算好的时段与情绪（枚举字符串，不是睡眠数据）。
    // 原生只把它们映射成精灵图，不解析任何业务字段。
    static final String K_PET_PHASE = "pet_phase";
    static final String K_PET_MOOD = "pet_mood";
    // 气泡旁边的表情贴图文件名（Web 侧选的，原生只按名取图，不认识任何语义）
    static final String K_PET_STICKER = "pet_sticker";

    private static final int COLLAPSED_W_DP = 104;
    private static final int COLLAPSED_H_DP = 122;
    private static final int FAN_BTN_DP = 46;
    private static final int FAN_GAP_DP = 12;
    private static final long BUBBLE_MS = 7000;
    private static final long FEEDBACK_MS = 3200;

    private WindowManager wm;
    private FrameLayout petRoot;
    private FrameLayout fanRoot;
    private WindowManager.LayoutParams fanLp;
    private FrameLayout eyeBtn;
    private WhaleGirlView whale;
    private WindowManager.LayoutParams petParams;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    // ---- 女仆播报气泡（与按钮窗是两个窗口、两种动画）----
    private FrameLayout bubbleRoot;
    private WindowManager.LayoutParams bubbleLp;
    private boolean bubbleShown;
    private int tapCount;
    private int sayIdx;
    private final Runnable bubbleHide = new Runnable() {
        @Override public void run() { hideBubble(); }
    };

    private boolean fanShown;
    private int touchSlop;

    // ---- 拖拽状态 ----
    private int downRawX, downRawY, downWinX, downWinY;
    private boolean dragging;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            boolean on = !Intent.ACTION_SCREEN_OFF.equals(i.getAction());
            if (whale != null) {
                if (on) whale.start(); else whale.stop();
            }
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        ensureChannel();
        startForegroundCompat("点大肥鱼看消息 · 开护眼");
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenReceiver, f);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (petRoot == null) {
            showPet();
        } else {
            // 幂等重启：petSync 走的就是这条路，所以时段/情绪必须在这里刷新，
            // 否则存完一条记录鲸鱼娘要等下一个 5 分钟轮询才换表情。
            applySnapshotState();
            if (fanShown) {
                // 按钮窗开着就刷新护眼键的颜色状态
                updateEyeButton();
            }
        }
        return START_STICKY;
    }

    // ================= 角色窗 =================

    private void showPet() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

            petRoot = new FrameLayout(this);
            whale = new WhaleGirlView(this);
            petRoot.addView(whale, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            whale.start();
            applySnapshotState();

            petParams = new WindowManager.LayoutParams(
                    dp(COLLAPSED_W_DP), dp(COLLAPSED_H_DP),
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    // 只加 NOT_FOCUSABLE：不能抢输入法。刻意不加 FLAG_LAYOUT_NO_LIMITS——
                    // 那个 flag 会把窗口原点推到显示区之外，x/y 就不再是屏幕坐标，
                    // 吸边与贴按钮/气泡的位置计算会整体偏移。
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                    PixelFormat.TRANSLUCENT);
            petParams.gravity = Gravity.TOP | Gravity.START;
            petParams.setTitle("大肥鱼");
            petParams.x = sp.getInt("pet_x", dp(12));
            petParams.y = sp.getInt("pet_y", dp(260));
            clampToScreen(petParams);

            petRoot.setOnTouchListener(new View.OnTouchListener() {
                @Override public boolean onTouch(View v, MotionEvent e) {
                    return handlePetTouch(e);
                }
            });

            wm.addView(petRoot, petParams);
            main.post(snapshotTick);
        } catch (Exception e) {
            petRoot = null;
            whale = null;
            stopSelf();
        }
    }

    private boolean handlePetTouch(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = (int) e.getRawX();
                downRawY = (int) e.getRawY();
                downWinX = petParams.x;
                downWinY = petParams.y;
                dragging = false;
                return true;
            case MotionEvent.ACTION_MOVE: {
                int dx = (int) e.getRawX() - downRawX;
                int dy = (int) e.getRawY() - downRawY;
                if (!dragging && Math.hypot(dx, dy) > touchSlop) {
                    dragging = true;
                    if (whale != null) whale.setDragging(true);
                }
                if (dragging) {
                    // 拖到按钮/气泡开着时先收起，避免窗口错位
                    if (fanShown) hideFan();
                    if (bubbleShown) hideBubble();
                    petParams.x = downWinX + dx;
                    petParams.y = downWinY + dy;
                    clampToScreen(petParams);
                    safeUpdate(petRoot, petParams);
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
                if (dragging) {
                    if (whale != null) whale.setDragging(false);
                    dockToEdge();
                } else if (whale != null) {
                    whale.cheer();
                    if (bubbleShown) {
                        hideBubble();   // 播报期间再点：先收气泡
                    } else {
                        tapCount++;
                        int every = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                .getInt(K_BUBBLE_EVERY, 8);
                        if (every > 0 && tapCount % every == 0) {
                            showBubble(nextSayLine(), BUBBLE_MS);
                        } else if (fanShown) {
                            hideFan();
                        } else {
                            showFan();
                        }
                    }
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                if (dragging) {
                    if (whale != null) whale.setDragging(false);
                    dockToEdge();
                }
                return true;
            default:
                return true;
        }
    }

    /**
     * 从 SharedPreferences 读出 Web 侧推来的时段与情绪并应用。
     *
     * 未知字符串一律降级为 day / plain——宁可显示最中性的状态，
     * 也不要因为一个拼错的值让鲸鱼娘卡在某个表情上。
     */
    private void applySnapshotState() {
        if (whale == null) return;
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        whale.setPhase(phaseOf(sp.getString(K_PET_PHASE, "day")));
        whale.setMood(moodOf(sp.getString(K_PET_MOOD, "plain")));
    }

    /** "dawn"/"noon"/… → {@link WhaleGirlView#PHASE_DAWN} 等。顺序由 verify-pet.mts 与 TS 侧比对。 */
    private static int phaseOf(String s) {
        if ("dawn".equals(s)) return WhaleGirlView.PHASE_DAWN;
        if ("day".equals(s)) return WhaleGirlView.PHASE_DAY;
        if ("noon".equals(s)) return WhaleGirlView.PHASE_NOON;
        if ("afternoon".equals(s)) return WhaleGirlView.PHASE_AFTERNOON;
        if ("dusk".equals(s)) return WhaleGirlView.PHASE_DUSK;
        if ("night".equals(s)) return WhaleGirlView.PHASE_NIGHT;
        return WhaleGirlView.PHASE_DAY;
    }

    private static int moodOf(String s) {
        if ("good".equals(s)) return WhaleGirlView.MOOD_GOOD;
        if ("low".equals(s)) return WhaleGirlView.MOOD_LOW;
        return WhaleGirlView.MOOD_PLAIN;
    }

    /** Web 侧选的贴图文件名（读不到就返回空串，气泡就不带贴图）。 */
    private String currentSticker() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(K_PET_STICKER, "");
    }

    /**
     * 按名从 assets/pet/stickers/ 取贴图。
     *
     * 名字做白名单校验：只允许 `[a-z0-9_-]`，防止 Web 侧传个 `../` 进来读到别的资源。
     * 取不到返回 null——缺一张贴图不该让整条播报失败。
     */
    private android.graphics.drawable.Drawable loadSticker(String name) {
        if (name == null || name.isEmpty()) return null;
        if (!name.matches("[a-z0-9_-]+")) return null;
        try {
            java.io.InputStream in = getAssets().open("pet/stickers/" + name + ".webp");
            android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeStream(in);
            in.close();
            if (bm == null) return null;
            return new android.graphics.drawable.BitmapDrawable(getResources(), bm);
        } catch (Exception e) {
            return null;
        }
    }

    /** 松手后横向吸附到最近的屏幕边缘，再持久化位置。 */
    private void dockToEdge() {
        final int targetX;
        DisplayInfo di = displayInfo();
        int left = dp(4);
        int right = di.width - dp(COLLAPSED_W_DP) - dp(4);
        targetX = (petParams.x + dp(COLLAPSED_W_DP) / 2) < di.width / 2 ? left : right;
        petParams.x = targetX;
        clampToScreen(petParams);
        safeUpdate(petRoot, petParams);
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("pet_x", petParams.x)
                .putInt("pet_y", petParams.y)
                .apply();
    }

    // ================= 按钮窗（AutoJs6 式双圆钮） =================

    private void showFan() {
        if (fanShown) return;
        hideBubble();
        try {
            FrameLayout v = buildFan();
            v.setOnTouchListener((vv, e) -> {
                if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE) hideFan();
                return false;
            });
            fanLp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            fanLp.gravity = Gravity.TOP | Gravity.START;
            fanLp.setTitle("大肥鱼按钮");

            v.measure(View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            placeBeside(v.getMeasuredWidth(), v.getMeasuredHeight());
            wm.addView(v, fanLp);
            fanRoot = v;
            fanShown = true;

            // 逐个带回弹弹出，比面板的整卡滑入轻快
            LinearLayout row = (LinearLayout) v.getChildAt(0);
            for (int i = 0; i < row.getChildCount(); i++) {
                View b = row.getChildAt(i);
                b.setAlpha(0f);
                b.setScaleX(0.2f);
                b.setScaleY(0.2f);
                b.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(i * 55L)
                        .setDuration(210)
                        .setInterpolator(new android.view.animation.OvershootInterpolator(1.8f))
                        .start();
            }
        } catch (Exception e) {
            fanRoot = null;
            fanShown = false;
        }
    }

    private void hideFan() {
        final FrameLayout v = fanRoot;
        fanRoot = null;
        fanShown = false;
        if (v == null) return;
        try {
            v.animate().alpha(0f).scaleX(0.6f).scaleY(0.6f).setDuration(120)
                    .withEndAction(() -> { try { wm.removeView(v); } catch (Exception ignored) { } })
                    .start();
        } catch (Exception e) {
            try { wm.removeViewImmediate(v); } catch (Exception ignored) { }
        }
    }

    private FrameLayout buildFan() {
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(dp(4), dp(4), dp(4), dp(4));   // 给回弹缩放留出窗口内的余量
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        row.addView(fanButton("\uD83D\uDCAC", 0xF22FA8E8, new View.OnClickListener() {
            @Override public void onClick(View v) {
                hideFan();
                showBubble(nextSayLine(), BUBBLE_MS);
            }
        }));

        eyeBtn = fanButton("👁", eyeColor(), new View.OnClickListener() {
            @Override public void onClick(View v) {
                toggleEyeCare();
                if (whale != null) whale.cheer();
                // 服务异步生效，稍等一下再刷新键色与气泡反馈
                main.postDelayed(() -> {
                    updateEyeButton();
                    showBubble(EyeCareService.isActive()
                            ? "护眼滤镜给你开了哦～别再瞪着屏幕啦，鱼片。"
                            : "滤镜关掉了……哼，记得谢本鱼。", FEEDBACK_MS);
                }, 600);
            }
        });
        row.addView(eyeBtn);

        wrap.addView(row, new FrameLayout.LayoutParams(-2, -2));
        return wrap;
    }

    private FrameLayout fanButton(String glyph, int color, View.OnClickListener click) {
        FrameLayout btn = new FrameLayout(this);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        g.setStroke(dp(1), 0x40FFFFFF);
        btn.setBackground(g);
        btn.setOnClickListener(click);
        btn.setContentDescription(glyph);

        TextView t = text(glyph, 18f, 0xFFFFFFFF, false);
        t.setGravity(Gravity.CENTER);
        btn.addView(t, new FrameLayout.LayoutParams(-1, -1));
        return btn;
    }

    private int eyeColor() {
        return EyeCareService.isActive() ? 0xF2B9822B : 0xF237B87B;
    }

    private void updateEyeButton() {
        if (eyeBtn == null || !fanShown) return;
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(eyeColor());
        g.setStroke(dp(1), 0x40FFFFFF);
        eyeBtn.setBackground(g);
    }

    /** 按钮摆位：贴角色左右不遮挡的一侧；放不下挪到角色下/上方。 */
    private void placeBeside(int pw, int ph) {
        DisplayInfo di = displayInfo();
        int wx = petParams.x, wy = petParams.y;
        int ww = dp(COLLAPSED_W_DP), wh = dp(COLLAPSED_H_DP);
        int gap = dp(8), m = dp(4);
        int leftRoom = wx - gap - m;
        int rightRoom = di.width - (wx + ww) - gap - m;
        int px, py;
        if (leftRoom >= pw || rightRoom >= pw) {
            boolean goLeft = leftRoom >= pw && (rightRoom < pw || leftRoom >= rightRoom);
            px = goLeft ? wx - pw - gap : wx + ww + gap;
            py = wy + wh / 2 - ph / 2;
        } else {
            px = wx + ww / 2 - pw / 2;
            boolean belowOk = wy + wh + gap + ph <= di.height - m;
            py = belowOk ? wy + wh + gap : wy - ph - gap;
        }
        fanLp.x = Math.max(m, Math.min(px, di.width - pw - m));
        fanLp.y = Math.max(m, Math.min(py, di.height - ph - m));
    }

    // ================= 大肥鱼播报气泡 =================

    private void showBubble(String msg, long durationMs) {
        try {
            if (bubbleShown && bubbleRoot != null) {
                // 已经在播：只换词、重新计时，不闪窗
                TextView body = bubbleRoot.findViewWithTag("pet_body");
                if (body != null) body.setText(msg);
                ImageView iv = bubbleRoot.findViewWithTag("pet_sticker_view");
                android.graphics.drawable.Drawable d = loadSticker(currentSticker());
                if (iv != null) {
                    if (d != null) { iv.setImageDrawable(d); iv.setVisibility(View.VISIBLE); }
                    else iv.setVisibility(View.GONE);
                }
                main.removeCallbacks(bubbleHide);
                main.postDelayed(bubbleHide, durationMs);
                return;
            }
            FrameLayout v = buildBubble(msg);
            v.setOnTouchListener((vv, e) -> {
                if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE) hideBubble();
                return false;
            });
            v.setOnClickListener(vv -> hideBubble());
            bubbleLp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            bubbleLp.gravity = Gravity.TOP | Gravity.START;
            bubbleLp.setTitle("大肥鱼播报");

            int bw = dp(236);
            v.measure(View.MeasureSpec.makeMeasureSpec(bw, View.MeasureSpec.AT_MOST),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            bw = Math.max(v.getMeasuredWidth(), dp(140));
            int bh = v.getMeasuredHeight();
            DisplayInfo di = displayInfo();
            int m = dp(4), gap = dp(10);
            int cx = petParams.x + dp(COLLAPSED_W_DP) / 2;
            bubbleLp.x = Math.max(m, Math.min(cx - bw / 2, di.width - bw - m));
            int above = petParams.y - bh - gap;
            if (above >= m) bubbleLp.y = above;
            else bubbleLp.y = Math.max(m, Math.min(
                    petParams.y + dp(COLLAPSED_H_DP) + gap, di.height - bh - m));

            // 尾巴对准角色头顶
            View tail = v.findViewWithTag("pet_tail");
            int tailCx = 0;
            if (tail != null) {
                FrameLayout.LayoutParams tlp = (FrameLayout.LayoutParams) tail.getLayoutParams();
                tlp.leftMargin = Math.max(dp(14), Math.min(cx - bubbleLp.x - dp(6), bw - dp(26)));
                tail.setLayoutParams(tlp);
                tailCx = tlp.leftMargin + dp(6);
            }

            wm.addView(v, bubbleLp);
            bubbleRoot = v;
            bubbleShown = true;
            if (whale != null) whale.setTalking(true);
            // 播报动画：从尾巴处带回弹放大弹出
            v.setAlpha(0f);
            v.setPivotX(Math.max(dp(1), tailCx));
            v.setPivotY(bh - dp(10));
            v.setScaleX(0.55f);
            v.setScaleY(0.55f);
            v.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(230)
                    .setInterpolator(new android.view.animation.OvershootInterpolator(1.7f))
                    .start();
            main.postDelayed(bubbleHide, durationMs);
        } catch (Exception e) {
            bubbleRoot = null;
            bubbleShown = false;
        }
    }

    private void hideBubble() {
        main.removeCallbacks(bubbleHide);
        final FrameLayout v = bubbleRoot;
        bubbleRoot = null;
        bubbleShown = false;
        if (whale != null) whale.setTalking(false);
        if (v == null) return;
        try {
            v.animate().alpha(0f).scaleX(0.72f).scaleY(0.72f).setDuration(130)
                    .withEndAction(() -> { try { wm.removeView(v); } catch (Exception ignored) { } })
                    .start();
        } catch (Exception e) {
            try { wm.removeViewImmediate(v); } catch (Exception ignored) { }
        }
    }

    /** 头顶对话气泡：名牌 + 正文 + 指向角色的尾巴。 */
    private FrameLayout buildBubble(String msg, String stickerName) {
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(0, 0, 0, dp(10));   // 给尾巴留出窗口内的空间（窗口会裁掉越界内容）

        View tail = new View(this);
        tail.setTag("pet_tail");
        GradientDrawable tg = new GradientDrawable();
        tg.setColor(0xFF1B2846);
        tg.setCornerRadius(dp(3));
        tail.setBackground(tg);
        tail.setRotation(45f);
        wrap.addView(tail, new FrameLayout.LayoutParams(dp(11), dp(11),
                Gravity.BOTTOM | Gravity.START));

        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR, new int[]{0xFF2A3C63, 0xFF1B2846});
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), 0x36FFFFFF);
        bubble.setBackground(bg);
        bubble.setPadding(dp(14), dp(11), dp(14), dp(12));

        // 表情贴图：有就放气泡最上面。取不到就静默跳过——
        // 一张贴图缺失绝不该让整条播报失败。
        android.graphics.drawable.Drawable sticker = loadSticker(stickerName);
        if (sticker != null) {
            ImageView iv = new ImageView(this);
            iv.setTag("pet_sticker_view");
            iv.setImageDrawable(sticker);
            iv.setAdjustViewBounds(true);
            LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(dp(84), dp(84));
            ilp.bottomMargin = dp(7);
            iv.setLayoutParams(ilp);
            bubble.addView(iv);
        }

        TextView name = text("蓝色大肥鱼 \uD83D\uDC0B", 9.5f, 0xFF7FD8FF, true);
        bubble.addView(name, new LinearLayout.LayoutParams(-2, -2));
        TextView body = text(msg, 12f, 0xFFF2F7FD, false);
        body.setTag("pet_body");
        body.setLineSpacing(dp(2.5f), 1f);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-2, -2);
        blp.topMargin = dp(5);
        bubble.addView(body, blp);

        wrap.addView(bubble, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));
        return wrap;
    }

    /** 轮播取一条播报词。 */
    private String nextSayLine() {
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String[] raw = sp.getString(K_PET_SAY, "").split("\n");
        java.util.List<String> lines = new java.util.ArrayList<>();
        for (String l : raw) {
            l = l.trim();
            if (!l.isEmpty()) lines.add(l);
        }
        if (lines.isEmpty()) return "哼，词库还没装上呢……事已至此，先吃饭吧！";
        String line = lines.get(sayIdx % lines.size());
        sayIdx++;
        return line;
    }

    // ================= 动作 =================

    /**
     * 就地开关护眼滤镜。参数沿用上次应用的值（EyeCareService 已落盘），
     * 因此这里不需要 Web 层参与，也不受定时窗口影响——这是用户显式的手动操作。
     */
    private void toggleEyeCare() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            boolean wasOn = sp.getBoolean("eyecare_on", false) || EyeCareService.isActive();
            Intent i = new Intent(this, EyeCareService.class);
            if (wasOn) {
                i.setAction(EyeCareService.ACTION_STOP);
                sp.edit().putBoolean("eyecare_on", false).apply();
            } else {
                i.setAction(EyeCareService.ACTION_APPLY);
                String color = sp.getString("eyecare_color", null);
                float warm = sp.getFloat("eyecare_warm", 0f);
                float dim = sp.getFloat("eyecare_dim", 0f);
                if (color == null || (warm <= 0.005f && dim <= 0.005f)) {
                    // App 端 apply 的真实参数还没落盘（或已被 STOP 清成 0/null）。
                    // 0/0 会让 EyeCareService 不建任何滤镜层 → 看似开启实际没效果。
                    color = "#FFB26B";
                    warm = 0.22f;
                    dim = 0f;
                }
                i.putExtra(EyeCareService.EXTRA_WARM_COLOR, color);
                i.putExtra(EyeCareService.EXTRA_WARM_ALPHA, warm);
                i.putExtra(EyeCareService.EXTRA_DIM_ALPHA, dim);
                sp.edit().putBoolean("eyecare_on", true).apply();
            }
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        } catch (Exception ignored) {
        }
    }

    /**
     * 每 5 分钟重读一次 Web 侧的时段与情绪。
     *
     * ★ 原来这里是 `h >= 23 || h < 6` 直接读系统时钟。改成重读快照是为了让
     * "时间语义只定义在一个地方"：原生不再自己判断几点算深夜，
     * 万一 Web 侧写了新时段（比如加一段"黄昏"），原生不改也能跟着走。
     * 轮询同时充当兜底：即使某次 petSync 丢了，最多 5 分钟也会自愈。
     */
    private final Runnable snapshotTick = new Runnable() {
        @Override public void run() {
            applySnapshotState();
            main.postDelayed(this, 5 * 60 * 1000L);
        }
    };

    // ================= 通用工具 =================

    private static class DisplayInfo {
        int width, height;
    }

    private DisplayInfo displayInfo() {
        DisplayInfo di = new DisplayInfo();
        try {
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            di.width = dm.widthPixels;
            di.height = dm.heightPixels;
        } catch (Exception ignored) {
            di.width = dp(360);
            di.height = dp(800);
        }
        return di;
    }

    private void clampToScreen(WindowManager.LayoutParams lp) {
        DisplayInfo di = displayInfo();
        lp.x = Math.max(0, Math.min(lp.x, di.width - dp(COLLAPSED_W_DP)));
        lp.y = Math.max(0, Math.min(lp.y, di.height - dp(COLLAPSED_H_DP)));
    }

    private void safeUpdate(View v, WindowManager.LayoutParams lp) {
        try { if (v != null) wm.updateViewLayout(v, lp); } catch (Exception ignored) { }
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void ensureChannel() {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "大肥鱼桌宠", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        } catch (Exception ignored) {
        }
    }

    private void startForegroundCompat(String text) {
        try {
            ensureChannel();
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent pi = launch != null
                    ? PendingIntent.getActivity(this, 4, launch,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : null;
            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification n = b.setSmallIcon(android.R.drawable.ic_menu_compass)
                    .setContentTitle("大肥鱼陪着你")
                    .setContentText(text)
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .build();
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    startForeground(NOTIFICATION_ID, n,
                            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                    return;
                } catch (Exception ignored) { }
            }
            startForeground(NOTIFICATION_ID, n);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(snapshotTick);
        try { unregisterReceiver(screenReceiver); } catch (Exception ignored) { }
        if (whale != null) whale.stop();
        hideBubble();
        hideFan();
        if (petRoot != null) {
            try { wm.removeViewImmediate(petRoot); } catch (Exception ignored) { }
            petRoot = null;
        }
        whale = null;
        super.onDestroy();
    }
}
