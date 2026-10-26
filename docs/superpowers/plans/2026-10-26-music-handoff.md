# 首页进入游戏时背景音乐丢失修复

**Goal:** 首页与游戏切换时保持可听见的背景音乐，游戏音乐首次启动无响应时自动恢复，保留已有静音、后台和避免重复音量写入的行为。

**Architecture:** 保留 WoodlandAudio 的两个音乐通道节点。下一首音乐实际开始后再淡出上一首；首次启动使用有界超时恢复，普通暂停续播沿用现有恢复。结束或取消的音乐清空 clip，释放其原生播放队列，并更换 AudioSource 实例隔离异步加载；快速返回仍在播放的曲目时直接复用。

**Tech Stack:** Cocos Creator 3.8.8、TypeScript、Node test、Playwright。

## 已确认的原因

- 当前切换立即将旧曲目的 target 置零；新曲目未收到 STARTED 时 started=false，恢复分支永远不会执行。
- Creator 3.8.8 的 clip 相同赋值不会重建播放器；小游戏播放器对 STOPPED 状态再次 stop 仍等待原生 STOPPED 回调，未返回时后续 play 会堵在操作队列中。
- 原有单元桩对相同 clip 也会重建，且原有浏览器测试没有模拟新曲目第一次 play 无响应，漏掉了以上场景。
- 代码复核使用实际引擎源码复现：相同 AudioSource 的两次相同 clip 加载，仅按 clip 对象识别完成结果；旧请求可能消费新请求的 PLAY，随后新播放器以 INIT 状态覆盖已经播放的旧播放器。因此需更换 AudioSource 实例，不能仅清空并重设 clip。

## 实施与验证

- [x] 在 `minigame/tools/test-audio-recovery.cjs` 修正相同 clip 的桩行为，加入首次启动无响应、延迟启动、反复切换、快速返回、静音/后台取消的回归；先运行确认失败。
- [x] 在 `minigame/assets/scripts/ui/WoodlandAudio.ts` 实施等待播放确认的切换及有界恢复。首次启动等待超过 Creator 原生加载的 8 秒窗口；未发生交互且尚无音乐播放时继续交给浏览器自动播放策略处理。
- [x] 在 `minigame/tools/test-soundscape.cjs` 对实际导出游戏注入一次新的音乐播放器 play 无回调，验证首页音乐延续、游戏音乐恢复、反复进入及单通道稳定播放。
- [x] 更新 `minigame/README.md` 音频行为说明。运行音频单元测试、类型和相关格式/静态检查。
- [x] 顺序构建网页和微信包，运行 `make test-audio` 与 `make test-startup`。复核修改范围，保留任务外的未提交美术素材。

真机限制：自动化可以验证播放器状态与调用队列，不能代替 iPhone 微信实际听音。

## 回归证据

- 最初新增的七项恢复单元场景均失败，实际导出游戏也复现了新曲目首次 play 无回调时首页音乐消失；修复后 19 项音频单元测试通过。
- 实际导出游戏的相同曲目两次加载按旧→新顺序完成时，旧实现无法启动最终播放器；新实现隔离 AudioSource，两个完成顺序均可正常播放。
- 新增从浏览器启动开始记录底层 BufferSource 的测试，曾观察到切换后仍有 2 个循环，尽管仅 1 个 AudioSource 报告播放。清空 clip 前仅停止正在播放的旧曲目后，此检查通过；避免对 STOPPED 状态重复 stop。
- 独立复审使用实际 Creator AudioSource、WebAudio、操作队列代码验证快速往返、静音恢复和超时恢复的加载顺序，播放进度得以保留；反复切换后底层仅 1 个循环，静音和销毁后为 0。
- 最终 `make test-audio test-startup` 全部通过：19 项音频单元回归、22 个音频资源解码、允许与阻止自动播放的两组实际导出游戏测试、微信包依赖校验及 6 项启动回归。网页与微信包均已重建。类型、修改文件格式、静态检查和 `git diff --check` 通过。
