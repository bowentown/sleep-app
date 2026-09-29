# NOTICE · 精灵图素材来源与署名

本目录下的 `*.png` 精灵图取自
[Henryang777/whale-girl-plus](https://github.com/Henryang777/whale-girl-plus)
（`.dsh-plugin/assets/characters/whale-girl/`），按其 `NOTICE.md` 的条款
**非商业使用、保留本署名、素材作者要求时下架**分发。

## 署名链

| 内容 | 版权所有人 |
| --- | --- |
| 鲸鱼娘角色形象原作 | 上善无形（Pixiv / Bilibili：上善无形） |
| 加入 DeepSeek 元素的女仆鲸鱼娘二次设计 | ZipZipPipe（Pixiv / Bilibili：ZipZipPipe） |
| 上游插件与自带精灵图 | Sam Gao (vlln) — https://github.com/vlln/whale-girl（MIT，仅代码） |
| 本目录精灵图的整理与部分状态重绘 | Henryang777 — https://github.com/Henryang777/whale-girl-plus |

二次设计作品依 **CC BY-NC-SA 4.0** 授权：非商业使用，二创遵循相同协议。

## 使用限制

- 极光睡眠（SomnaCare）为免费、离线、无广告应用，符合"非商业使用"要求。
- 代码部分按 MIT 使用（须保留上游版权声明）。
- 角色形象与美术素材**禁止商业性使用**；二次分发请保留本文件。
- 若素材作者提出要求，应下架对应素材。

## 本目录实际分发与使用情况

> ★ 这一节是**核对过代码之后写的**。
> 此处原先写"仅取了悬浮窗用到的 6 个状态"，但目录里实际有 18 张、代码用到 17 张——
> **署名文件低报了分发范围**。署名文件的全部意义就是准确，所以这里改为逐张列出，
> 并由 `tools/verify-pet.mts` 在 CI 里核对"表里的行数 == 目录里的 PNG 数"。

共 **22 张**，全部被 `WhaleGirlView.java` / `PetOverlayService.java` 使用（无闲置素材）。
每张 sheet 为**横向等分帧**，**单帧 256×256**、RGBA 透明背景；
帧数可由图片宽度独立验证（`宽 = 帧数 × 256`），CI 里有这条断言。
下表参数取自上游 `manifest.json`，与实测尺寸一致。

| 状态 | 帧 | fps | 播放 | motion | 用途 |
| --- | --- | --- | --- | --- | --- |
| idle | 3 | 2 | blink | — | 默认待机 |
| welcome | 2 | 3 | loop | — | 悬浮窗首次出现 |
| sleep | 2 | 1 | loop | — | 深夜 23:00–06:00 困倦 |
| nap | 2 | 1 | loop | — | 午后 13:00–15:00 打盹 |
| wakeup | 3 | 2 | loop | — | 清晨 06:00–09:00 刚醒 |
| wake | 2 | 3 | once | — | 唤醒瞬间（一次性） |
| joy | 2 | 5 | loop | — | 轻庆祝 |
| celebrate | 3 | 4 | loop | — | 庆祝（点角色 / 开启护眼） |
| party | 3 | 4 | loop | — | 庆祝变体（随机池） |
| disappointed | 2 | 2 | loop | — | 昨夜得分偏低 / 深睡偏低 |
| error | 2 | 8 | once | shake | 保存失败、授权失败 |
| drag | 1 | 5 | loop | tilt | 拖拽中被拎起 |
| walk | 3 | 6 | pingpong | — | 待机小动作 |
| working | 3 | 3 | loop | — | 待机小动作 |
| eat | 3 | 8 | loop | — | 待机小动作 |
| play | 3 | 4 | loop | — | 待机小动作 |
| reading | 2 | 2 | loop | — | 待机小动作 |
| tea | 3 | 2 | loop | — | 待机小动作 |
| pillow | 2 | 1 | loop | — | 待机小动作 |
| headtilt | 2 | 2 | loop | — | 歪头（播报时） |
| think | 1 | 2 | loop | float | 思考（AI 建议播报） |
| wait | 1 | 2 | loop | wiggle | 等待 |

上游另有 `tennis`（运动装搭配）未取用。

## 素材来源（第二批：气泡表情）

`stickers/` 下的静态表情取自
[EDMOK/blue-fish-archive](https://github.com/EDMOK/blue-fish-archive)（蓝色大肥鱼档案馆），
同样依 **CC BY-NC-SA 4.0** 使用。详见 `stickers/NOTICE.md`。
