# 快乐萌宠消

使用 **Cocos Creator 3.8.8** 的萌宠收纳消除游戏，设计分辨率 **720 × 1560**。当前采用已选定的 **B · 森林木作** 概念方案：木雕动物、森林工坊、奶白木牌、嵌入式收纳槽，以及绿、橙、蓝、金四色木作入口。

## 打开项目

在 Cocos Dashboard 添加本文件夹，使用 Creator 3.8.8 打开 `assets/scenes/loading.scene`，点击预览可看到完整启动流程；编辑主页与游戏页则打开 `assets/scenes/main.scene`。

主页和游戏页均有实际的 Sprite、Label、Button 节点，共 169 个节点、15 个原生按钮。层级为：

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

日常布局直接修改场景。普通构建不会覆盖场景。`tools/build-woodland-scene.cjs` 可重建当前森林木作布局，会覆盖 `main.scene`，只在需要重新生成布局时运行。

横向木牌使用独立的 `SkinGraphic` 图层：保持原图高度，只伸展中间的宽度，再整体等比缩放。外层节点承载文字、点击区域和按压动画。运行时弹窗与原生场景采用相同规则，避免短按钮的九宫格中段被压成零高度而产生尖角。`tools/test-ui-skins.cjs` 会读取实际渲染网格，检查圆角比例、图层尺寸和菜单点击。

弹窗标题和菜单按钮统一使用 44 个设计单位的内槽留边，关闭按钮放大为 68 × 72。图鉴仅保留标题、15 种萌宠和关闭入口。`ui/ModalPresenter.ts` 统一管理约 0.26 秒木盒轻弹和 0.18 秒淡出，背景遮罩始终覆盖屏幕；关闭期间阻止穿透点击，替换或切换页面会取消过期回调。

已有浏览器构建时，执行 `node tools/serve.cjs`，打开 <http://127.0.0.1:7457>。

## 启动画面

完整启动流程为：自定义插屏海报 → 原生 `loading.scene` → 游戏主页。构建配置包含 `loading.scene` 和 `main.scene`，以前者为入口。

- `assets/startup/poster.jpg`：森林工坊、四只木雕萌宠和“快乐萌宠消”木牌标题的完整插画。
- `assets/scenes/loading.scene`：编辑器可见的加载界面，包含动画圆点、底部进度条、状态提示、重试按钮和健康游戏提示。
- `assets/scripts/LoadingScreen.ts`：预加载主场景，进度来自真实资源回调，完成后进入主页。
- `settings/v2/packages/builder.json` 的 `splash-setting`：使用完整海报作自定义背景；海报自带标题，无需重复叠加 Logo。通过 Creator 官方自定义插屏功能启用。
- `settings/loading-poster.jpg`：供原生插屏使用的同一张海报。
- `build-templates/wechatgame/first-screen.js`：基于 Creator 3.8.8 的项目构建模板，将小游戏首屏进度条移到画面底部并匹配金色木作样式。进度刷新最多等一帧或 120 毫秒，绘制中断不会无限阻塞启动；结束时仅释放实际创建的图形资源。它使用构建器生成的 `background.jpg`；升级 Creator 或更改插屏图片方案时应核对模板。
- `build-templates/wechatgame/game.ejs` 与 `preload-resources.js`：在首屏结束前下载 resources 分包并显示原生下载进度，完成后交给引擎使用缓存。失败或 45 秒无回调会给出提示；启动阶段记录在 `[pet-startup]` 日志及 `globalThis.__petStartup` 中，便于真机定位。

当前 Logo、背景、海报均用内置 image_gen 按森林木作参考图生成。提示词记录在 `art/woodland-manifest.json`，原图保留在 `art/source-woodland`。`tools/build-loading-scene.cjs` 可重建加载场景；日常构建不覆盖手工调整的场景。

若复制到其他账号后构建提示“自定义插屏启用失败”，应在 Creator 的项目设置 → 插屏设置完成官方启用流程；不要通过修改信息登记标记或引擎校验绕过。只复制图片不会替代该启用步骤。

## 可玩内容

