# 快乐萌宠消

使用 **Cocos Creator 3.8.8** 的卡通萌宠收纳消除游戏，设计分辨率 **720 × 1560**。参考提供的三张游戏截图重新设计，采用暖色萌宠房间主页、蓝绿天空游戏背景、白色立体牌块、蓝金粉三色入口和局内道具栏。

## 打开项目

在 Cocos Dashboard 添加本文件夹，使用 Creator 3.8.8 打开 `assets/scenes/loading.scene`，点击预览可看到完整启动流程；编辑主页与游戏页则打开 `assets/scenes/main.scene`。

主页和游戏页均有实际的 Sprite、Label、Button 节点，共 142 个节点、15 个原生按钮。层级为：

```text
Canvas
├── UICamera
└── Stage
    ├── HomePage
    │   ├── KeyArt / TopBar / Branding
    │   ├── Shortcuts
    │   └── WelcomePanel（经典三消 / 极限四消 / 趣味规则消 / 闯关模式）
    └── GamePage
        ├── Background / TopBar / Instruction
        ├── BoardPreview / Board
        ├── ReserveArea / TrayPanel / Slot0…6 / Tray
        └── Toolbar
```

编辑器默认显示主页。查看游戏布局时，隐藏 `HomePage` 并显示 `GamePage`；`BoardPreview` 提供编辑态的入门牌面示例。运行时首页始终为入口，示例牌面自动隐藏，由规则生成实际牌局。

日常布局直接修改场景。普通构建不会覆盖场景。`tools/build-home-scene.cjs` 是重建原始布局的工具，会覆盖 `main.scene`，只在需要重新生成布局时运行。

已有浏览器构建时，执行 `node tools/serve.cjs`，打开 <http://127.0.0.1:7457>。

## 启动画面

完整启动流程为：自定义插屏海报 → 原生 `loading.scene` → 游戏主页。构建配置包含 `loading.scene` 和 `main.scene`，以前者为入口。

- `assets/startup/poster.jpg`：夕阳海岛、萌宠帆船、书本前景和“快乐萌宠消”标题的完整插画。
- `assets/scenes/loading.scene`：编辑器可见的加载界面，包含动画圆点、底部进度条、状态提示、重试按钮和健康游戏提示。
- `assets/scripts/LoadingScreen.ts`：预加载主场景，进度来自真实资源回调，完成后进入主页。
- `settings/v2/packages/builder.json` 的 `splash-setting`：使用完整海报作自定义背景；海报自带标题，无需重复叠加 Logo。通过 Creator 官方自定义插屏功能启用。
- `settings/loading-poster.jpg`：供原生插屏使用的同一张海报。
- `build-templates/wechatgame/first-screen.js`：基于 Creator 3.8.8 的项目构建模板，将小游戏首屏进度条移到画面底部并匹配蓝色样式。进度刷新最多等一帧或 120 毫秒，绘制中断不会无限阻塞启动；结束时仅释放实际创建的图形资源。它使用构建器生成的 `background.jpg`；升级 Creator 或更改插屏图片方案时应核对模板。
- `build-templates/wechatgame/game.ejs` 与 `preload-resources.js`：在首屏结束前下载 resources 分包并显示原生下载进度，完成后交给引擎使用缓存。失败或 45 秒无回调会给出提示；启动阶段记录在 `[pet-startup]` 日志及 `globalThis.__petStartup` 中，便于真机定位。

Logo、冒险背景、最终海报均用内置 image_gen 生成。提示词与原图记录在 `art/loading-manifest.json`、`art/loading-adventure-manifest.json`，原图保留在 `art/source-loading`。`tools/build-loading-scene.cjs` 可重建加载场景；日常构建不覆盖手工调整的场景。

若复制到其他账号后构建提示“自定义插屏启用失败”，应在 Creator 的项目设置 → 插屏设置完成官方启用流程；不要通过修改信息登记标记或引擎校验绕过。只复制图片不会替代该启用步骤。

## 可玩内容

首页保留左上角菜单和一条萌宠金币余额，两侧为 7 日签到、萌宠图鉴、背包道具、声音设置。原首页底部五项导航已移除。菜单点击后弹出系统设置、联系客服、更新公告三项，点击外部即可关闭。

首页前三个入口直接进入对应玩法的固定两关，第一关简单、第二关为 15 种萌宠的挑战关；第四个“闯关模式”是独立入口，再选择三种规则，使用后台发布的关卡。未连接服务器时前三种仍可离线游玩，闯关模式显示准备中。联网对局会分别记录入口，但共用用户金币和背包。

| 入口 | 消除规则 | 第一关 | 第二关 |
| --- | --- | --- | --- |
| 经典三消 | 三个相同 | 18 张、3 种、九组双层牌 | 108 张、15 种、五层错位遮挡 |
| 极限四消 | 四个相同，三个不消除 | 16 张、2 种、八组双层牌 | 108 张、15 种、五层错位遮挡 |
| 趣味规则消 | 三个相同，或两种不同萌宠各两个（AABB） | 7 张，分别演示 AAA 和 BBCC | 108 张、15 种、五层错位遮挡 |

