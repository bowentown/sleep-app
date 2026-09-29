package com.somnacare.gemmallm;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.view.View;

import java.util.Random;

/**
 * 鲸鱼娘精灵图动画视图。
 *
 * 素材与播放参数取自 whale-girl-plus（署名链与使用限制见 assets/pet/NOTICE.md）：
 * 每张 sheet 横向等分帧、单帧 256×256 RGBA 透明背景，fps/帧数/播放模式来自上游
 * manifest.json。
 *
 * 状态优先级从高到低：拖拽 drag > 播报 talking > 定时片段 hold（庆祝/唤醒/报错）
 * > 时段 rest（深夜 sleep / 午后 nap / 清晨 wakeup / 其余 idle）> 待机小动作。
 * 待机时由 {@link ambientTick} 随机插入小动作（歪头/喝茶/看书/抱枕头/吃东西/
 * 玩耍/散步/工作…），每段几秒后回到当前时段的 rest，避免"只会眨眼"。
 *
 * ★ 上游 manifest 里的 `playback=once` 与 `motion=shake` 原实现**没有**处理，
 * 会让声明为 once 的图无限循环、声明为 shake 的图不抖。本类已补上这两项，
 * 因为 error/wake 正是靠它们表达"一次性"。
 */
public class WhaleGirlView extends View {
    /**
     * 时段枚举。**取值顺序必须与 `src/utils/petOverlay.ts` 的 `PET_PHASE_ORDER` 一致**，
     * `tools/verify-pet.mts` 会比对两边的顺序，改一边不改另一边就红。
     */
    public static final int PHASE_DAWN = 0, PHASE_DAY = 1, PHASE_NOON = 2,
                            PHASE_AFTERNOON = 3, PHASE_DUSK = 4, PHASE_NIGHT = 5;
    /** 情绪枚举。顺序同样与 `PET_MOOD_ORDER` 一致。 */
    public static final int MOOD_PLAIN = 0, MOOD_GOOD = 1, MOOD_LOW = 2;

    private static final String DIR = "pet/";
    private static final long TICK_MS = 33; // ~30fps 重绘节拍
    private static final long BLINK_CYCLE_MS = 3400;
    // 小动作节奏：待机歇 25-60s 才来一段，一段播 6-12s——切换太频繁会显得怪异不流畅
    private static final int IDLE_PAUSE_MIN = 25000;
    private static final int IDLE_PAUSE_VAR = 35000;
    private static final int AMBIENT_MIN = 6000;
    private static final int AMBIENT_VAR = 6000;

    /** 一个状态的素材与播放参数（参数抄自上游 manifest.json）。 */
    private static final class Anim {
        final Bitmap sheet;
        final int frames;
        final long frameMs;
        final boolean blink;
        final boolean pingpong;
        /** 上游 playback=once：播到末帧就停住，不再回卷。 */
        final boolean once;
        /** 上游的 motion 字段：think=float（上下漂），wait=wiggle（小幅摇摆）。 */
        final boolean floatMotion;
        final boolean wiggleMotion;
        /** 上游 motion=shake：短促左右抖（用于 error）。 */
        final boolean shakeMotion;

        Anim(Bitmap sheet, int frames, int fps, String playback, String motion) {
            this.sheet = sheet;
            this.frames = Math.max(1, frames);
            this.frameMs = Math.max(80, 1000L / Math.max(1, fps));
            this.blink = "blink".equals(playback);
            this.pingpong = "pingpong".equals(playback);
            this.once = "once".equals(playback);
            this.floatMotion = "float".equals(motion);
            this.wiggleMotion = "wiggle".equals(motion);
            this.shakeMotion = "shake".equals(motion);
        }
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Random rng = new Random();
    private final Rect src = new Rect();
    private final RectF dst = new RectF();

    private final Anim idle, joy, celebrate, sleep, drag, welcome;
    private final Anim headtilt, wait, think, reading, tea, pillow, eat, play, walk, party, working;
    /** 时段/情绪专用：午后 nap、清晨 wakeup、唤醒瞬间 wake、低落 disappointed、失败 error。 */
    private final Anim nap, wakeup, wake, disappointed, error;
    private final Anim[] ambient;   // 待机小动作池
    private final Anim[] cheers;    // 庆祝池