首页保留左上角菜单和右上角萌宠金币余额。木雕动物下方横排展示 7 日签到、萌宠图鉴、背包道具、声音设置，四个玩法入口使用下方双列布局。菜单点击后弹出个人设置、系统设置、联系客服、更新公告四项，点击外部即可关闭。

首页前三个入口属于挑战模式，当前每种规则默认连续两关，第一关简单、第二关为 15 种萌宠的挑战关；微信联网时从后台读取已发布的挑战关卡，后台可编辑并在以后扩展。第四个“闯关模式”独立选择三种规则，保存各自的通关进度，重新进入继续首个未通关关卡。两类入口共用关卡、资产与回放系统。普通网页或未连接服务器时前三种使用下表的内置离线双关，闯关模式显示准备中。

| 入口       | 消除规则                               | 第一关                     | 第二关                      |
| ---------- | -------------------------------------- | -------------------------- | --------------------------- |
| 经典三消   | 三个相同                               | 18 张、3 种、九组双层牌    | 108 张、15 种、五层错位遮挡 |
| 极限四消   | 四个相同，三个不消除                   | 16 张、2 种、八组双层牌    | 108 张、15 种、五层错位遮挡 |
| 趣味规则消 | 三个相同，或两种不同萌宠各两个（AABB） | 7 张，分别演示 AAA 和 BBCC | 108 张、15 种、五层错位遮挡 |

内置挑战双关从第一关开始，完成后自动进入第二关，没有选关页或第一关结算按钮；第二关成功后显示整轮结算。微信联网对局按对应目录的已发布关卡推进，闯关重新进入时可从保存进度的后续关开始。每次从首页进入玩法都会说明规则，连续进入下一关不重复说明；确认前棋盘不可点击，计时也不开始。

点击未被覆盖的萌宠进入 7 格收纳槽。同种牌自动归拢，消除不要求相邻。第七张进入时先消除，再判断是否满槽。趣味消优先判断三消，再判断两对不同萌宠；清空棋盘、暂存区和收纳槽才能通关。满槽或棋盘和暂存区均空却留有无法成组的牌时失败。失败后可返回主页或重试，不提供撤回复活；挑战模式从本规则第一关重新开始，闯关模式继续当前未通关关卡。

`ui/LeafTransition.ts` 用于请求新关卡和下一关期间的过渡：六片森林配色树叶聚合、散开，背景沿用森林插画，整个画面不包含文字或百分比。遮罩覆盖所有输入，局内计时暂停；请求完成后淡出，失败后转到重试提示。离开或销毁场景会取消动画并忽略过期响应。闯关当前已发布关卡全部完成时正常提示进度已保存，之后发布新关卡即可继续。

联网关卡使用后台配置的 `rules`，首页入口名称不再限制消除条件。`[3]`、`[4]`、`[2,2]`、`[3,2]`、`[2,2,2]` 等正整数组合都可使用，一关支持最多六条、按行优先匹配；每条合计 2–7 个。新规则版本为 `pet-rules-2`，旧 `pet-rules-1` 缺省规则按原入口解释。规则说明图示和提示条由实际组合生成，点击提示条可再次查看；连续下一关改变规则时会重新说明。自定义提示只点亮下一张建议牌，避免把需要按顺序收集的组合同时高亮造成误导。

连续点击仍可用：规则按点击顺序立即处理，飞行动画和三张/四张消除动画独立进行。动画期间可暂停、重开、返回主页；道具等牌块归位后恢复可用。

局内底部仅保留撤回、铲出、提示、重排四个道具，分别每局免费 1、1、3、1 次，免费次数用完再消耗背包库存。局内系统设置和暂停菜单均可返回主页；暂停菜单也可从本玩法第一关重新开始。萌宠收集进度和原整块 HUD 已从场景移除。