每个入口直接从第一关开始，完成后自动进入同一玩法的第二关，没有选关页或第一关结算按钮。每次进入第一关都会弹出带图示的规则说明；确认前棋盘不可点击，计时也不开始。第二关不重复弹出说明。第二关成功才显示整轮通关结算，三种玩法分别保留历史完成记录。

点击未被覆盖的萌宠进入 7 格收纳槽。同种牌自动归拢，消除不要求相邻。第七张进入时先消除，再判断是否满槽。趣味消优先判断三消，再判断两对不同萌宠；清空棋盘、暂存区和收纳槽才能通关。满槽或棋盘和暂存区均空却留有无法成组的牌时失败。失败结算只有“返回主页”和“重新开始 · 第一关”，不提供撤回复活；重新开始保留当前玩法，回到第一关。

连续点击仍可用：规则按点击顺序立即处理，飞行动画和三张/四张消除动画独立进行。动画期间可暂停、重开、返回主页；道具等牌块归位后恢复可用。

局内底部仅保留撤回、铲出、提示、重排四个道具，分别每局免费 1、1、3、1 次，免费次数用完再消耗背包库存。局内系统设置和暂停菜单均可返回主页；暂停菜单也可从本玩法第一关重新开始。萌宠收集进度和原整块 HUD 已从场景移除。

- 撤回：恢复最近一次选牌及其消除结果，只能在尚未失败时使用；也能将从暂存区取出的牌放回原处。
- 铲出：将当前收纳槽全部方块移到上方暂存区。暂存区有 7 个位置，点击其中的萌宠可送回主槽参与消除。空槽或剩余暂存空间不足时不消耗道具。铲出不删除牌、不增加消除数量；必须清空暂存区才算通关。
- 提示：可点亮棋盘或暂存区的可选萌宠，按当前玩法考虑三消、四消或两对消除。
- 重排：包含棋盘、收纳槽、暂存区的所有剩余方块，先聚拢并顺时针旋转一周，再飞到重新分配的位置。动画约 1.1 秒，期间暂停选牌，仍可通过暂停菜单离开。重排保留数量和种类；无法成组的剩余组合不消耗道具。旧撤回记录在铲出和重排后清空。

金币在每关完成后按消除组数累加；7 日签到每天赠送金币和背包道具。按本地日历每天可领一次，中断不重置，领取第 7 天后进入下一轮。签到、金币、库存、声音设置和三套关卡进度均存本地。旧存档的星星转为金币，原关卡进度保留在经典三消中。

此版本金币仅累计展示，尚无消费、购买、提现或兑换入口。没有支付或广告接入。签到采用本地日期，正式运营若要防篡改应改用服务端校时和存档。

联系客服调用微信小游戏 `wx.openCustomerServiceConversation`，仅打开会话，不自动发送消息。浏览器会提示在微信小游戏内使用；调用失败会提示稍后重试。项目导出已保留用户的 AppID，实际客服能否接待还取决于微信后台配置。更新公告使用当前版本的本地内容。

## 原创资产

- `assets/resources/cartoon/home.jpg`：暖色兔子阅读室背景。
- `assets/resources/cartoon/game.jpg`：蓝绿天空游戏背景。
- `assets/resources/cartoon/pets/`：15 种原创萌宠牌面（原有 9 种 + 新增狐狸、羊、企鹅、仓鼠、考拉、大象）。
- `assets/resources/cartoon/icons/`：10 种原创导航、道具图标，含新增铲子。
- `assets/resources/cartoon/home-ui/`：新生成的金币、7 日签到礼盒、背包透明图标。原图在 `art/source-v3`，完整提示词在 `art/home-v3-manifest.json`。
- `assets/resources/cartoon/ui/`：原创渐变、高光、描边与立体边缘的按钮和面板。
- `assets/resources/audio/`：五份程序原创合成音频，包括 16 秒循环背景音乐。

背景与插画图标使用内置 image_gen 生成。原始图集在 `art/source-v2`，完整提示词和处理记录在 `art/cartoon-v2-manifest.json`。参考截图在 `art/references-v2`，不进入构建包。上一版的相关源文件和图片备份在 `art/archive-v1`。

新增六种萌宠和铲子图标使用内置 image_gen 生成，保留透明通道。原图在 `art/source-v4`，完整提示词和目标路径在 `art/pets-v4-manifest.json`。

## 构建

```powershell
.\tools\build.ps1 -Platform web-mobile
.\tools\build.ps1 -Platform wechatgame
```

默认使用 `C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`，其他安装路径通过 `-CreatorPath` 指定。

微信输出在 `build/wechatgame`，美术和音频在 `subpackages/resources`。未设置 AppID 时输出为游客模式。真机预览和发布需在 `build-config/wechatgame.json` 的 `packages.wechatgame.appid` 填入自己的小游戏 AppID，再重新构建。