    private Anim current;
    private long stateSince;
    private long holdUntil;         // 定时片段（庆祝/唤醒/报错）播到这个时刻
    private Anim holdNext;          // 定时片段结束后回落到哪张图（null = 回当前时段的 rest）
    private long ambientUntil;      // 小动作播到这个时刻
    private boolean talking;
    private float drowsy;
    /** 当前时段该播的"休息"图（深夜 sleep / 午后 nap / 清晨 wakeup / 其余 idle）。 */
    private Anim rest;
    private int phase = PHASE_DAY;
    private int mood = MOOD_PLAIN;
    private boolean dragging;
    private boolean running;
    private boolean resumed;        // 小动作调度是否在跑

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            invalidate();
            main.postDelayed(this, TICK_MS);
        }
    };

    private final Runnable ambientTick = new Runnable() {
        @Override public void run() {
            if (!resumed || ambient.length == 0) return;
            long now = System.currentTimeMillis();
            if (now >= ambientUntil) {
                if (dragging || talking) {
                    ambientUntil = now + 5000;   // 拖拽/说话由各自的收尾逻辑接管
                } else if (current != idle && current != rest) {
                    // 欢迎/小动作/庆祝播完 → 回待机，长歇一段随机时长再出发
                    pick(idle);
                    ambientUntil = now + IDLE_PAUSE_MIN + rng.nextInt(IDLE_PAUSE_VAR);
                } else if (rest != null && rest != idle) {
                    ambientUntil = now + 15000;  // 深夜困倦/午后打盹时不折腾，安静待着
                } else {
                    // 待机歇够了 → 随机来一段小动作
                    Anim next = ambient[rng.nextInt(ambient.length)];
                    if (next != null) {
                        pick(next);
                        ambientUntil = now + AMBIENT_MIN + rng.nextInt(AMBIENT_VAR);
                    }
                }
            }
            main.postDelayed(this, 500);
        }
    };

    public WhaleGirlView(Context c) {
        super(c);
        idle      = load(c, "idle", 3, 2, "blink", null);
        joy       = load(c, "joy", 2, 5, "loop", null);
        celebrate = load(c, "celebrate", 3, 4, "loop", null);
        sleep     = load(c, "sleep", 2, 1, "loop", null);
        drag      = load(c, "drag", 1, 5, "loop", "tilt");
        welcome   = load(c, "welcome", 2, 3, "loop", null);

        headtilt  = load(c, "headtilt", 2, 2, "loop", null);
        wait      = load(c, "wait", 1, 2, "loop", "wiggle");
        think     = load(c, "think", 1, 2, "loop", "float");
        reading   = load(c, "reading", 2, 2, "loop", null);
        tea       = load(c, "tea", 3, 2, "loop", null);
        pillow    = load(c, "pillow", 2, 1, "loop", null);
        eat       = load(c, "eat", 3, 8, "loop", null);
        play      = load(c, "play", 3, 4, "loop", null);
        walk      = load(c, "walk", 3, 6, "pingpong", null);
        party     = load(c, "party", 3, 4, "loop", null);
        working   = load(c, "working", 3, 3, "loop", null);

        // 时段与情绪专用（由 Web 侧算好推来，见 setPhase/setMood）
        nap          = load(c, "nap", 2, 1, "loop", null);
        wakeup       = load(c, "wakeup", 3, 2, "loop", null);
        wake         = load(c, "wake", 2, 3, "once", null);
        disappointed = load(c, "disappointed", 2, 2, "loop", null);
        error        = load(c, "error", 2, 8, "once", "shake");

        rest = idle;

        ambient = buildPool(headtilt, wait, think, reading, tea, pillow, eat, play, walk, working);
        cheers = buildPool(celebrate, party, joy);

        current = welcome != null ? welcome : idle;
        stateSince = System.currentTimeMillis();
        ambientUntil = stateSince + 6000;   // 先让 welcome 播完再进待机节奏
    }

    private static Anim[] buildPool(Anim... list) {
        int n = 0;
        for (Anim a : list) if (a != null) n++;
        Anim[] out = new Anim[n];
        int i = 0;
        for (Anim a : list) if (a != null) out[i++] = a;
        return out;
    }

    private static Anim load(Context c, String name, int frames, int fps, String playback, String motion) {
        try {
            Bitmap b = BitmapFactory.decodeStream(c.getAssets().open(DIR + name + ".png"));
            if (b == null) return null;
            return new Anim(b, frames, fps, playback, motion);
        } catch (Exception e) {
            return null;
        }
    }

    public void start() {
        if (running) return;
        running = true;
        resumed = true;
        main.postDelayed(tick, TICK_MS);
        main.postDelayed(ambientTick, 500);
    }

    public void stop() {
        running = false;
        resumed = false;
        main.removeCallbacks(tick);
        main.removeCallbacks(ambientTick);
    }

    /**
     * 播一段定时片段，到点回落到 `next`（null = 回当前时段的休息图）。
     *
     * 庆祝、唤醒瞬间、报错这三件事原本各写一套计时器；这里合并成一个，
     * 因为"播 X 毫秒然后回常态"只有一个正确做法。
     */
    private void pickHold(Anim a, long ms, Anim next) {
        if (a == null) return;
        holdNext = next;
        holdUntil = System.currentTimeMillis() + ms;
        pick(a);
    }

    /** 片段结束后该显示的图：显式指定的 next，否则当前时段的 rest，再否则 idle。 */
    private Anim restAfterHold() {
        if (holdNext != null) return holdNext;
        if (rest != null) return rest;
        return idle;
    }

    /** 庆祝：点角色、开关注护眼时随机来一段，播约 1.8s 回常态。 */
    public void cheer() {
        if (cheers.length == 0) return;
        pickHold(cheers[rng.nextInt(cheers.length)], 1800L, null);
    }

    /**
     * 设置时段（{@link #PHASE_DAWN}…{@link #PHASE_NIGHT}）。
     *
     * ★ 时段由 Web 侧算好推来，而不是原生读系统时钟。原来这里是
     * `h >= 23 || h < 6` 一个二分开关，一天里只有 sleep 和 idle 两张图；
     * 现在切成 6 段。交给 Web 侧算的理由和"睡眠数据不出 WebView"是同一条：
     * 时间语义只在一个地方定义，加一段不需要动原生。
     */
    public void setPhase(int p) {
        boolean enteringDawn = p == PHASE_DAWN && phase != PHASE_DAWN;
        phase = p;
        rest = p == PHASE_NIGHT ? sleep
             : p == PHASE_NOON  ? nap
             : p == PHASE_DAWN  ? wakeup
             : idle;
        if (rest == null) rest = idle;
        drowsy = p == PHASE_NIGHT ? 0.85f : 0f;
        if (dragging || talking || holdUntil != 0) return;
        if (enteringDawn) {
            // 清晨第一次进来：先播一次"唤醒瞬间"（once），再落到 wakeup
            pickHold(wake, 1400L, rest);
        } else {
            pick(rest);
        }
    }

    /**
     * 设置情绪（{@link #MOOD_PLAIN}/{@link #MOOD_GOOD}/{@link #MOOD_LOW}）。
     *
     * 只在情绪**发生变化**时反应——`syncPet` 每次数据变动都会推一次，
     * 不判变化的话每存一条记录鲸鱼娘就蹦一下。
     *
     * `MOOD_LOW` 用 disappointed 而不是 error：前者是"替你不高兴"，
     * error 只留给真正的失败（保存失败、授权失败）。
     */
    public void setMood(int m) {
        if (m == mood) return;
        mood = m;
        if (dragging || talking || holdUntil != 0) return;
        if (m == MOOD_LOW && disappointed != null && drowsy <= 0.5f) {
            pick(disappointed);
            ambientUntil = 0;            // 交给 ambientTick 的"归位"分支收尾
        } else if (m == MOOD_GOOD && joy != null) {
            pickHold(joy, 1600L, null);
        }
    }

    /** 报错：保存失败、授权失败时抖一下（2 帧 + shake），约 1.2s 后回常态。 */
    public void showError() {
        pickHold(error, 1200L, null);
    }

    /** 拖拽中切"被拎起来"姿势，松手恢复。 */
    public void setDragging(boolean d) {
        dragging = d;
        if (d) {
            pick(drag);
        } else {
            holdUntil = 0;
            ambientUntil = 0;
            pick(talking ? headtilt : (rest != null ? rest : idle));
        }
    }

    /** 播报顾问内容时的说话神态（歪头），结束传 false。 */
    public void setTalking(boolean t) {
        talking = t;
        if (!dragging) {
            if (t) {
                pick(headtilt != null ? headtilt : idle);
            } else {
                pick(rest != null ? rest : idle);
                ambientUntil = System.currentTimeMillis() + IDLE_PAUSE_MIN;
            }
        }
    }

    private void pick(Anim a) {
        if (a == null || a == current) return;
        current = a;
        stateSince = System.currentTimeMillis();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        super.onDraw(c);
        Anim a = current;
        if (a == null || a.sheet == null || a.sheet.isRecycled()) return;
        long now = System.currentTimeMillis();

        if (!dragging && !talking) {
            // 定时片段（庆祝/唤醒/报错）到点回落常态
            if (holdUntil != 0 && now > holdUntil) {
                holdUntil = 0;
                ambientUntil = 0;
                pick(restAfterHold());
                a = current;
            } else if (ambientUntil == 0 && a != idle && a != rest
                    && a != celebrate && a != party && a != joy) {
                // 小动作被外部打断后落到未知状态 → 归位
                pick(rest != null ? rest : idle);
                a = current;
            }
        }

        int w = getWidth(), h = getHeight();
        if (w == 0 || h == 0) return;

        int fw = a.sheet.getWidth() / a.frames;
        int fh = a.sheet.getHeight();
        int idx = frameIndex(a, now - stateSince);
        src.set(idx * fw, 0, (idx + 1) * fw, fh);

        // 帧是正方形、窗口高>宽：按宽定边、垂直居中
        float side = Math.min(w, h) * 0.97f;
        float cx = w / 2f, cy = h / 2f;

        c.save();
        if (dragging) {
            // 被拎起：轻微左右晃 + 上移一点
            float t = (now % 900) / 900f;
            c.rotate((float) Math.sin(t * Math.PI * 2) * 5f, cx, cy + side * 0.3f);
            c.translate(0, -side * 0.04f);
        } else if (a.shakeMotion) {
            // error：短促左右抖，幅度随时间衰减（配合 once 的 2 帧）
            float k = Math.max(0f, 1f - (now - stateSince) / 1200f);
            c.translate((float) Math.sin((now % 90) / 90f * Math.PI * 2) * side * 0.035f * k, 0);
        } else if (a.wiggleMotion) {
            float t = (now % 1400) / 1400f;
            c.rotate((float) Math.sin(t * Math.PI * 2) * 3.5f, cx, cy + side * 0.35f);
        } else {
            float t = (now % 2600) / 2600f;
            // think=float 漂得更明显些；其余状态保留 ±1.5% 的呼吸浮动
            float amp = a.floatMotion ? 0.045f : 0.015f;
            c.translate(0, (float) Math.sin(t * Math.PI * 2) * side * amp);
        }
        dst.set(cx - side / 2f, cy - side / 2f, cx + side / 2f, cy + side / 2f);
        c.drawBitmap(a.sheet, src, dst, paint);
        c.restore();
    }

    /** 按播放模式算当前帧号。 */
    private static int frameIndex(Anim a, long elapsed) {
        if (a.once) {
            // once：播到末帧就停住，不回卷（error 的 shake 衰减以 stateSince 为基准）
            int i = (int) (elapsed / a.frameMs);
            return Math.min(a.frames - 1, i);
        }
        if (a.blink) {
            // idle 的 blink：大部分时间第 0 帧，周期尾端把眨眼帧放出来
            long hold = BLINK_CYCLE_MS - 2 * a.frameMs;
            long ph = elapsed % BLINK_CYCLE_MS;
            if (ph < hold) return 0;
            return Math.min(a.frames - 1, 1 + (int) ((ph - hold) / a.frameMs));
        }
        if (a.pingpong && a.frames > 2) {
            long period = (2L * a.frames - 2) * a.frameMs;
            int i = (int) ((elapsed % period) / a.frameMs);
            return i < a.frames ? i : 2 * a.frames - 2 - i;
        }
        return (int) ((elapsed / a.frameMs) % a.frames);
    }

    @Override
    protected void onDetachedFromWindow() {
        stop();
        super.onDetachedFromWindow();
    }
}