- 撤回：恢复最近一次选牌及其消除结果，只能在尚未失败时使用；也能将从暂存区取出的牌放回原处。
- 铲出：将当前收纳槽全部方块移到上方暂存区。暂存区有 7 个位置，点击其中的萌宠可送回主槽参与消除。空槽或剩余暂存空间不足时不消耗道具。铲出不删除牌、不增加消除数量；必须清空暂存区才算通关。
- 提示：可点亮棋盘或暂存区的可选萌宠，按当前玩法考虑三消、四消或两对消除。
- 重排：包含棋盘、收纳槽、暂存区的所有剩余方块，先聚拢并顺时针旋转一周，再飞到重新分配的位置。动画约 1.2 秒，期间暂停选牌，仍可通过暂停菜单离开。重排保留数量和种类；无法成组的剩余组合不消耗道具。旧撤回记录在铲出和重排后清空。

金币在每关完成后按消除组数累加；7 日签到每天赠送金币和背包道具。按本地日历每天可领一次，中断不重置，领取第 7 天后进入下一轮。签到、金币、库存、声音设置和三套关卡进度均存本地。旧存档的星星转为金币，原关卡进度保留在经典三消中。

此版本金币仅累计展示，尚无消费、购买、提现或兑换入口。没有支付或广告接入。签到采用本地日期，正式运营若要防篡改应改用服务端校时和存档。

联系客服调用微信小游戏 `wx.openCustomerServiceConversation`，仅打开会话，不自动发送消息。浏览器会提示在微信小游戏内使用；调用失败会提示稍后重试。项目导出已保留用户的 AppID，实际客服能否接待还取决于微信后台配置。更新公告使用当前版本的本地内容。

## 原创资产

- `assets/resources/cartoon/home.jpg`：森林工坊与兔、熊猫、牛、猴四只木雕萌宠。
- `assets/resources/cartoon/game.jpg`：干净的鼠尾草绿森林与原木桌面。
- `assets/resources/cartoon/pets/`：15 种原创萌宠牌面，编号 0–14 依次为鼠、牛、虎、兔、龙、蛇、马、羊、猴、鸡、狗、猪、猫、熊猫、狮子。
- `assets/resources/cartoon/icons/`：7 种木作图鉴、闯关、设置和道具图标；运行时弹窗绑定其中 6 种。
- `assets/resources/cartoon/home-ui/`：木牌 Logo、爪印金币、签到日历、背包透明图标。
- `assets/resources/cartoon/ui/`：木纹按钮、厚实奶白牌块、木框面板与嵌槽皮肤。
- `assets/resources/audio/`：22 段森林木作主题 MP3，包括 16 段交互音效、2 首原创循环背景音乐和 4 句晓伊神经网络中文配音，总计约 782 KiB。

背景与插画图标使用内置 image_gen 生成。美术目录只保留当前森林木作原图、提示词和选定的 B 概念参考；历史素材、未采用的方案和旧版导入工具已清理。

细节版进一步对照 B 图调整：圆角木板入口带倾斜牌片和箭头，功能图标使用原木底座，签到日历改为勾选标记，图鉴使用爪印书封，设置改为深灰木齿轮。对局使用绳索关卡吊牌、整块七孔木托盘和带一体文字区的道具按钮。托盘的七个 `Slot` 节点是编辑器定位参考；实际凹槽由整张托盘图呈现。常驻的重复说明改为槽位紧张时的提醒。配套图集与提示词记录在 `art/woodland-details-manifest.json`。

当前 15 种角色全部改为木雕头像，仍按十二生肖加猫、熊猫、狮子的顺序使用编号 0–14。概念参考在 `art/style-concepts-2026-10-25/B-woodland-workshop.png`，配套原图在 `art/source-woodland`，完整提示词在 `art/woodland-manifest.json`。执行 `node tools/prepare-woodland-art.cjs` 会拆分透明图集、规范尺寸、同步后台图片并更新启动海报；不改变种类编号、关卡规则或存档。后台关卡预览和回放同步采用木雕头像。

## 森林木作动效与声音

木牌点击轻压后归位，入槽轻轻倾斜，消除时上浮淡出并飘散绿叶和木屑。提示使用柔和金色呼吸光，重排配合顺时针转动；弹窗如木盒轻弹展开，通关飘叶庆祝，失败时萌宠轻轻摇摆。连续选牌和离场取消动画的处理保持一致。