## 验证

```text
node tools/test-game.cjs
node tools/test-modes.cjs
node tools/smoke-test.cjs
node tools/test-rapid-input.cjs
node tools/test-loading.cjs
node tools/test-wechat-startup.cjs
```

经典规则回归覆盖 400 个初始牌局、200 个重排和 50 个死局恢复。三模式规则测试另覆盖 900 个初始牌局、450 个重排，以及四消/两对消除、第七格结算、精确进度、撤回、提示、剩余牌失败、旧存档迁移和签到防重复领取。所有初始牌局保留完整可验证解法；第二关筛选简单策略容易解出的局面，机器人结果不代表真人通关率。

浏览器测试针对 Creator 导出版本，真实点击完成三种玩法的连续两关，检查无选关页、自动进入第二关、失败从第一关开始、铲出取回和撤回、顺时针动画、离场取消动画、15 种动物、签到和道具库存。截图与结果在 `output/qa-tools`。此前 `output/快乐萌宠消_介绍截图` 属于旧版微信截图，不能代表当前三模式版本。

连续输入测试覆盖移动中继续点牌、消除中继续点牌、动画重排、重复事件、暂停、切换页面、快速通关只奖励一次、满槽拒绝第八张、失败不允许撤回复活及移动端触屏连点。结果在 `output/qa-rapid`。

Creator 的生产转译对可迭代对象展开使用宽松模式；集合需用 `Array.from` 显式转数组，避免 Map/Set 在导出后出现不同规则结果。

启动测试检查官方插屏是否输出项目海报、真实资源加载进度、进入主页，以及资源下载失败后重试恢复。结果在 `output/loading-qa.json`，实际加载截图在 `output/custom-loading.png`。

微信启动专项测试模拟绘制回调停顿、绘制异常、并发进度更新、空图形对象，以及分包下载成功、失败和超时；结果在 `output/wechat-startup-qa.json`。模拟测试不等同于 iPhone 真机确认，微信代码修改后需重新生成预览二维码扫码。

微信启动使用唯一场景名 `loading`，在项目资源初始化后校验 loading/main 均已登记，再进入首场景。微信构建启用 MD5 资源版本，防止更新场景表后继续使用旧路径。`node tools/validate-wechat-build.cjs` 验证带版本的场景表、分包入口及所有启动脚本引用；诊断版本为 `ios-startup-2`。

## 难度量化

```text
node tools/analyze-difficulty.cjs
node tools/audit-fun-remainders.cjs
node tools/build-difficulty-report.cjs
```

默认对六关四种策略各运行 1000 次，并对第二关做 500 个配对种子的道具逐项禁用对照，共 30000 次策略运行；另验证生成解法并审计趣味模式的余牌计数可分解性。机器人不读取保存解法，规划策略读取明牌种类和完整遮挡几何，不等同于真人。

报告在 `output/difficulty/难度量化与指标.html`；包括 76 项指标的定义、影响方向、当前值/数据缺口和采集方法，以及 CSV、JSON 和每次运行明细。`tools/difficulty-metrics.cjs` 是当前版本指标字典，玩法或参数改变后应同步复核字典说明。本次分析没有修改游戏难度参数。

## 按规则与数量计算理论胜率

`tools/lib/win-probability.cjs` 提供 `calculate(spec, options)`；默认模型为所有剩余牌可选、每次等概率随机选一张、不放回、无道具、7 格槽。它计算整局清空概率，不等于分层棋盘上的真人通关率。

```text
node tools/calculate-win-rate.cjs output/win-probability/input-example.json
node tools/test-win-probability.cjs
```

输入示例：`{"capacity":7,"counts":{"小鸡":3,"小猫":2,"小狗":2},"rules":[[3],[2,2]]}`。`[3]` 为三个同类，`[4]` 为四个同类，`[2,2]` 为两种不同动物各两张。规则按数组顺序尝试；一般自定义规则若存在多种同时匹配的组合，按输入种类顺序分配较大的数量要求。涉及空间、颜色属性或玩家主动选择组合的规则，需要扩展模型状态/消除函数。

小状态使用记忆化动态规划和 BigInt 统计成功排列数，返回精确分数。对已证明对称的规则合并相同种类状态。默认超过 250000 个状态或 3 秒预算则转为 100000 次蒙特卡洛抽样，明确返回估计方法与区间；0 次成功会返回单侧 95% 上界，不将其断言为不可能。`options.method` 可选 `exact`、`monte-carlo`、`auto`。精确计算的数值概率使用浮点输出，同时保留分数和科学计数值。

三组已验证的精确样例：三消 `[3,3,3,3]` 为 `13/22`；四消 `[4,4,4]` 为 `7/33`；趣味 `[3,2,2]` 为 `13/35`。这些是不同牌堆的示例，不应用于隔离“仅改规则”的影响。