首页播放 88 BPM 的《林间小憩》，对局切换到 100 BPM 的《萌宠寻路》，以木琴、卡林巴、拨弦和轻木质打击为主。16 段音效分别用于按钮、选牌、不可选提示、三种消除、四种道具、弹窗开关、签到、过关及胜负。四句中文语音仅在开始、进入下一关、通关和失败时播报，不为每次消除重复配音。

`ui/WoodlandAudio.ts` 管理四个音效通道、两个音乐交叉渐变通道和一个语音通道。音乐资源加载后自动尝试播放，无需先操作游戏；浏览器阻止自动播放时，由 Cocos 在首次点击后恢复。语音期间降低背景音量，结束后恢复。声音开关同时控制音乐、音效和语音，已保存的静音设置在微信登录完成前也始终生效。切入后台停止全部声音，返回后恢复对应场景音乐。

音乐旋律和音效由项目中的确定性合成脚本原创生成；中文配音使用已选定的 A 版俏皮女声 `zh-CN-XiaoyiNeural`（语速 +2%，音高不变）。实际来源、参数和音量处理记录在 `art/woodland-audio-manifest.json`，台词在 `art/woodland-voices.json`。重新生成需要 Python 3.10+、FFmpeg 和联网语音服务。从 `minigame` 目录执行：

```powershell
py -3 -m venv temp/voice-venv
$env:VOICE_PYTHON = (Resolve-Path 'temp/voice-venv/Scripts/python.exe').Path
& $env:VOICE_PYTHON -m pip install -r tools/voice-requirements.txt
node tools/generate-audio.cjs --voices-only
```

`--voices-only` 只更新四句配音，保留其余音乐、音效及现有资源 UUID；去掉该参数可重新生成全部 22 个 MP3。中间文件放入忽略的 `output/audio-source`，合成失败不会退回桌面朗读音色。运行游戏不需要 Python、FFmpeg 或联网语音服务。重新生成后应重新构建 Creator 项目。

## 个人设置

首页菜单提供个人设置、系统设置、联系客服和更新公告。头像和昵称只能从微信获取，个人设置为只读展示，不提供昵称输入、相册上传或萌宠头像选择，也不需要单独点击保存。首次使用点击“同步微信资料”原生授权按钮，同意后将微信返回的头像和昵称一起通过 `PUT /api/v1/user/me` 保存到当前登录账号。

已授权用户在微信登录后自动同步；打开个人设置或从后台返回该界面也会检查并同步。通过 `wx.getSetting` 确认 `scope.userInfo`，新基础库还通过 `wx.getPrivacySetting` 确认无需补充隐私授权，才调用 `wx.getUserInfo`，不在启动时强行弹出授权。自动同步不阻塞登录与游戏，资料未变化时跳过重复保存。拒绝授权、资料不完整、获取超时或保存失败均保留原资料，账号切换后旧请求不得写入新账号。[微信官方获取流程](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts#L17519)

资料保存与图片下载分开：微信返回的头像地址和昵称先保存，图片加载失败仅显示默认头像，不阻止昵称同步；再次同步时可重试加载。网页预览可以查看界面，资料同步需要微信登录。

数据库用增量迁移 `002_user_avatar_url.sql` 保存头像 URL，后台用户列表沿用同一份资料。微信昵称为 1–32 个字符。微信头像地址可能在用户换头像后失效，可点击“同步微信资料”更新。服务端必须已经部署包含该迁移及 `PUT /user/me` 的版本。发布前需在微信后台配置头像昵称相关隐私声明，并确认实际头像 CDN 域名的图片下载配置；本地模拟授权测试不代替真机授权验证。

### 点击同步没有弹窗，直接失败

本项目在开发者工具中实际捕获过 `getUserInfo:fail please go to mp to announce your privacy usage`，错误码 `1026`，未返回 `userInfo`。这是微信在弹出用户授权前拦截了隐私接口，需要先完成该小游戏的后台隐私声明。修改按钮、重复登录或改用手填昵称不能解决这一拦截。

1. 使用该小游戏的管理员账号进入 [微信公众平台](https://mp.weixin.qq.com/)，确认与 `build-config/wechatgame.json` 的 AppID 对应。
2. 进入“设置 → 服务内容声明 → 用户隐私保护指引”，添加头像、昵称对应的信息类型，按当前实际用途填写。例如：“用于在游戏内展示玩家头像和昵称，并保存玩家的个人资料。”其他声明信息按实际运营情况填写。
3. 按后台要求提交，并确认声明已生效；若后台另有隐私接口限制提示，先完成其要求。
4. 重新编译开发者工具中的小游戏，再点击“同步微信资料”；手机端重新进入后复测。首次由用户完成微信提供的隐私及资料授权，之后才可自动读取；代码不会代用户同意授权。

界面会持续显示“微信资料授权暂不可用，请稍后再试”，具体微信错误码、原始错误和后台排查入口写入 `[pet-profile] 微信接口失败` 日志；日志不记录返回的头像、昵称或完整资料对象。一般接口失败、用户拒绝和取消分别提示，全部保留原资料，后续授权成功仍可重试。

注意：`getPrivacySetting.needAuthorization === false` 不代表后台声明已完成，未声明收集类型时同样返回 false。[微信官方定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts#L3435) 明确说明了这几种情况。后台声明生效和真实授权成功前，自动化模拟通过不能作为真实微信资料已同步的结论。

## 构建

接口在 `assets/resources/online.json` 的 `environments` 中统一配置。只有浏览器和开发者工具模拟器使用 `local`（默认 `http://127.0.0.1:8080/api/v1`）；真机 `develop` 开发版／扫码预览及 `trial` 体验版使用 `preview`，`release` 正式版使用 `production`，目前两者均为 `https://hp.autora.cn/api/v1`。`core/ApiEnvironment.ts` 读取微信官方设备/版本信息；模拟器判断优先于版本判断，无法识别的微信版本使用正式配置，配置错误不会回退到其他环境。

从仓库根目录运行 `make configure-game API_ENV=preview API_URL=https://域名/api/v1` 可单独更新一组地址；也可一次传入 `API_LOCAL_URL`、`API_PREVIEW_URL` 和 `API_PRODUCTION_URL`。改地址后重新构建即可。真机开发、扫码预览和提审使用线上配置，无需调整本地地址。

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
node tools/test-custom-rules.cjs
node tools/test-api-environments.cjs
node tools/test-api-storage.cjs
node tools/test-api-environment-browser.cjs
node tools/test-modals.cjs
node tools/test-level-transition.cjs
node tools/test-ui-skins.cjs
node tools/test-audio-assets.cjs
node tools/test-soundscape.cjs
node tools/smoke-test.cjs
node tools/test-rapid-input.cjs
node tools/test-loading.cjs
node tools/test-wechat-startup.cjs
```

经典规则回归覆盖 400 个初始牌局、200 个重排和 50 个死局恢复。三模式规则测试另覆盖 900 个初始牌局、450 个重排，以及四消/两对消除、第七格结算、精确进度、撤回、提示、剩余牌失败、旧存档迁移和签到防重复领取。所有初始牌局保留完整可验证解法；第二关筛选简单策略容易解出的局面，机器人结果不代表真人通关率。

浏览器测试针对 Creator 导出版本，真实点击完成三种玩法的连续两关，检查无选关页、自动进入第二关、失败从第一关开始、铲出取回和撤回、顺时针动画、离场取消动画、15 种动物、签到和道具库存。当前截图与结果在 `output/qa-tools`。

连续输入测试覆盖移动中继续点牌、消除中继续点牌、动画重排、重复事件、暂停、切换页面、快速通关只奖励一次、满槽拒绝第八张、失败不允许撤回复活及移动端触屏连点。结果在 `output/qa-rapid`。

音频文件检查会逐个解码，验证响度、时长、数量和资源元数据；声音浏览器测试检查操作后播放、首页/对局切换、播报时降低背景音乐及及时恢复、全局静音和绿叶消除动效。根目录 `make test-audio` 执行这两项检查，后者需要已启动最新的网页构建，结果在 `output/qa-audio`。

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
