# Mac mini 产品验收

本页按发布和候选保存历史证据。当前常驻版本及接口以[架构与接口现状](../../docs/架构与接口现状.md)为准。各节的结论对应所列源码、部署入口和当次测试条件。

| 查找范围 | 从这一节开始 |
| --- | --- |
| 数据速览与前台追问 | [数据上球与前台决定隔离验收](#mac-mini-数据上球与前台决定隔离验收) |
| 工作台与球体动作 | [工作台和球体动作隔离验收](#mac-mini-工作台和球体动作隔离验收) |
| 人工追问弹框 | [人工追问弹框隔离验收](#mac-mini-人工追问弹框隔离验收) |
| 工作台后端与运行时 API | [同进程双入口正式发布](#mac-mini-工作台后端合并正式发布) |
| 普通 Chat 前台与研究交接 | [正式发布](#mac-mini-chat-前台消息与研究交接正式发布) · [隔离验收](#mac-mini-chat-前台消息与研究交接隔离验收) |
| C40 城市与工作台上下文 | [C40 整合与正式切换](#mac-mini-c40-目录与工作台上下文) |
| 工作台上下文隔离候选 | [普通 Chat 工作台上下文](#mac-mini-普通-chat-工作台上下文隔离验收) |
| rc.10 常驻与隔离对照 | [rc.10 正式发布](#mac-mini-rc10-公开网络工具与局域网正式发布) · [公开工具隔离验收](#mac-mini-公开网络工具执行隔离验收) |
| rc.9 后续交付 | [发现渠道正式发布](#mac-mini-发现渠道范围正式发布) · [目录导航静态发布](#mac-mini-数据触达浏览入口静态发布) · [KEO 文件读取](#mac-mini-日常入口的-keo-文件读取) |
| rc.9、rc.8、rc.7 快照 | [网格问答引用 rc.9](#mac-mini-网格问答目录引用-v020-rc9) · [论文与投影 rc.8](#mac-mini-论文发布与时空投影-v020-rc8) · [日常入口 rc.7](#mac-mini-日常入口-v020-rc7) |
| 更早候选和存储基线 | [A2A rc.6](#mac-mini-a2a-与发现模型独立配置候选-v020-rc6) · [研究工作流 rc.5](#mac-mini-研究工作流候选-v020-rc5) · [存储与恢复 dev.1](#mac-mini-存储与恢复历史基线-v020-dev1) · [0.1.0 验收](../ACCEPTANCE.md) |

## Mac mini 数据上球与前台决定隔离验收

### 球面速览的「数据上球」

早期未归档的隔离实现位于 `iterations/data-globe-action/web`，基线 `32057738119a35149f658bde50cadd66c28646fe`，补丁 SHA-256 为 `bdf0d2d827d6839276cfdd96b511aff8ca7f7edcba69eb24b2e2e740e188041d`。该补丁增加上球按钮，并在正文保留旧目录按钮。本次在主线 `67fc57f` 上更新实际标题入口，展开、折叠均显示同位按钮，独立的资料目录与详情导航照常。

候选 `b7a0e6efebb08abdf5dc5c36bcd0c4ae6e2d2d75`，源树 `25768d8e6aa1340a1d6d19446326c7f3fed56155`，隔离 8174。3,427 个静态文件的清单 SHA-256 为 `e73631256f156eb74975dfab71fcf69d0a9e19a0cdd62618119fe26fdab30562`，首页 SHA-256 为 `40401eaabfb0b56e71ab56b4e883e10e3a026392d8d3baa7f48d67b5f8800345`。独立 Chrome 验证当前选中 CTD 进入 150 m 剖面。纯 PDO、未选资料的批次及单项批次均禁用，鼠标和键盘没有导航或请求图层。测试用浏览器临时批次选第二项森林后实取 2023-07-15 图层，同批首项 C40 没有启动。数据触达自身的独立上球入口可用。独立索引 `iterations/inspector-globe-followup-independent.Ccjg2D/b7a0e6e-independent-index.json` SHA-256 为 `ab6f6578dd26ab78635a286becb8690aeec4168173609d17711b77bc9af09b8c`。

模块的 16 项受控 Chrome 检查另覆盖森林到风场、C40 到 CTD、当前 Q19 改用所选资料范围和发布目录失联。复跑入口为 `iterations/data-globe-and-clarification-contract/globe-evidence/verify-data-globe.mts`。独立实例复用公开的 C40 95 城与森林 4,791 日期清单，森林加上 15 张核对用实图。测试没有研究提交。

后续测试脚本提交 `4dc66230d1742b2817625d24b6e48e4a9276f561` 改用现有清单保存及恢复入口进入原批次，产品源码与 8174 构建相同。隔离实例的 `test:collection-ui` 通过，另复跑 `test:handoff-ui` 的完整研究批次下载场景。其他引用旧按钮的脚本已迁移选择器并通过语法检查。

### 前台追问决定

上轮 DeepSeek Flash 经 Codex CLI 的原始失败输出保留于本机证据。用户从原追问 `d6e9dd0b-badf-4f08-9d5f-e0f9b18b63fa` 补答纽约后，模型在 `1111469d-19c3-4209-9215-3e247fd57e4e` 同时生成 `action="workspace"` 与 `workspacePending=true`，运行时拒绝。只读原样摘录 `iterations/data-globe-and-clarification-contract/evidence/flash-old-conflict.json` 的 SHA-256 为 `58a3d98b3fbea04de985c3c896bda3b1afb0edee4101ab468eef9f845292c9a9`。新模型协议使用互斥决定分支。真实弹框回复的父消息在平台核定。经过确认的控件目标与待办不会由模型重填。

候选 `c7f6ace3ecad06618ab341756d1f8f2f2af12345`，源树 `09074ad11a1fbfcb61b1eca21710398f0c5bc403`，隔离 8274。3,427 个静态文件的清单 SHA-256 为 `ca44bfb1f6b5734795bfc86d59f1c0e82215041f02d661224bdf4a866262e0d3`，首页 SHA-256 为 `d055b618eff20a7628b7ca62b1835e50fbce6e78a5e62a4e4833b42ad4079668`。

独立 Chrome 在 London 发同一句「切到我之前提到的那座城市」。DeepSeek Flash 经 Codex CLI 首轮 `9d28090a-c24a-486c-8df4-99579e6615cf` 选择追问，POST 后 7.881 秒出现弹框。用户在该弹框填「纽约」，答复轮 `3928098e-dc84-4b04-99a6-413cc127dd09` 选择切换城市。运行时在 95 城发布目录解析 `new-york-city-usa`，POST 后 7.900 秒浏览器显示纽约，正式目录中对应的 WebP 在隔离实例返回 HTTP 200。每轮一次实际模型规划，两次提交均 HTTP 202。隔离 PostgreSQL 保留同一会话内的一条父子绑定，两轮均无后台研究排队、发现委托或网页工具授权。独立索引 `iterations/inspector-globe-followup-independent.Ccjg2D/c7f6ace-independent-index.json` SHA-256 为 `25ca2e251edaae3e99d6e695c6ff18fa5b4b3afb6d81035256b5ddf766105bc5`。主程只读复核 `iterations/data-globe-and-clarification-contract/evidence/runtime-live-root-audit.json` SHA-256 为 `7a776613337e6029cb6372bb534a8a167bdd096dbc9497174d727c92eed7b01c`。

上述真实模型验证为一组两轮。另用受控执行器重放旧冲突原文，确认运行时拒绝混合决定。在同一旧档中用合法单分支解析纽约。明确批准只应用已存目标，拒绝不触发动作，两者均无需再次调用模型。模块定向 78/78，独立定向 62/62，包含旧私有研究计划恢复、限定海纳的补答无网页授权、原控件变化与旧确认兼容。模块补丁与复跑命令见 `iterations/data-globe-and-clarification-contract/runtime-evidence/runtime-validation.json`。

### 合流

源码合流提交 `b550008bc2cd0cc3055e8e58fc8684cc7cab95bd`，树 `c6a46d9d55e2a10d55208750204bfbd0ee12a656`，保留两组独立验收对应的源码。合流类型检查、生产构建及全套通过，924 项通过、7 项环境门控跳过、零失败。随后针对独立 PostgreSQL 启用 Chat 移交门控单测并通过。全套及单测命令分别为 `node --import tsx --test --test-concurrency=2` 和设置独立测试库 `ONEEARTH_CHAT_TEST_DATABASE_URL` 后运行 `node --import tsx --test server/runtime-chat-channel.test.ts`。两项均由总体在隔离实例签收。正式 5474 首页切前后 SHA-256 一致，本轮没有正式发布或更改默认模型。

## Mac mini 工作台和球体动作隔离验收

独立候选 `82bf8a8b78d2b6534502b87647e646d0da349212`，源码树 `aa701a7201ce7aea3d4430600b61f02554351914`，入口为 Mac mini 隔离 8074。静态文件 3,427 项，逐件清单 SHA-256 为 `f85424b1d557a4a0dfc0c3865b0848abe5eed4c6365a1ce93f20c51a3a4a3f2e`，首页 SHA-256 为 `b66ecf1989521f8a0790103da1175a6a9ccab5d9d03d1dc32e39ae46000e921f`。常驻工作台未变更。

森林正式公开清单 1,041,268 字节、4,791 个日期，SHA-256 为 `da25a7d0c758fdb138e1435082d324a68a6ad312067de2c5673e8b5e048be8a3`。隔离时空实例复制原清单及走查所需的 15 张实际图像，两端核对强 ETag 和原始字节。2016-05-14 与 2024-03-26 分别为第 1,201 和 4,002 项。2021-12-24 的下一已发布日为 2022-01-30，2021-12-25 没有发布图。浏览器和模型各自使用有界快照。运行时通过清单核成员并绑定动作修订，未将全体日期或图像地址交给模型。

主程和网页受控 Chrome 检查远日期和手动选择共用结果，二者得到同一目标图，SHA-256 为 `a4688f39e208d06c46ecb802c8efc311c6d4e498bc677ddcfbc043d03e4f7596`。另核目录换版和手动切换均阻止迟到回执，未发布日期不触发错误图片，图像失败可重试，同浏览器保留动作应用证据，干净浏览器只显示原提案。收藏走真实收藏目录请求。模块定向 60/60，隔离整版自动测试 908 通过、7 项门控跳过。

独立 QA 第一次真实提交的收藏 `39e40a7f-9c0e-48ed-aec8-d4331051b98c` 与森林 `df6bd2dd-f27d-44f0-88da-2eeb882f43ae` 各产生正确提案。采集脚本在读到提交编号前结束了浏览器，首批仅证明模型和运行时。其真实回执随后在浏览器受控回放，收藏和目标图均应用，零额外模型调用。修正采集器后，原句各复验一笔。收藏 `541e012e-c6ee-4e33-a997-9b412a2c8454` 实际进入收藏列表。森林 `b4b9a8f0-fdd7-4211-bf48-03226ba7ae5c` 从 2016-05-14 切到 2024-03-26 并取到该日 WebP。复验从 POST 到浏览器打开收藏为 9.878 秒，到森林成像为 8.876 秒，模型规划分别为 9.572 秒和 8.411 秒。两组四笔各由 Codex `gpt-6-luna` 决策一次，均没有后台研究任务、发现委托或网页工具授权。真实运行时复核 `iterations/workbench-globe-actions/evidence/actual-8074-four-task-audit.json` SHA-256 为 `b91a5b53d7f9be1bd9c345a1cd91f389c6e14383871dfe58dfe5c3edb836ebe1`。 独立索引 `iterations/workbench-globe-tools-independent.aEoF96/82bf8a8-independent-index.json` SHA-256 为 `d32dc9abcb1ec6ec204aca451c1b05fee49cb073f4f2413678f3a508247f83cc`，收录两轮真测与分别 11 项的运行时和网页受控复跑。

与追问弹框合流的归档代码树为 `cd1785a67b94c0f9fe582301b94e021818aaffd1`。完整测试 926 项，919 通过、7 项环境门控跳过、零失败，类型检查及构建成功。合流定向 53/53，覆盖明确批准森林远日期、直接输入确认用语未获批准及已改变控件后的拒绝。两组受控 Chrome 各 11 项在合流构建通过，证据目录 `iterations/workbench-globe-actions/combined-evidence/` 中 `clarification-browser.json` SHA-256 为 `71b34e61983daf1d28770a1b0a24513af8a84b21e62229a5290dd95d722c8626`，`workspace-browser.json` 为 `31e43d321e657dd8641bfd4f91013d2f4d739ee777e5bc6b46148e21c7234953`。无数据日的手动输入仍可修正日期，未给无数据日构造已发布的活动控件。

## Mac mini 人工追问弹框隔离验收

候选 `52a086e245a750d0f39333a1d9bce7c4c5e1b33b`，源码树 `c2d2c161f0714550cdbdbb3ced51dd4c240788fb`。Mac mini 隔离工作台 7974 使用本地模型夹具、真实 HTTP、PostgreSQL 与独立发现进程。同构建的 7984 使用独立任务库供本机真实 Chat 模型复测。静态文件 3,427 项，逐件清单 SHA-256 为 `b6f41575e85f033df849e6c4082c97259347f9f38a676dcdc15e35ddd9064a20`，首页 SHA-256 为 `30489be50b6cb679e54c62fc02a8c225d16b5c12bd2b0e58e80815487ed998d0`。常驻 5474 和旧实例均未切换。

主程经 7974 实际请求核对带选项的 Chat 追问、同一消息重送、另一会话与改写选项的拒绝、明确批准前后回执，以及研究 Task 的询问、答复、再次在本地追问、沿同一发现 ID 续接。研究原问题 `d0e1a8bc-9dc5-4a52-b382-73dc86b14ae1`、本地再问 `70bb3a22-7bef-4c3b-a48f-5a5b1b29f9b3`、续接 `3abdfa92-ca7d-4348-84f8-377dbb1e9842` 保存于隔离库，发现 Task `cfc4e8b2-b297-427b-bda6-c9a2a9050d13`。中间的本地追问未新建发现绑定。另以固定模型和回环适配器复现并对照了「只在海纳」的普通追问转研究，最终 A2A 沿原问题、附所答条件，网页工具授权为零。

候选之后的 `d6db30b` 只补足新增测试的 TypeScript 分支收窄，应用源码与浏览器构建逐字一致。类型检查和构建完成。全套 913 项中 906 项通过，7 项环境门控跳过，零失败。使用新建隔离库单跑 PostgreSQL 通道回归，证明不同答复编号竞争时只受理一个，同一答复重送只执行一次。复用已留有排队样本的测试库会影响既有 worker 领取断言，正式计数来自干净测试库。网页模块另用受控 Chrome 核对桌面和 390 像素宽度、键盘、稍后、刷新、明确批准与旧研究回复。

独立 QA 在 7984 从伦敦页面发一条缺城市对象的问题 `d8050970-346c-4ddf-bfbe-6c4c1f1cd076`。真实 Codex `gpt-6-luna` 返回一条人工追问。关闭后从原问题归档的弹框自由填写「纽约」，答复 `bb4b10ab-09d4-4b43-a5e2-083c8ac1aa34` 与原题在同一会话，运行时保存一次父子绑定，浏览器选中并加载纽约图。两轮都在前台完成。受控 Chrome 另复核同一发现 Task `53f499e4-4799-4fcd-a13f-ba7ca934c5e5` 续接、本地二次追问、关闭和拒绝不应用、刷新后明确批准及同轮双击只受理一次。已有 ID 重送返回 202，完成后另一 ID 及另一会话的无效答复被拒。普通回答和无选项弹框可见。机器等待保持进度由单独的受控网页夹具验证。独立索引 `iterations/clarification-dialog-independent.cAPuMN/52a086e-independent-index.json` SHA-256 为 `a6d10d6c9f938c58738b66907f9388ef3c443da721291a56589b8d40eee45d9e`。

主程复跑在本批隔离副本使用 `npm run check`、`npm run build`、`node --import tsx --test --test-concurrency=2`。本机证据位于应用数据目录 `iterations/clarification-dialog/evidence/`，其中 `live-controlled-probe.json` SHA-256 为 `e58261f62449a318bc58be6dd4b3f3f67723909a6954fa27c528073c67aabe26`，`source-continuity-fixed.json` SHA-256 为 `7940a31a25b89e8bbfc5b36eef40dc2e5f54077359928df6c3766a72264feab5`。请求示例和归属见[架构与接口现状](../../docs/架构与接口现状.md#人工追问弹框隔离候选)。

## Mac mini 工作台后端合并正式发布

2026-11-23 21:14:31（上海时间），Mac mini 正式 5474 启用合并的工作台后端 **v0.2.0-rc.10**。上线提交 `07000e8bd7603af6a91fbb13f29146fedbba23f2`，源码树 `96bd7d8599ace346fcd1fc0520257400e78b6b82`，发布目录 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.10-07000e8`。实际工作台后端 PID 39710 同时监听 5474 和回环 5477，研究 worker、发现、时空分别使用 PID 39709、39707、39708。5474 与 5477 保留各自健康响应，5474 保持原回环及被授权的局域网入口，其余内部监听仍是回环。切前、切后 3,532 个静态文件逐件同字节，原构建清单 SHA-256 为 `04d2a110ef90ac682534fdcf6c0ab6110fe8a77e9cf62e74efee7df0a7b9e971`，在线首页 SHA-256 为 `7a714e4d7d3e955a0dac850ee3955e2e5dac9f83a91246cca4d758969e289fdd`。

**隔离验收。** 在 7774 和 7777 上用默认启动验证实际同 PID，通过 Node HTTP 与 Undici 账本区分入站和出站，普通请求无工作台向自身 7777 的出站，合法授权的工具回调有私口入站及一条持久完成回执。公开工具入口返回 404，私口无授权返回 403，重用调用编号变更输入返回 409。受控星座数据在公开入口授权写入返回 201，未授权返回 401，回环 SSE 看到该次写入。旧 Landsat 原档及 123 条事件与正式冻结样本一致，Chrome 重开及刷新通过。受控模型和供应商夹具配合实际 HTTP、Chrome 与 PostgreSQL，未使用真实外部供应商。

独立 QA 在同一 Chrome 输入框验证研究 worker 已领取后纽约前台先完成，研究放行后回复仍回到原轮。首次浏览器事件断开后以同 UUID、同输入重试一次，仅生成一条研究队列记录，纽约无队列记录。独立原始 HTTP 流在 6882 断开，经 `after=6882` 从 6883 续到唯一终态 6927，与完整事件流一致。主程另从 7774 取消已领取且已有发现委托的研究，收到 204，7777 可见同一取消终态，发现 Task 变为 `TASK_STATE_CANCELED`，重复取消返回原有 409。独立索引 `iterations/workbench-backend-merge-independent/07000e8-isolated-verdict.json` SHA-256 为 `6ce5f0e542caf02e516adf37949b5679373efd7dfe0125b65dc636c784ae09da`，核对 10 项证据摘要。类型检查与构建通过，903 项自动测试中 896 项通过，7 项环境门控跳过，零失败。另以独立临时库验证私口被占时公开入口未启动、恢复后两个监听共同启动、SSE 随正常停止关闭，以及显式 `web runtime` 原拆分启动可用。

**正式保护与回退。** 等待队列排空后短暂停止受理，沿用原 PostgreSQL、Garage 进程与权限配置。切前 65 个运行时任务、51 个发现作业、2 条 Chat 消息的已保存内容与事件指纹一致，120 条运行时引用一致。停写备份含三库、10,839 个对象及另存的应用状态和授权原件，备份清单 SHA-256 为 `e83a7fdb647fd8add3a82142f9780e850931ee5285d88b53e937b7256e90be25`。在独立存储实际恢复，10,957 条时空索引均有对应已恢复对象，4 个 SQLite 副本通过快检，恢复的授权原件可读，原纽约前台结果可从恢复数据核对。保留旧发布和已演练的启动指针回退，沿用当下 primary 数据。

**正式复查。** 同一台 Mac mini 经回环和实际 LAN 访问，拒绝其他 Origin 与伪造 Host，公开内部工具路径 404、回环缺授权 403。通用工作台、既有研究、森林与 C40 对象按原入口可用；真实森林 4,791 日清单和 C40 95 城清单切前切后同摘要，森林末日 2026-05-24 的 LAN 深链和刷新各取同一 WebP。主程以已完成的纽约消息原 ID 与原输入向 5474 幂等提交收到 202 和同一完成状态；回环 5477 及两个公开访问方式返回原归档，事件和队列均零新增。旧 OISST 研究的 90 条 NDJSON 中，从 `after=12182` 原序接回至终态 12187。正式复查沿用已保存结果，未发起新模型或研究。

独立正式 QA 经同机 LAN Chrome 重开并刷新 OISST 归档，从 `after=12186` 接回唯一余下的终态 12187，并核对旧 NYC 归档与 C40。QA 全程只用 GET 和 OPTIONS。同总体独立复核完成正式签收。证据索引 `iterations/workbench-backend-merge-independent/07000e8-primary-independent-verdict.json` SHA-256 为 `bb68a9f1a1db1aef81650ffb04a5aea1e80544cba321f218ba8aeb3582ce42f2`，核对 6 项文件摘要。主程证据位于应用数据目录的 `iterations/workbench-backend-merge/primary/`，执行 `shasum -a 256 -c evidence/production.sha256`，库外清单 SHA-256 为 `e003dd43183fee5a72009ce3d6f71c9cd2d15b39448693d1ebc6a9414f7707d9`。

## Mac mini Chat 前台消息与研究交接正式发布

2026-11-23 20:01:20（上海时间），正式 5474 切换到 **v0.2.0-rc.10** 整合源 `2c0b7eacade1f3f3af19c6d0b337637485b32661`，源码树 `094082d7b84ecc3fa799434778eb64120965fd43`。发布目录为 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.10-2c0b7ea`。基线为隔离验收归档 `4f08f4a`，运行时、发现、时空和网关服务源码与签收候选 `4c2b14f` 逐字一致。切前在线后端为 `09aeac7`，实际网页已含森林按日期加载改动，切前首页 SHA-256 `f0f893e36bd7eeb207656814d4a1c31402889d505a4bcfb9af420e3f1abb158f`。本次将这套森林前端行为与前台 Chat 合入九个网页及验证文件。

新构建含 3,427 个静态文件，清单 SHA-256 `284c9f5a926bc76ab5d80f529ed9f14ab91fefd42d88117de0fb1719d1e9e271`。正式目录另保留 105 个旧内容寻址资产，共 3,532 个文件，逐件清单 SHA-256 `04d2a110ef90ac682534fdcf6c0ab6110fe8a77e9cf62e74efee7df0a7b9e971`，在线首页 SHA-256 `7a714e4d7d3e955a0dac850ee3955e2e5dac9f83a91246cca4d758969e289fdd`。隔离构建、类型检查通过，全套 902 项中 895 项通过、7 项环境门控跳过、零失败，前台 Chat 与研究 worker 的 PostgreSQL 并行测试另在实际隔离库通过。

**森林与 C40。** 独立森林流水按原流程运行，在 20:00:24 自然完成，与应用发布分开。它逐批检查 S3、PostGIS、HTTP，共发布 4,791 个日期，原始嵌入记录按日期分区共 145,737,429 行。切前早期默认目录为 12 个逐月样本，另有 2023 年 358 天的试点。隔离只读预览分别复验两种目录，并以试点实际对象和受控 Chat 回执核对 2023-12-24 深链、发问快照及切到 2023-12-23。全量完成后，正式默认与 `daily-v1` 清单同 SHA-256 `da25a7d0c758fdb138e1435082d324a68a6ad312067de2c5673e8b5e048be8a3`，实际日期 2013-01-30 至 2026-05-24。正式 LAN Chrome 深链打开末日，首次及刷新各只请求该日 WebP，SHA-256 `2e6a4748c3a6deaa1d4f79ca4c296fb65c879b389f7388aceb588c1d29ca72d7`。C40 的 95 城与原城市对象逐件核对；正式清单保持 `cb4614fb7ea7ad6428af77866dc2faf97383e66a8ac740aa20b84d9aeae28a1d`。

**存储与回退。** 停受理前运行时、发现均无排队或运行中的任务，未中断用户研究。保持原 PostgreSQL、Garage 进程和访问配置。切换前暖备份已在独立 PostgreSQL 与独立对象前缀恢复。正式停写封存三库、10,839 个对象、应用状态、授权原件和原启动配置，备份清单 SHA-256 `dc96a0561545bd4452045e76d62c0129d057d50bfcfcd75188da0529078d65dc`。同一份停写备份实际恢复三库及所有对象，10,957 条空间索引与恢复对象逐项匹配；四个 SQLite 副本通过快检。恢复的 KEO 原件及登记仍能读出 `WSPD`、`m/s` 和 130,402 条非缺失记录。切前 64 个运行时任务、48 个发现作业及对应事件、116 条运行时引用通过指纹核对，实取了旧网页、论文、KEO、Landsat 与 C40 归档。保留旧发布和原启动配置，已用配置副本演练原子指针回退。应用回退沿用当前 primary，旧页面访问新增前台消息需重新启用支持该接口的版本。

**角色和访问。** 五个实际应用角色从新发布目录运行，核过源码文件与健康口。回环和同机 LAN 获得同一构建、旧 C40 档案及 10 条同字节原事件。非同源 Origin 和伪造 Host 返回 403，外部请求内部工具路径返回 404。只有工作台 5474 按原方式提供 LAN 入口，5475、5476、5477、55432、5900 只监听回环。本轮 LAN 浏览器证据来自同一台 Mac mini。

**同一对话实测。** 独立 QA 经正式 LAN 用 Chrome 提交一笔 OISST v2.1 公开资料研究 `89c248ec-2c83-4a79-a212-dd22fd285d65`。20:03:39.209 由原 worker 领取，20:03:39.317 发现受理原 A2A Task `ea13083f-7767-485a-bb72-18a9ce1dce25`。确认 worker 正在执行后，20:03:39.540 从同一对话、同一输入框发送唯一一条「切换到纽约」`d53e4bf5-2d8d-4e9c-8f97-05d45b2c1d93`。原研究自然运行，测试未人为延迟。纽约前台只调用一次 Codex `gpt-6-luna`，提示 6,393 字节，首次提出 `New York City`。运行时在同一 95 城目录查证 `new-york-city-usa`，该消息未入研究队列、未建发现委托或网页工具授权。服务端受理至可交付 10.168 秒、至终态 10.170 秒；浏览器发送至可见回复 10.583 秒、至纽约成像 11.182 秒。20:03:50.723 成像后原研究仍在原领取状态，未挂起或释放 worker。纽约显示 2,260,340 个中心，图像 SHA-256 `1ae40c8b399ca718747c54159139fb29077196eaa4bd2b63e17b224672a45606`。

原研究由同一消息编号交接并于同一对话原轮完成，服务端受理至终态 132.096 秒，浏览器至研究回复可见 132.294 秒。原轮定位链接与提问相符，研究答复到达后地图仍显示纽约。公开网络是唯一启动的发现渠道，另有两笔定向补读。三次 Search、八次 Fetch 中两次 Fetch 失败，保存四条实际出处。资料答复明确交代获取到的官方目录元数据及未取得 NOAA/NCEI 关于处理差异的原站正文。正式验收覆盖消息交接、并行切城、原轮归档及地图保持。

独立 QA 与总体正式签收。独立索引为应用数据目录下的 `iterations/primary-lan-foreground-independent/primary-foreground-independent-verdict.json`，SHA-256 `32d897b2462abe66a4211f8958b6486c311c1c41ee308b84049b213dfc0b13eb`。主程证据在同一目录下的 `iterations/foreground-chat/primary/`，从该处核对 `shasum -a 256 -c evidence/production.sha256`，清单 SHA-256 `a0e7335eb92e62b3df8378227952b45614b53ac58635d00262e7379404bb5a58`。

## Mac mini Chat 前台消息与研究交接隔离验收

基线 `02c1d49533dff5dbfd53f2742e5752fb72e1a75f`，隔离候选 `0a52bf4d28ef7bb01e1c6149245af5d537713db9`，源码树 `7f1ce62e8c06a6c2411359ded9fac5ef9d86eb8c`。7474 的 3,427 项构建清单 SHA-256 为 `050d9a3e487d18d4f94b6d56b509bcdfd71f4c936cf5502f5ec4b1f6e96de2f5`，首页 SHA-256 为 `233650f2c72e76f4facdb1150261bc8c8b8fca3e29c85ec056971fcf64c14ec6`。三份隔离数据库独立命名，使用既有隔离 PostgreSQL 实例及单独账号。对象使用本轮单独的 Garage 与桶。完整 C40 95 城发布原件逐件核对，清单 SHA-256 `cb4614fb7ea7ad6428af77866dc2faf97383e66a8ac740aa20b84d9aeae28a1d`。常驻 5474 沿用 `09aeac7`。

- 类型检查和构建通过。全套 891 项中 884 项通过，7 项环境门控跳过，零失败。新增的 PostgreSQL 消息交接测试另行在真实隔离数据库通过，涵盖幂等接回、同 ID 冲突、同会话顺序、事件续流、取消与中断恢复。
- 运行时受控定向 61 项通过，涵盖新旧规划、单次调用、权威城市查证、可信待办、普通地球与森林、限定渠道与确切资料。仅使用受控模型输出的轮次据此验证执行和校验行为。
- 网页受控 Chrome 16 项通过，涵盖同一输入框继续发送、研究同时保留、旧记录重开、断线续接、单轮取消及工作台陈旧回执。以现用浏览目录中的 ERA5 对照，21 项的当前页向模型提供前 16 项。普通 Chat「比较第一份和第二份」打开 `haina:1824119` 与 `haina:1824145`，「打开第二份」进入同一份 ERA5-Land 资料速览，窗口外成员被拒绝。

**7474 真实首轮。** 同一 Chrome 会话内，原句「切换到北京」和「C40 城市选项切换为 London」分别由 `110ecbdb-6112-43d8-b609-7bccbb039223` 和 `a7196ca7-f18d-4552-a74d-1043941d499e` 完成。两笔分别只调用一次模型，提示 3,816 / 3,900 字节，运行时受理至终态 9.873 / 9.856 秒。旧 `09aeac7` 受控真实模型对照中，北京、London 原完整提示分别为 9,475 / 11,894 字节，北京三次首发到回执中位数 11.807 秒，London 三次未交付动作。旧对照与本轮采集起点和负载有差别，分别保留各自口径。

同一会话中的真实 Landsat 研究 `db62e349-bc69-40ab-9543-c4abed162fac` 由原 worker 领取，初次发现请求在转发前人为扣留约 96.4 秒；期间同一输入框的「切换到纽约」 `975e6ccf-05c6-4a34-9081-9240b2784158` 在 8.425 秒内前台结束，零研究入队。该轮把 London 邻项误当成全量，产生错误澄清，地图保留 London。其原档作为失败留存。释放后原研究在同一轮和委托路径结束，总耗时 234.520 秒。USGS 网页正文读取未成功，答复将实得换算依据标为 GIS Stack Exchange。

同版本另用真实模型核了不明对象、操作疑问和明确否定，均无界面变更或研究任务。不明对象得到追问；此笔未保存具体确认目标。固定迟到回执在用户手动切到北京后被拒。首轮独立索引 `iterations/foreground-chat-independent/0a52bf4-independent-verdict.json` SHA-256 为 `21361739abdd0487b0cc663c382c8c789cd466e3f533bb2303ca586f3c0fe68e`，主程汇总 `iterations/foreground-chat/evidence/first-stage.sha256` SHA-256 为 `122a3ecf8d34fc50174881fc2507d92032356885fa93add9d71c3107871e7e70`，两者均相对于 Mac mini 应用数据目录。

**7574 修订复验。** 源码 `4c2b14fee4c1d6b141b1bdc90910fbf1d6965c53`，源码树 `5f240dbb3d0f7580ecd18401b9584c9b89d458b0`，从前述 7474 候选增量构建，3,427 项前端文件逐项同字节。使用另三份隔离数据库、另一个 Garage 桶和相同 C40 发布。修订模型输入将可见邻项与 95 个发布名称分开。完整名称数组占 1,141 字节，128 项或 4,096 字节任一超限标为不全。运行时精确修订全套 902 项中 895 项通过、7 项门控跳过、零失败。定向 49/49，覆盖未知名称、普通地图、同修订查证、错目标与换版拒绝。固定模型回放保留旧纽约失败。

真实研究 worker 领取了受控海纳研究 `d8d2153b-481b-4970-ab98-de89399c60b9`。隔离代理在生成受控 A2A 受理回执前扣留请求，期间无挂起步骤、未让出名额。Chrome 用户从同一输入框提交原句「切换到纽约」，新消息 `9fb8315f-91a6-4d21-a82d-5875d0aa9da6`。浏览器发出的 London 邻项没有纽约，真实模型从同修订的发布名称中选 `New York City`，首次规划使用 `resolve-control`，运行时核准 `new-york-city-usa`。受理到可交付约 8.84 秒，浏览器请求到纽约成像 9.941 秒。一次模型调用，提示 6,246 字节，输出 256 字节，零研究任务、发现委托或外查授权。浏览器加载同一目录第 91 项 WebP，SHA-256 `1ae40c8b399ca718747c54159139fb29077196eaa4bd2b63e17b224672a45606`，显示 2,260,340 个中心。纽约可见后确认原 worker 仍占槽。释放后同一研究收到受控零命中结果，回到原轮并保持纽约。活体采集脚本在最后读取定位链接时出错，使用两条原档、真实浏览器截图和只读刷新补核，无重复提交。此次复验未再次调用外部资料供应商。

**明确确认。** 浏览器消息 `e5508b4d-e21d-43cb-b2c3-1ea389e5b880` 请求先确认再切换北京。前台保存 `beijing-chn` 与原修订为待办，终态无可执行动作。采集脚本卡在读取浏览器受理响应后，从正常归档链接在干净 Chrome 重开原轮，显示原待办，地图仍为上海。随后只发一条确认消息 `d5d05d9d-bda7-4a5d-9f26-2aa9feac1a1b`，原话为「确定，按刚才说的执行。」同会话请求、真实模型的批准及原待办 ID 一致，原北京目标被应用，真实刷新保留北京。两条均无研究入队，各一次模型调用。受控回执另核了错误目标、目录换版、缺具体提案的同意及浏览器陈旧状态。

**收藏兼容。** 旧 7374 工作台原句「打开我的收藏」会进入收藏筛选页。修订版在干净 Chrome 的同一普通入口提交该原句一次，消息 `8df560e6-03c1-43ff-b1c7-fcfde8709603` 经一次真实模型决定返回 `open-saved`，网页进入 `?view=discover&section=entities&saved=1`。浏览器约 11.46 秒看到结果，无研究任务、发现绑定或外查授权。

核心隔离行为通过总体验收。修订独立索引 `iterations/foreground-chat-independent/4c2b14f-independent-verdict.json` 的 SHA-256 为 `cf71b4047cbd2ce9554375c7257242d696c56c8fa9120dd2f7976d68effd15ce`。主程 20 项证据清单 `iterations/foreground-chat/directory-evidence/acceptance.sha256` 的 SHA-256 为 `2f093c83503a01a8128e31333405560c89cd49b5dfae68a79b990b8fe4fc0fa0`，含精确集成构建、全集、已确权发布、代理占槽时序、原首轮证据、确认归档及收藏回执。

[前台与研究交接接口](../../docs/架构与接口现状.md#普通-chat-的前台消息与研究交接)

## Mac mini C40 目录与工作台上下文

隔离候选 `09aeac7ec14a3ed1fe7fbd57f6d46e66e0d5880c`，源码树 `9876d60230633adef26f43c88d6ec2f849da7ecb`，基线 `32057738119a35149f658bde50cadd66c28646fe`。3,427 项前端构建清单 SHA-256 `d3db67f8ae80d5df0d7cfc6fc0fff39d8735745a771c251dce95f930088cc577`，首页 SHA-256 `5ddeacf1f882edcd1690415ded4862b4b7796658648d2b7704f9f8bc65af00b5`。独立 7374 使用独立 PostgreSQL 和 Garage。验收目录按正式库存顺序选取前 60 个已验证城市投影，图像为实际发布的同字节对象，目录只在隔离环境使用。该清单 SHA-256 为 `671032707fcafb8b5cd1c5b4c244fbc6a1d7cc21f5999dd9450b10f96ec5e26c`。

- **C40 真模型与手动。** 同一 60 城目录第 50 项 Sydney。手动和任务 `2bdddc64-ad82-47c2-9248-75eaa2ea47c2` 均选 `sydney-aus`，各切换阶段各读一张同 SHA-256 图像 `b29b45773646661758ef5ef8f1a44ee00eeb9cb50977d86c6fc056f19946b97a`，显示 324,745 个多边形中心。浏览器发问时只发送上海、北京、广州三项及同源清单修订。运行时读取 37,709 字节的权威清单后只将四个相关选项提供给模型。Codex `gpt-6-luna` 第一次规划选用稳定 ID，运行时重验修订后加到回执，浏览器用同一已加载目录和控件应用。
- **回归。** 普通地球同句任务 `a9f916f0-e4c9-445c-8e43-1ce239b10588` 经过实际导航路径及受控 Photon 返回，地图飞到 Sydney 且保持普通地球。森林同句任务 `bb977a7f-8b7a-4167-b794-e3b02e24d657` 与 `e0f0ae2d-637d-462d-bb45-ceca0369a3b9` 分别回答实际选定的 2023 年 1 月和 8 月。四笔共六次真实模型执行，零发现作业、源补读绑定或网页工具授权。受控对照覆盖换修订、迟到回执、明确镜头定位及缩放、未知城市不切换、弱 ETag 时保留手动浏览、宣传页来路及旧深链。
- **代码验证。** 完整测试 876 项，870 项通过、6 项既有环境门控跳过、零失败，类型检查及构建通过。

隔离独立签收索引为 `isolated-09aeac7-verdict.json`，SHA-256 `e671867a3b8ada1ae6be4f207aeab7df783bebe9f9e4d427ecb99c10b551a06c`。总体通过隔离验收。

**正式切换。** 2026-11-23 15:37:40（上海时间），常驻 5474 切到同一候选的前后端，服务标识为 rc.10，实际源为 `09aeac7`。全量发布管线先完成 95 城、53,474,134 个多边形中心。主清单和 `full-v1` 清单原字节及 SHA-256 `cb4614fb7ea7ad6428af77866dc2faf97383e66a8ac740aa20b84d9aeae28a1d` 一致，95 张 WebP 共 36,917,544 字节，逐张对照发布回执，通过切前切后核验。构建内容与隔离版一致，另外保留 60 个已有页面可能请求的旧哈希资源。正式静态目录清单 SHA-256 `e9c8e01fb8ed9177871048c2710d067ea296fd2e6d048c75a0270a3aaf17ac34`。部署沿用原主库、对象桶和局域网配置。

**备份与保留。** 停止应用前确认运行时和发现队列已排空，在受理受控窗口保存三库、6,046 个对象、应用状态、登记原件和原发布指针。备份清单 SHA-256 `a54b4c5110bced62629aee4147ddc90b74a7899b8f6901bed16bb8fdfdc0887d`，对象逐件复算。切后原 50 个运行时任务及 40 个发现任务和事件指纹一致，抽查旧论文、网页、KEO、Landsat、原 C40 研究档案和森林图层，原字节一致。独立 PostgreSQL 集群的新临时库恢复了三份备份并核对表计数、两条 C40 清单索引、原任务样本及 SQLite 完整性。新建临时集群的首次尝试遇到宿主共享内存 ID 上限，冷恢复改用本轮隔离集群的新库完成。回退应用指针仍可沿用当时的主库数据。

**正式局域网只读验证。** 一台 Mac mini 分别从回环和实际局域网地址打开新网页，选择第 50 城 Sydney，核对 324,745 个中心和相同对象，刷新后保留选件。总体独立经同机局域网地址选择第 95 城东京，显示 4,898,729 个中心，请求仅上海与东京各一张。总体只读证据 `large.json` SHA-256 `cffaf6511993b78115bf40e18b244e41c6f4cecfa5037007b46483f3b261408e`。跨设备连接不在本次实测范围内。

**正式 Chat 验收。** 独立测试在同一台 Mac mini 经局域网 HTTP 地址使用 Chrome，从上海提交一次「切换到 Sydney 看看」，任务 `8b2cd447-8acd-49a1-a27c-ec8942a883c3`。浏览器发问时只带三项，其中没有 Sydney。运行时从上述 95 城同修订清单筛出四项，`gpt-6-luna` 首次选定 `sydney-aus`。手动和 Chat 每次切换均只读取一张同 SHA-256 的 Sydney WebP，实际显示 324,745 个中心，相机为 `[151.05312868, -33.87126398]`、缩放 `165`。归档重开、真实刷新保持选件。任务只执行一次模型规划，零发现委托、正文补读或外查授权及调用。受理至终态 122.332 秒，其中 110.069 秒在等另一笔已运行任务完成，实际执行 12.263 秒，全程无需重试。

总体通过正式验收。独立索引 `iterations/c40-chat-independent/primary-5474-c40-verdict.json` 的 SHA-256 为 `a653af88d7e8e9c295d4ff44f2a90b7d2f455af50978a3f7a51367cfb76acee7`。主程证据清单 `iterations/c40-chat-release/primary/evidence/production-acceptance.sha256` 的 SHA-256 为 `66a8c1a2416840e88b86a2d214d9fcd8bada5d0f93ad06083ac512e313badd42`。两份索引均相对于 Mac mini 的 OneEarth 应用数据目录。

[城市目录与工作台回执职责](../../docs/架构与接口现状.md#c40-城市目录与按需图层)

## Mac mini 普通 Chat 工作台上下文隔离验收

2026-11-23（上海时间）阶段签收。基线 `440deeeed39fda45e909c85ae3d701fc82862ac4`，候选 `40f6e4b8b8e92016f3a805326c8e08621ace0176`，源码树 `814e6db2f90ed0448ad578ca1ca5844c8eab2650`。3,424 项构建清单 SHA-256 `9de70a7ea689d2b34c4073282a375e8ad6161de4b23deac5fc161ca90b3ec22d`，在线首页 SHA-256 `a306f4c33cc94ad217cf83d7f5f00fbf186b4fd077a72946cc5aae5d6f9e3d37`。隔离工作台端口 7274，使用独立 PostgreSQL、Garage 及从仓库原图层导入的 17 件对象。常驻工作台沿用 rc.10。[快照与回执职责](../../docs/架构与接口现状.md#普通-chat-的发问时工作台状态)

**同一句指示，两个实际界面。** 使用干净 Chrome、相同空历史和原句「切换到上海看看」。C40 北京任务 `152a038c-8448-44e3-a764-76850bdb0b1a` 将真实城市选择及 121,404 个多边形中心送入规划。Codex `gpt-6-luna` 选 `c40/city/shanghai-chn`，浏览器按原有城市控件切到上海并显示 162,604 个中心。普通地球任务 `4231836c-ee7c-425d-a71d-2ad1c1e3f050` 的规划选择地理导航，控件动作为空。运行时通过正常 Photon 适配入口取得本轮受控地名结果，保存上海相机目标。真实提交后的首轮探针等待定位标记超时。随后用原已存回执在同构建 Chrome 复演，实测视野坐标从 105.00°E、25.00°N 移到 121.43°E、31.20°N，停稳后标记可见。复演未提交真实研究、调用模型或访问外部地名服务。

**森林独立真实问答。** 相同「我现在看的这期是哪年哪月？」和空历史，实际手动选择 2023-01-15 及 2023-08-15。任务 `60a0fcff-74a6-425b-96f2-6358500b7ebf` 与 `2e63a1f1-4ac0-48bf-934f-a826da1bc89a` 的原上下文字段逐项一致，变化来自发问时快照。实际规划上下文与浏览器投影一致。两问均由同一真实模型选择回答并生成一次答复，分别给出 2023 年 1 月和 8 月，画面和控件日期核对一致。以上四笔共 6 次真实模型执行，均已归档，零发现作业、零发现绑定及零网页工具授权。独立森林 verdict SHA-256 为 `a570e8731c7b48063b9bd8bf43d7cb08399b0f6b2cd2d5a02ca0fb2a7d13dfa5`。

**受控边界。** 实际 Chrome 和固定回执验证了城市操作同一飞行自然结束、发问后拖球或另切城市使回执失效、历史重开不重做动作、风场时效、降水已发布月份和地震与气象子页状态。无关问题沿原有答复，未授权、无效选件和越权读取均有定向反例。模型和控件回执按各自实测或受控性质记录。集成全套 862 项中 856 项通过，6 项既有环境门控跳过，类型检查与构建完成。

证据根为 `~/Library/Application Support/OneEarth Next/iterations/workspace-state-chat/`。结合 `evidence/workspace-state-acceptance.sha256` 核查部署指纹、真实规划与回执、实际浏览器及受控轨迹。从冻结独立副本运行 `node --import tsx --test server/runtime-workspace-view.test.ts src/domain/workspace-view-context.test.ts` 复查运行时与共用校验。在该副本执行 `node ../evidence/replay-actual-earth-receipt.cjs` 可用留存回执复演普通地球。网页协作者以 `node --import tsx ../web-evidence/verify-workspace-view.mts` 复查固定回执和控件，复跑浏览器对照使用隔离入口。

## Mac mini rc.10 公开网络工具与局域网正式发布

2026-11-23 11:34:46（上海时间），Mac mini 常驻发布 **v0.2.0-rc.10**，源码 `7d44a0b88e2bfb0f33e3e8f3dfe66005cdf065e7`，源码树 `4bdb200ed9f90dad9b03b0ff89db8abbf7c53019`，发布目录为 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.10-7d44a0b`。前端 3,424 项构建清单 SHA-256 `90634bcaf1d6fac6d3fecb750061ab84b7865118bb4a08310ad221726f24ef0b`，在线首页 SHA-256 `fb2604176d3bf9df199c8c6a1e3c6c7a60f37d67ef6f25e5d20f3db07e9faafe`。设置页显示版本。网关提供本机回环和指定网络接口的局域网入口。局域网来源限制在直连网段，工作台校验 Host 与同源 Origin。[横版实况图](../../docs/diagrams/oneearth-mac-mini-rc10.png)

**正式研究门槛。** 11:17:17 先把已签收 `b34fc5c` 切到原回环入口，使用原 primary 和静态页面。独立 Chrome 通过同一自然 Landsat 问法触发生产工作台。首笔 `374eaade-a034-4175-a67f-2824541958bf` 因两次规划包含 `fallback:null` 未启动工具。11:22:36 切到 `418b25f` 后，同题复验 `ee7ed6c1-b9a5-4417-a1af-ce6d210cea9a` 因两次规划用 `scope` 代替 `mode` 未启动工具。两笔研究与等待状态原样保留。修订补齐模型提示的规范对象和字段修复说明，兼容缺省等义的 `null` 及仅出现一次、值合法的 `scope`。双字段、未知来源、额外字段和非法回退组合仍拒绝。两笔四段原始规划分别离线重放，各只执行公开网络，独立验收复跑一致。

11:28:11 切到 `2d1fc8979ab78b6d0056fa07e1ecf5ed60f09019` 后，同一问句用新研究号 `4571dbdb-2092-4f97-8b3b-1a694e79f131` 完成真实复验，受理至终态 162.809 秒。初始发现 Task `d2d11d7e-238d-414e-97cc-3d8d00d1ac57` 的三笔 DeepSeek Search 和三笔 DeepSeek Fetch 均在运行时执行，并逐笔回原 Task 与消息。USGS Fetch 编号 `e8390cc1-4463-4cec-b27e-61f9ed97d49e` 的 5,200 字符摘录与原发现结果、最终归档逐字一致。最终一条 USGS 正式引用支持 ST_B10 比例系数 `0.00341802` 和偏移量 `149.0 K`。精准补读 Task `6505072d-c9a4-4f92-88e7-8829ae003aa5` 另读同一 FAQ 一次。同题补查 Task `54334751-c04e-4c2a-beb7-03366ebfb7c4` 另有三笔 Search、三笔成功和一笔超时 Fetch，实际材料和失败状态均按各自委托归档。同一 USGS 摘录的重复读取未作多份独立证据。Chrome 重开和刷新均可打开原依据。独立证据 `2d1fc89-real-submission/independent-formal-pass.json` 的 SHA-256 为 `e0b00905cffb4ad613cf3527a032663c07b783b4b1ab4624bbc793270b4ebc12`。正式回环链路已签收，局域网在该门槛之后开放。

**常驻保存与回退。** 各次切换等待队列排空，用提交锁停止应用后保存三库、5,950 个对象与应用状态。最终切换沿用原 PostgreSQL 与 Garage 进程，原 45 个运行时任务、37 个发现作业及事件指纹前后相同。核对了两笔失败和正式成功研究的归档、原论文和网页记录、KEO 记录、图层目录和森林对象。最终备份在独立 PostgreSQL 套接字上冷恢复，任务与工具回执计数、四个应用 SQLite 快检及森林对象字节均通过。最终备份清单 SHA-256 为 `4b07636ac9d64e31ce88872afe6f3ee0d8044f027b1f1c844b328d9a4c6fb7f3`。旧回环发布、启动项、授权配置与停写备份均保留。回退应用指针使用当时 primary，避免覆盖发布后新增研究。

**局域网与工作台。** 同一台 Mac mini 分别经回环和 LAN IP 验证同版首页、健康、同一 Landsat 归档、森林对象和 123 条同字节任务事件。主程从 `after=6857` 续订，收到终态 6858。工作台正确响应同源 Chat 入口的无效编号校验，非同源 Origin 和伪造 Host 返回 403，内部工具回调路径返回 404。5475、5476、5477、55432、5900 的 LAN 地址连接全部拒绝，同端口仍有正常回环监听。独立 QA 经两个地址用 Chrome 核对设置版本，重开与刷新同一研究，查看保存的 USGS 依据，并从 `after=6853` 续得 5 条事件至原终态。线上 3,424 项文件逐件通过。测试源与目标均为这台 Mac mini，第二台实际设备未验证。LAN 阶段未建立研究任务或执行新工具。独立索引 `independent-rc10-lan-verdict.json` 的 SHA-256 为 `7275a1418805aa36188c1ec0852720dddae7c8c318707a419cd7a4e53976d4e7`。

**发布后的跨设备只读回报。** 在对照归档 `2cd3901` 与现场源码 `7d44a0b` 的复核中，仓库审查会话 `01a2063d-3024-7fb3-bdf8-800c2dd336c9` 报告从另一台 Mac 经 LAN 打开了首页、案例页和含引用的 Landsat 验收归档。该回报未附独立原始截图、SHA 或精确测试时间。跨设备发问、取消和多人访问仍待实测。上段为发布当时的同机验收。

最终构建含类型检查。普通全套 848 项中 842 项通过、6 项需 PostgreSQL 环境。另执行模型兼容和工具关键用例的串行 PostgreSQL 回归，9 项通过。最终定向 70 项通过，含网段拒绝和既有 Host／Origin 行为。发布在已实测的 `2d1fc89` 之上增加可见版本和局域网监听，并保持原生结构化 schema 的每个分支完整。主程证据位于 `~/Library/Application Support/OneEarth Next/iterations/discovery-runtime-web-tools/`，可在此处核对 `lan-primary/evidence/release-rc10.sha256`。测试会话独立证据位于同层的 `discovery-web-tools-primary-independent/`。

## Mac mini 公开网络工具执行隔离验收

基线 `5c429284bda604f11a3867d80b3db86a4f5f7084`。最终隔离候选 `b34fc5c812c68b6657296d3c84c159cce83ce322`，源码树 `fb07086b96ff4241c9bd71b7538cb9b44521a74d`。27 个改动文件的指纹和集成补丁见主程证据。3,424 项静态构建的清单 SHA-256 为 `bb796f2bbcf06370a4baaad83c2f17f82df7b5c8d1f94cce8dfefc22dff16e67`，与现行工作台一致。5474 未切换，切前切后首页和健康接口响应字节一致。

发现服务继续规划开放查找及同题补查，选择公开来源和读法，决定采纳哪些材料。原 Bing、DuckDuckGo、DataCite、DeepSeek Search、原生关键词检索、DeepSeek Fetch、原站、PDF 和公开归档索引执行均进入运行时适配层。已知网页/PDF 的精确补读只获准读取指定地址。论文断言、海纳目录和逐景目录仍由发现服务处理。运行时以本轮权限核准调用，经独立有界队列执行，并以原 Task、消息和调用编号保存回执。

**真实公开资料。** 在 `b2f5cc12e19fb2bf8a6264ac0a7a0d18d2829ed7` 通过隔离工作台的正常研究 HTTP 入口提交一笔 NASA IMERG 题，运行时任务 `23a75b85-bc4b-46a6-8e23-1c1dfa677824`。运行时配置为 Codex `gpt-6-luna`，发现配置为 DeepSeek `deepseek-flash`。原发现 Task `c9c17c9b-d3b8-4e30-9b5a-ddcbf2388e3a` 完成实际规划与网页选择，DeepSeek Search、Bing、DataCite 均各返回三次 200，DeepSeek Fetch 三次返回 200 和网页节选。工具均由独立运行时 API 角色发出，回执关联同一原 Task。该问只走公开网络，论文、海纳研究渠道均记为未请求。启动时海纳背景目录使用隔离对照数据，与本题无关。

本轮随后委托两笔精确补读，共取得三份 NASA PDF 节选和三条归档引用。正文依据两份 V05 发布说明，说明 Final Run 使用月度雨量计分析校准。初次网页工具回执与最终 PDF 依据分别留档。HTTP 提交至终态记录用时 154.472 秒。该阶段未测浏览器首段可见时间。最终候选相对实测版仅改原问授权依据及对应测试各一行，堵住规划归一省略原渠道限定时的授权风险。

**受控隔离。** 最终版通过临时 PostgreSQL、实际 gateway、运行时 API、worker 及发现服务的七组验证。模型、外部工具供应商和海纳目录使用固定输入。覆盖开放关键词查找后选中并读取原来源、定向 URL 零搜索、海纳零公开工具、HTTP 429 时保留另一条成功节选、同题补查回各自 Task、两个 DeepSeek 开关关闭及执行中取消。回执丢失后以同一调用编号取得原结果。取消样本的研究与发现均取消，正在读取的工具收到中止，后到结果未成为引用。单独的回环和 PostgreSQL 用例覆盖截断响应体重查、坏回执、重复冲突、排队配额、权限撤销和中断后结果未知。

独立 QA 从最终提交重建 3,424 项产物，复跑七组及 25 项定向用例。独立丢弃的是已完成的 DeepSeek Fetch 回执，重送后 PostgreSQL 仍只有一条工具回执，供应商适配器执行一次。明确问海纳时，归一稿即使省略「海纳」也不获准网页工具，显式开放的对照仍获准。独立验收索引为 `~/Library/Application Support/OneEarth Next/iterations/discovery-runtime-web-tools-independent/independent-b34fc5c-verdict.json`，SHA-256 `74b44a0a9aa22cbd0e2bd746c18727aee9746eed3053492360c58f84c5668027`。总体核对源码和独立证据后签收隔离候选。

类型检查与构建通过。普通全套 844 项，838 项通过，6 项需 PostgreSQL 的用例由环境门控。并行启用 PostgreSQL 的尝试遇到三条宿主共享内存启动错误，错误留档。释放本轮隔离集群后串行验证了六个 PostgreSQL 测试文件，14 项通过，零失败或跳过。

主程证据根为 `~/Library/Application Support/OneEarth Next/iterations/discovery-runtime-web-tools/`。从该目录核对 `evidence/acceptance-b34fc5c.sha256`。真实上游与最终受控证明分别位于 `evidence/public-upstream-b2f5cc1/proof.json` 与 `evidence/controlled-b34fc5c/proof.json`。复跑受控集时以 `node probe/run.mjs <b34fc5c 的独立工作副本> <未创建的证据目录>` 启动，使用 `ONEEARTH_A2A_TEST_PG_BIN` 指定本机 PostgreSQL 工具目录。脚本创建回环端口和临时库，每次使用新证据目录。

## Mac mini 发现渠道范围正式发布

2026-11-23 10:26:23（上海时间），[Mac mini 5474](http://127.0.0.1:5474/) 切换到已签收的后端源码 `e2756ad6a4129e00b13cddacc329abad45eda0a2`，源码树 `37d7fee3305fd91c6059189c715dd12e8371671a`，GitHub 归档 `b3b9c8ad5ee32919b6524409108bf3e7366ba978`。发布目录为 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.9-e2756ad`。工作台仍使用前端 `7446494`，3,424 项构建清单 `bb796f2b…` 逐件通过，前后完整静态目录逐字节一致。在线首页 SHA-256 为 `ad0417c24ea70ba750a57e642eb22090c4f4136796397532d3b488665929e752`。实际网页监听 `127.0.0.1:5474`，四个应用端口均为本机回环。网络绑定和权限配置前后相同。

旧队列排空后，在停受理窗口封存原 primary 的三库、5,950 个按内容寻址的对象和应用状态；已独立恢复三库，四个应用 SQLite 副本通过完整性快检，备份中 14,648 B 森林样本哈希一致。备份清单 SHA-256 `905fbbec66ce765de55bfd27223d9d4174285b6c5571dd4a7ccf599fc0272c3d`。启用新版本后，既有 41 个运行时、31 个发现任务及相应事件、原论文/网页/KEO 归档、图层目录、森林对象均通过切前切后核对。PostgreSQL 和 Garage 保留原 primary 及 PID。上版和精确 launchd 配置已保留并演练指针回退，回退服务版本时沿用当时 primary 数据。

五个实际应用角色工作目录均为新发布。运行时 API、worker、发现服务 PID 分别为 99608、99607、99605，服务端口均健康。角色入口和关键依赖字节与签收 Git 树一致。发现入口 SHA-256 `fa9df12bc9b3986a990c3860c3f69587db0ae1336330908c76059beb39a271f2`，实际调度 `00e22a6c69cb5e7168340e64dc7be6b27c85b05612450c2ed2dea99736263c00`，运行时执行轮 `11ba6d7ed4a2665c68eb4e44ff7bf123d7257e9dca3e51d5c30a6e222bd9cb16`。其余角色、部署及保留数据的指纹见证据中的 `prepare.json` 和 `after.json`。

独立 QA 从正式 Chrome 仅提交一次「海纳内部有哪些适合分析城市土地利用变化的数据？」。[正式研究 ddc2fb74…](http://127.0.0.1:5474/?research=ddc2fb74-057e-4d30-9d92-3c11fa30b17c) 绑定 A2A `6b0b1b70-349f-4f97-b957-d0303706907b`，实际发现作业 `50075365-e81b-4892-98db-be0acd82f288`。运行时使用 Codex `gpt-6-luna`，发现配置为 DeepSeek `deepseek-flash`。作业只启动一次 `source-haina`，返回 15 条目录候选，答复保存 6 条海纳引用。论文断言库和公开网络记为 `not_requested`，无网页补读、星座研究调用或补查子任务。任务读取 10:26:26 已发布的 461 条海纳目录快照，读取时未在刷新。后台同步和浏览器页面目录请求均独立于本题的渠道记录。

数据库受理至完成用时 90.919 秒，发现作业 35.361 秒。两次发现规划的渠道均为 `restricted/haina`，但第一次多返回 `fallback: null`，第二次对单渠道返回 `fallback: "no_match"`，均未通过结构校验。本题由原话限定和恢复流程执行，正式验收覆盖这条路径的实际渠道边界。模型结构输出兼容问题单独留证。独立浏览器采集保留首次 POST 载荷，首次 HTTP 响应未保存，通过同 UUID 的正式受理、终态和重开核对。六条引用在同一 Chrome 刷新及重开时保持原身份，重开未提交新任务。

独立正式复检与总体签收通过。独立索引 `~/Library/Application Support/OneEarth Next/iterations/discovery-channel-primary-independent/e2756ad-real-submission/independent-verdict.json` 的 SHA-256 为 `a96da78e47bbdeea087a19a2031e886eb29ec83a3d15c8be978233b18d766935`。主程证据根位于 `~/Library/Application Support/OneEarth Next/iterations/discovery-channel-scope/primary-cutover/`，从此处运行 `shasum -a 256 -c evidence/release-proof.sha256` 核验，清单 SHA-256 为 `5f9b809e2071dd8720409d87ed6da603de11b80a1bb8fa8ea3b07bfdb4900348`。

## Mac mini 发现渠道范围隔离验收

基线 `48237be12d5aa9c8de2b5842c4266869c02eb926`，签收代码 `e2756ad6a4129e00b13cddacc329abad45eda0a2`，源码树 `37d7fee3305fd91c6059189c715dd12e8371671a`。本段记录 Mac mini 隔离签收时的结论。当时常驻 5474 仍使用旧后端，隔离复验未提交正式研究任务。

旧版实际调度函数在模型摘要标为「仅用海纳专区」时仍进入论文、海纳、公开网络三路。候选按用户原问题和确认范围在启动请求前限制渠道。正式运行时和 A2A 路由结合隔离 PostgreSQL、固定模型与海纳发布快照测试。问「海纳内部有哪些这类数据」时，有命中、完成无匹配、接口不可用三组均只启动海纳一次。论文、公开网络、星座和历史网页补读都未启动。零命中与结果未知各有明确回复。

普通「优先海纳」先等海纳，开放条件下没有取得候选才继续其他渠道。明确「找不到再看论文」在海纳确认零命中后按顺序开启论文，公开网络没有请求。海纳命中或故障不启论文。若原范围内已有海纳数据，后续同题补字段即使为零仍只查海纳。普通开放问题保持三路。已单列另一种边界，用户明确说「海纳临时不可用也查论文」时，本候选仍停在海纳。

总体阶段签收和独立复测通过。独立测试覆盖 12 个实际调度对照、真实 A2A 路由及父、子、孙补查绑定、变更原题被拒，以及 65 项定向产品回归。固定模型与适配器用于验证执行边界，调用计数来自实际进入的适配器。主程 79 项定向通过，包含真实运行时和隔离 PostgreSQL。全套 825 项中 820 通过、5 项既有环境门控跳过，构建及类型检查通过。

独立证据位于 `~/Library/Application Support/OneEarth Next/iterations/discovery-channel-scope-independent/`。调度记录 `frozen-e2756ad-dispatch/checks.json` 的 SHA-256 为 `a675b9c543460a382fa9889d1702beaae622145232a6fefee2342a13f1984df0`。A2A 记录 `frozen-e2756ad-a2a/checks.json` 的 SHA-256 为 `af8820d07e4b2b7b644f28176dac2bfea0376359e81ae96fca6a724dd1dab162`。产品复跑 `frozen-e2756ad-product-regression.log` 的 SHA-256 为 `bbd099b8d1bec6d132d4b133a38d017bddd5d5f63edea7703598aa19cac3fb2d`。

主程证据位于 `~/Library/Application Support/OneEarth Next/iterations/discovery-channel-scope/`，可执行 `shasum -a 256 -c evidence/release-proof.sha256`。见[发现渠道范围](../../docs/发现服务-A2A.md#发现渠道范围)。

## Mac mini 数据触达浏览入口静态发布

2026-11-23 09:42:28（上海时间），[常驻 5474](http://127.0.0.1:5474/) 完成数据触达静态发布。前端 `744649488d22f5edc3b3ad8106cee67c8ccfc33c`，基线 `9af7033fe268a3cf5645198a465d841b572f5308`。3,424 项构建清单 SHA-256 为 `bb796f2bbcf06370a4baaad83c2f17f82df7b5c8d1f94cce8dfefc22dff16e67`，在线首页 SHA-256 为 `ad0417c24ea70ba750a57e642eb22090c4f4136796397532d3b488665929e752`。应用角色仍运行 `a5b7d8d`，发布目录为 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.9-a5b7d8d`。应用、PostgreSQL、Garage 进程的 PID 和正式数据样本均与切换前一致。

设置 → 地球与工作区 →「在主导航显示『数据触达』」控制主导航项，浏览器默认关闭，开启后同源刷新和新页记住偏好。资料页提供实体、线索、及时三类浏览及筛选、分页和详情。其独立文本框已移除，找资料可转到同一 Chat。旧直链、结果和地图带入的限制仍可读取。清除链接带入的 `q` 只解除该词，保留原来源、候选 ID、时段和可视化等条件。关闭主导航同时保留明确的目录直链和既有详情跳转。

[7144 隔离候选](http://127.0.0.1:7144/) 通过独立 Chrome 和总体复核，核对桌面、窄屏、原上下文指向和延迟到达的已保存结果。隔离使用实际网关与上一版运行时，只读复用已发布目录。延迟对照的两次结果 PUT 由浏览器内存应答，未保存到服务器。类型检查与构建通过，815 项测试中 810 通过、5 项既有环境门控跳过。

静态切换增加 24 项内容哈希资源，再原子置换首页。84 项旧页面兼容资源仍在线，两组共 108 项逐件核实原字节及压缩传输。旧首页 ETag 请求返回新版首页。隔离回退演练在同一份切换前静态目录副本中完成，切换前、新版及恢复后各核对 3,424 项。上版首页和计划位于 `static-rollback/`。

5474 独立正式复验与总体签收通过。Chrome 1440 和 390 宽度共 18 次数据触达查询均返回 200，默认隐藏、设置开关及刷新、旧词解除、数据详情和两种海纳图层、同一 Chat 均通过。研究与结果写入路由已拦截，正式复验零触发。另复核 Chat 已移除观测资料下拉，来源卡仍可附加原 KEO 版本且旧归档可打开。独立报告 `~/Library/Application Support/OneEarth Next/iterations/data-access-visibility-independent/primary-7446494/checks.json` 的 SHA-256 为 `b41e31f12e227046c27c23e4c569f57def11b80db9484de6ae6417123724492d`。观测资料独立回归 `~/Library/Application Support/OneEarth Next/iterations/observation-picker-independent/primary-7446494-strict/checks.json` 的 SHA-256 为 `e7862835cc2794f655f514d1b102f4b087df4273857047bb511bd3c80f92f2e2`。

[数据触达现行架构梳理](../../docs/架构与接口现状.md#数据触达现行架构梳理)记录资料归属、目录筛选、地图范围、时效及模型触发条件。本轮保留既有运行时目录与查询。已发现的年份误命中、跨源故障、旧资料混入、地图范围分岔、DOI 聚合和海纳标注及快照问题按实证与条件分别列在梳理中。首次生产地图审计意外触发既有自动保存，留下结果链接快照 `e79c1c6f-adde-4d79-a100-5deeb109c364` 和 `bcb103ad-bfba-427c-baea-c84abb11f2bd`。复跑已拦截结果写入，两轮均未提交研究。

从 `~/Library/Application Support/OneEarth Next/iterations/data-access-visibility/` 运行 `shasum -a 256 -c evidence/release-proof.sha256` 可核对主程构建、发布、回退、Chrome 及审计证据。

## Mac mini Chat 观测资料入口静态发布

2026-11-23 09:29:55（上海时间），[常驻 5474](http://127.0.0.1:5474/) 完成 Chat 静态发布。前端 `db9c05aced0e40d72591850fd7b1df5ea62615f0`，基线 `653836b9bc7f237fc2e51108ac89a766193b186d`，3,424 文件构建 SHA-256 为 `cfc0bd196b0e8c268dcc42fccf6b1a986b4856a437cb22ae32ccccf3fb718a54`，在线首页 SHA-256 为 `e47d28fcc1ab16c3024a2d1b3e98b5e372cd9dcbaf2a4dd2cfd50d3804193036`。应用角色继续运行 `a5b7d8d`，同一发布目录提供静态资源，应用、PostgreSQL 与 Garage PID 与切前一致。

7043 上版与 7044 候选读取同一份非空的正式材料快照。桌面和窄屏的 Chat 输入区由一处「选择观测资料」下拉变为零处。公开 KEO 注册来源卡可附加并移除同一确认版本；读取归档的 WSPD、130,402 条观测和 SHA 引用仍可打开。类型检查及构建通过，815 项测试中 810 通过、5 个既有环境门控跳过。独立隔离验收零研究提交。

正式发布原子替换首页，21 项新资源与上版兼容资产并存。前一首页的 ETag 请求取得新版首页。保留旧首页及静态回退计划。线上材料目录、公开来源原档、读取归档及既有森林图层均做了切前/切后只读核对。

独立正式复验与总体签收通过。桌面、窄屏均无选择框，输入与来源卡附加正常，旧归档刷新一致，零研究提交。独立 Chrome 证据 `~/Library/Application Support/OneEarth Next/iterations/observation-picker-independent/primary-validated/checks.json` 的 SHA-256 为 `93d5983512bbe917239679dc09029efe09a406ec1642408b8c430bfdfc305125`。主程证据从 `~/Library/Application Support/OneEarth Next/iterations/remove-observation-picker/` 运行 `shasum -a 256 -c evidence/release-proof.sha256` 核对。

## Mac mini 四项可视化案例静态发布

2026-11-23 08:44:31（上海时间），[5474 案例页](http://127.0.0.1:5474/?view=cases) 完成静态发布。前端源码 `ac7c757fda332037e26e341c75fb16e3f841fbeb`，基线 `964fd5c244efc9a041cafc5fafb7a92ecb8a1c13`，3,424 件构建清单 SHA-256 为 `7238389057b35522d471c3cc65e8c97d34704135225261848b8bc2df95581ae4`，在线首页 SHA-256 为 `a175cc0113e9605f1d389f16b7b490a8faf3ecad51cd262af73fa0f6287aa2a9`。五个应用角色运行 `a5b7d8dbdba41e6139740d4612e20023e84ceaf6`。发布路径 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.9-a5b7d8d/dist`，应用和存储进程前后为同一批 PID。

案例页按次序显示全球气象站与美洲闪电、全球地震、全球风场、全球降水。科学问题区只显示标题。气象页和卡片使用相同标题及美洲卫星视域说明。风场卡按所存 GFS 清单显示起报 2026-11-06 00:00 UTC 与 F000、F006、F012 三个预报时效。常驻降水目录提供 2023、2024 各十二个月，案例卡、图层、数据线索及详情均使用同源 `GET /precip-data/catalog.json` 显示可选年月。海纳 1846764 和 1846639 可从数据触达搜索进入详情并在球上可视化，支持切月、切城、刷新和 `?viz=forest`、`?viz=c40` 旧入口。

[6944 隔离候选](http://127.0.0.1:6944/) 通过独立 Chrome 复测及总体验收。使用冻结图层和旧版真实数据索引，确认旧投影中的 2000–2026 不再充作 OneEarth 降水可用范围。目录只列 2023 年 1、3、12 月时，默认进入 12 月，精确 3 月深链仍进入 3 月。旧全年清单存在时，目录未发布月份禁用并置灰；跨年缺月、合成 2028 年月内部分覆盖、空目录、无效响应和 503 均有独立对照。类型检查和构建通过，815 项测试中 810 通过、5 个既有环境门控跳过。

正式发布原子替换首页。新引入 18 个内容哈希资源，保留 39 个兼容资源供旧页面使用，57 项均经线上字节和压缩传输核对。旧 ETag 条件请求返回新首页。雨量目录、森林 8 月切片、C40 北京对象与旧研究的前后字节一致。静态回退在隔离副本按新旧真实构建演练通过，回退只置回上版首页。

独立上线复核与总体签收通过。Chrome 从实际数据触达进入森林和 C40 数据集详情，分别切至 2023-08-15 和北京并刷新；旧直链能在干净上下文打开。实际气象站、两颗卫星闪电接口和 USGS 地震/台站返回成功。风场实际切层及预报时效，降水从正式目录点入并取得真实数值瓦片，精确 2023 年 3 月深链保持原年月。两阶段浏览器验收均为零研究提交，降水目录及图层资源请求均为 GET。独立索引 `~/Library/Application Support/OneEarth Next/iterations/visualization-case-curation-independent/independent-release-acceptance.json` 的 SHA-256 为 `90b376025b7817be6862192bc147343f3beb2343c67c6d508821a160d13f599f`。

主程证据根位于 `~/Library/Application Support/OneEarth Next/iterations/visualization-case-curation/`。从该目录运行 `shasum -a 256 -c evidence/release-proof.sha256` 核验构建、浏览器、在线资源和回退记录。上版首页及回退计划见 `static-rollback/`。下文保留上版发布的历史记录。

## Mac mini 科学问题案例目录静态发布

2026-11-23 08:23（上海时间），[5474](http://127.0.0.1:5474) 完成静态发布。前端源码 `ac09bb362661b25f6525ba5ebf37fc1d17d44421`，基线 `0d859776f29e11e74c95f19b84c7824639751a20`。3,424 件构建清单 SHA-256 为 `8c44e05471d79f6ddc49b84d4006f2fa4050127dd9f5b3ffa05ead5bbbd86797`，在线首页 SHA-256 为 `ae9ad8dab09958ade5b6cdb085bccc56c9fc715d21ef2a73a2c8f3d10c8814d2`。五个应用角色继续运行 `a5b7d8dbdba41e6139740d4612e20023e84ceaf6`，发布目录仍为 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.9-a5b7d8d`。PostgreSQL、Garage、launchd 及五个应用角色的 PID 前后一致。

[6844 隔离候选](http://127.0.0.1:6844/) 通过独立 Chrome 复测和总体复核。案例页在干净浏览器、同配置刷新及从旧档回访时，科学问题案例区仅一个标题。六张可视化的文字、顺序和封面与切换前一致，森林、城市切换和风场入口可打开，Q02 书签及两份旧研究的引用可读。隔离页使用产品网关及冻结的只读记录和图层响应。类型检查和构建通过，单元与服务测试 809 通过、5 个已有环境门控跳过。带 Chat 提交的完整风场脚本在隔离网关被拒，风场的只读部分另以实际浏览器复测。浏览器验收未提交研究。

正式发布先增加 21 个带内容哈希的 JS/CSS 及压缩资源，再原子替换首页。此前的 21 个资源仍供已打开页面使用，新旧 42 项逐项通过在线字节哈希及压缩传输检查。带旧首页 ETag 的请求返回新首页。正式目录逐一校验了新构建清单中的 3,424 项。保留上版首页、上版静态资源和静态回退脚本。回退只原子置回上版首页，应用和存储继续运行。

独立上线复测与总体签收通过。Chrome 从首页首次进入、刷新及已有会话回访后，科学问题案例区都只有标题。六张可视化的文案、顺序和封面与切换前一致，逐一打开为六个不同页面或图层。Q02 仍进入原冰川案例，旧论文、网页、KEO 研究及森林图层前后哈希一致，旧引用可打开。本轮两阶段独立浏览器验收均为零研究提交。独立证据索引为 `~/Library/Application Support/OneEarth Next/iterations/empty-science-cases-independent/independent-acceptance.json`，SHA-256 为 `eb541877b88c5cc53925e7171f8d94d71527d110cabeb38d74cfc62b14a9ab1d`。此次仅盘点可视化，降水卡标注的时间与已发布目录不一致，作为既有问题单列。

主程证据根位于 `~/Library/Application Support/OneEarth Next/iterations/empty-science-cases/`，可从该目录运行 `shasum -a 256 -c evidence/release-proof.sha256` 核验。隔离和正式环境的构建、入口响应及前后对照见 `evidence/`，回退计划及原首页见 `static-rollback/`。上版正式构建及 KEO 验收见下文。

## Mac mini 日常入口的 KEO 文件读取

2026-11-22 23:30:44（上海时间），[5474](http://127.0.0.1:5474) 完成常驻切换。签收源码为 `a5b7d8dbdba41e6139740d4612e20023e84ceaf6`，源码归档为 `490d3d36e350cf296b736fcef854d5079bdef98a`。正式目录为 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.9-a5b7d8d`。3,424 件构建清单 SHA-256 为 `71de7af70f7cc0079caa0adcd9861a961daf21ff1ad331e6b214fe135a8548f2`。在线首页 SHA-256 为 `d2ff9a2448919ee80d620f1c911d3f76a8e96b4481275c92a18cecbcb1b4166a`，入口实际引用的 JavaScript 和 CSS 逐项与发布目录一致。健康接口仍报告 `0.2.0-rc.9`。

切换沿用原回环端口、sandbox、模型及凭据引用、primary PostgreSQL 和 Garage。启动项仅换应用发布路径及追加私有能力配置引用。停受理后确认运行时和发现队列排空。首次停写已完成三库与对象恢复，森林校验将字节缓冲区与字节数比较，保护流程恢复上一发布，数据和记录保留。修正后重新停写，另取最新备份并在 PostgreSQL 56635 和 S3 6412 实际恢复。三库、5,950 个对象、197 项论文当前映射和目录修订吻合。森林图层在恢复桶中按内容哈希取得，四个本地 SQLite 及保存状态在隔离目录通过恢复核对。切换前后的实际数据库和对象进程保持原 PID。

新增材料分开备份。用补充包在独立目录恢复 NOAA 原件及授权登记后，签收只读子进程在原 sandbox 下打开同 SHA 文件，核对发布源、文件版本和实际读据。撤权、异版本和错误摘要三项对照均为零文件读取。正式原件和登记放在 `storage-primary/observation-materials/`，目录权限 `0700`，原件与登记 `0400`，私有能力配置 `0600`。

切换前，primary 里无隔离试验的旧 KEO 任务及相应的原件、元数据或精确发布目录引用。停写备份及复原后，主程只新增一条[操作者公开来源登记](http://127.0.0.1:5474/?research=45d03965-a122-4fdd-9170-e5b8f05ba327)，写入一个完成态任务、一个终态事件和一个 NOAA 官方目录引用，模型调用为零。该来源卡的登记连接到相同 SHA-256 的正式原件。

独立上线复核通过。Chrome 从来源卡提交唯一[真实自然追问](http://127.0.0.1:5474/?research=c3f9505c-c412-46e6-b38a-e23084374ad8)。发现侧真实 DeepSeek `deepseek-flash` 选择 `read/describe WSPD`，同一 A2A Task `465640e9-8ff4-4db8-b3ec-4c89e2aeab0e` 完成规划和接收回执。C 进程 28533 实际读取一次 SHA-256 为 `8db086dc9eda14dfc5be010a8522187fd93df55ff493e520ff66b982118428dd` 的原件，得到 `WSPD` 单位 `m/s`，130,402 条计入统计，首末为 2004-06-16 20:00 和 2025-03-28 18:00（UTC）。本轮未应用 QC 筛选。正文引用、来源抽屉和同浏览器配置刷新均重开同一归档，刷新零新增研究。以浏览器提交为起点，实际文件读取、服务端终态和首段可见分别用时 10.747、11.574、11.717 秒。运行时数据库受理至终态用时 11.550 秒。

独立测试核对前后旧论文和网页研究原始响应一致，浏览器刷新仍可逐字打开原存摘录。森林图层为原 14,648 字节、370×303，SHA-256 一致，条件 GET 返回 304。独立证据索引位于 `~/Library/Application Support/OneEarth Next/iterations/keo-0107-primary-independent/primary-keo-independent-acceptance.json`，SHA-256 为 `270c4b2ee8354616e09bf95458444edff81c96b6aedfee0a5e5ea54b45255e5f`。

主程记录位于 `~/Library/Application Support/OneEarth Next/iterations/primary-keo-cutover-20261122/`。准确常驻身份与在线资源见 `primary-release-identity.json`，原件恢复见 `material-restore-verified.json`，首次保护回退见根目录 `cutover.ndjson`，最终切换和恢复见 `retry/`，正式读取见 `primary-keo-research-trace.json`。从证据根运行 `shasum -a 256 -c cutover-proof.sha256` 校验冻结要件。回退恢复预留的上一发布和启动项，并沿用届时 primary，保留切换后写入的研究记录。

## Mac mini SN-0107 原始观测文件回验

**真实文件级追问通过 Mac mini 隔离阶段签收。** 候选源码 `a5b7d8dbdba41e6139740d4612e20023e84ceaf6`，构建清单 SHA-256 `71de7af70f7cc0079caa0adcd9861a961daf21ff1ad331e6b214fe135a8548f2`（3,424 文件）。独立测试从该源码重建 [6764](http://127.0.0.1:6764)，校验源码差异的 20 个文件和完整构建清单。常驻 5474 运行 rc.9。

对照来自 706 题库的 SN-0107。题库原题运行编号为 `2d287a30-e46e-4655-9751-d28853f2502e`。历史寻源改写首问 `61f512db-8ec2-4a0e-b4d0-3b094d13ec4c` 的 KEO 引用指向 ISO 元数据。之后的旧对照追问 `3096bc39-09cd-49b1-9541-dc47a951b7e1` 已辨认入口类型。旧寻源与旧追问当时均未取得原始数据，两份记录和 461 条原事件按原编号、时间和保存内容恢复至隔离数据库。

操作者从 NOAA NDBC [同一对象的服务目录](https://dods.ndbc.noaa.gov/thredds/catalog/oceansites/long_timeseries/KEO/catalog.html?dataset=oceansites/long_timeseries/KEO/OS_KEO_200406_M_TSVMBP_32N145E_hr.nc) 核对原始入口，从 [NDBC 发布站](https://www.ndbc.noaa.gov/data/oceansites/long_timeseries/KEO/OS_KEO_200406_M_TSVMBP_32N145E_hr.nc) 实际取得 HTTP 200 和 156,694,128 字节的 NetCDF classic 文件。发布方 Last-Modified 为 `2026-10-27T02:00:56Z`，原文件 SHA-256 为 `8db086dc9eda14dfc5be010a8522187fd93df55ff493e520ff66b982118428dd`。操作者登记了精确关联网址和该摘要，以授权此版本供模型选取。公开版本 ID 为 `sha256-` 加完整摘要，浏览器和发现规划均可见。此回验的入口核实、下载和登记是操作者动作。

独立 Chrome 从原研究的 NOAA 来源卡选择已登记版本，使用同一会话和原父任务提交唯一的[文件级追问](http://127.0.0.1:6764/?research=ff7b3b44-fb14-43c2-a8cf-eca8afddd284)。浏览器发送自然问题和附件身份。真实 DeepSeek `deepseek-flash` 规划收到获准文件身份、变量名及空证据集合，选择 `read/describe WSPD`。A2A Task `234a5f9b-98cd-449f-b7aa-d97695538598` 包含一个规划作业和一个同 Task 回执作业。实际子进程一次读取上述原件，按同一摘要留存读据。正文〔1〕、来源抽屉及刷新后重开均能查看该归档引用。以这次浏览器提交为起点，到实际文件读取、服务端终态和首个可见答复分别用时 9.358、10.173、10.240 秒。发现规划用时 8.484 秒。

实际答复和生产只读子进程的直接对照一致。变量 `WSPD` 的单位为 `m/s`。182,167 个时间位置中 130,402 条计入统计，51,765 条等于原件 `_FillValue`（`1.0000000409184788e+35`），该列无单独的 `missing_value`，其余剔除项为零。首末 UTC 时刻为 `2004-06-16T20:00:00.000Z` 与 `2025-03-28T18:00:00.000Z`。原始 `TIME` 值为 `19890.833333333332` 与 `27480.75`，以 `days since 1950-01-01T00:00:00Z` 计。C 读取全文件，期间没有派生转换或采样。关联列 `SWSPD`、`WDIR`、`UWND` 和 `VWND` 保留各自名称和角色。主程用直接执行对照确认 `SWSPD` 虽共享 CF 标准名，但起始时刻及条数不同。真实网页答复只统计 `WSPD`。本结论限文件级非缺测边界，原题的质量标记筛选、风流有效配对与通量差沿用原判分。

类型检查、构建及限并发全套 815 项通过，包含真实隔离 PostgreSQL，无跳过。首次高并发测试有两项临时 PostgreSQL 初始化触发本机 SysV 共享内存段数上限，按并发 2 复跑通过，代码版本一致。总体负责人单独复跑 NetCDF、来源、契约和自然运行时四组受控测试，65 项全部通过，并以 Python `netCDF4` 直接检查同一原件。独立测试的原件扫描、Chrome、A2A、执行日志和论据重开另有 16 项证据。

独立索引位于 `~/Library/Application Support/OneEarth Next/iterations/keo-0107-independent/evidence/sn-0107-independent-acceptance.json`，SHA-256 为 `b04aef607055a2af5c74a17eeed4d3b38d866ae2983cc8eaa5f49c551fbf2ee3`。主程证据位于 `~/Library/Application Support/OneEarth Next/iterations/keo-observation-0107/`。从该根目录核对 `shasum -a 256 -c source/raw.sha256`，从 `evidence/candidate-a5b7d8d/` 核对 `shasum -a 256 -c candidate-proof.sha256`。在对应的隔离源码中执行 `npm run check`、`npm run build` 和下列测试。直接读和浏览器复跑脚本 `verify-raw-reader.mts`、`verify-keo-workbench.mts` 位于证据根目录，复跑使用新输出位置。

```sh
node --import tsx --test --test-concurrency=2 src/domain/*.test.ts server/*.test.ts
```

含 PostgreSQL 的全套运行需设置 `ONEEARTH_A2A_TEST_PG_BIN` 指向可用于隔离测试的 PostgreSQL bin 目录。

## Mac mini 普通 Chat 的观测资料

**Mac mini 隔离阶段通过总体签收。** 候选源码 `441f2e31c6bc67d75ead47c9761c622c44d01b82`，构建清单 SHA-256 `c5c00271b3db81c1a1349b12852a8c4b3ceb58ccde39fd0202675e29aefee840`（3,424 文件）。类型检查、构建及 790 项测试通过，包含真实隔离 PostgreSQL 用例。

独立测试从准确代码重建 [6564](http://127.0.0.1:6564)，以另一份获准合成文件做 Chrome 盲测。正常选择版本后，[首问](http://127.0.0.1:6564/?research=c600954e-3bad-4a8d-86c7-1cf61ab017db) 的真实发现模型在仅有身份和变量名时决定读取。原发现 Task 消费一次真实执行回执。所选 `v-6da4c85e4435` 中的 `wind_speed` 单位为 `kn`，4 条非空记录从 2018-04-16 到 2018-06-06。[追问](http://127.0.0.1:6564/?research=1c4ae994-f6b9-4b6c-b68b-10ba46feace4) 沿同一会话与父任务绑定文件，未重选附件。发现模型选择复用，零新增文件读取，两次引用可打开同一份文件版本及 SHA-256。模型决定耗时分别为 6.541、12.037 秒，服务端从受理到终态分别用时 8.112、12.551 秒。首问的浏览器脚本在等待响应体时中止，独立测试重开已存首问后只发一次追问。首问首次可见的时间未取得。

独立固定输入与真实 PostgreSQL 受控用例共 47 项通过。证据目录为 `~/Library/Application Support/OneEarth Next/iterations/natural-observation-acceptance/evidence/`。独立索引 `natural-observation-independent-acceptance.json` 的 SHA-256 为 `28469fa72d295fdcca9bdb944512c204c8df2b26fe764adf43c48b93795d39b9`。总体负责人核对索引所列 22 项证据。时间来自各自这一组样本。非空记录边界与条数不能证明其间连续有效。

主程从 [6494](http://127.0.0.1:6494) 的普通工作台提交合成资料题。运行时用独立 PostgreSQL 持久化任务，发现服务用现有获准的 DeepSeek `deepseek-flash` 规划。Chrome [首问](http://127.0.0.1:6494/?research=0da8bf35-3f65-4333-8a4e-70bd7aaa9e7a) 只附可见资料身份。发现模型首次看到资料身份及变量名，选择描述性读取，指定文件实际读取一次。执行回执回到原 A2A Task，答复和来源抽屉保存实际版本、变量、单位、首尾日期及 SHA-256。

从原研究重开后，未重选附件的[普通追问](http://127.0.0.1:6494/?research=9e30db6b-e8be-4d05-9ece-1592f0f4bdc7) 在服务端绑定同会话父记录。发现仍有一次规划，选择复用归档，文件读取为零。带同一附件改问中位数时，发现选择 `general`，普通运行时完成回答，文件读取仍为零。三笔均为实际 Chrome 与真实模型调用，分别从任务受理到终态用时 8.110、6.309、24.196 秒。这三笔记录来自最终冻结前的联调版。

最终版用受控运行时输出检查了资料授权变更。未重选的普通问题可提交，普通计划输入省去旧文件事实。明确依赖已撤权资料时，答复说明限制，零读文件和外部补查。另附当前获准资料时，发现委托只带新对象。受控用例也覆盖全空变量的单位与零条数复用、同会话读据及跨会话隔离、显式入口、丢回执、取消与进程恢复。总体负责人从准确源码复跑自然问答、撤权、描述契约及既有引用四组测试，51 项全部通过。

主程证据位于 `~/Library/Application Support/OneEarth Next/iterations/natural-chat-skill/evidence/`。在该目录运行 `shasum -a 256 -c preview-proof.sha256` 可核对冻结的联调记录。在子目录 `candidate-441f2e3/` 运行 `shasum -a 256 -c candidate-proof.sha256` 核对源码和构建清单、测试、实际重启后的档案对照及浏览器请求控制。该浏览器对照拦截任务提交，确认只传父任务编号和原问题，旧读据由运行时核权后绑定。

复跑由隔离源码执行 `npm run check`、`npm test` 和 `npm run build`。为 PostgreSQL 用例设置 `ONEEARTH_A2A_TEST_PG_BIN`，指向可用于隔离测试的 PostgreSQL bin 目录。真浏览器联调复用该证据根上一级的启动器和脚本，另取输出位置。常驻 5474 继续运行 rc.9。

## Mac mini 只读观测 Skill 与嵌套执行

**Mac mini 隔离阶段通过独立验收。** 隔离候选源码 `287b8dd7814854f896339bff1f5f15308d10eb30`，构建清单 SHA-256 `466394a80c9f4785635671476a1ad5069e37fb31a8f7554a54717b4fc0e84cd5`（3,424 个文件）。候选入口 [6274](http://127.0.0.1:6274)，使用新的运行时、发现和时空数据库。类型检查、构建和 743 项测试通过，含隔离 PostgreSQL 测试。

- [单名额原研究记录](http://127.0.0.1:6274/?research=d74b833e-1a73-4b1b-88a1-8a2e92be35c2) 中，A、B 持久化依赖后释放同一个名额，C 取得该名额并读取指定本地文件。研究任务等待期间，同一运行时 worker 完成普通地图定位，同一发现 worker 完成一次对缺失论文的精确读取并报告缺项。原发现保持 `TASK_STATE_WORKING`。A、B 的父行锁在 C 处理期间可以从另一数据库连接立即取得。
- 预留路径两条 A 使用不同普通名额。主链 B 作为具独立编号的子调用，沿 A 的上下文请求 C。C 已完成读取并保持实际子进程，消耗预留名额。第二条链得到未启动回执，零读取、零文件引用。主链完成后该次拒绝不重新运行。试点只登记固定 A→B→C 依赖，外部指定跨链父项的请求在受理前拒绝。
- 代理分别模拟首次委托和结果回送在受理后丢回执。原研究继续使用同一外部 Task，发现只登记两段实际作业。受控存储故障在 B 已保存判断后短时扣住 A，重复的同 C 回执、同编号改变内容与旧租约分别返回重复、冲突、过期，C 文件读取与 B 采纳各一次。恢复后 A 读取已存判断。执行进程在 C 尚未交出持久回执时重启，原任务保留审计并报告未知，无再次读取。
- 取消前已经持久化的实际依据在原档中保留一条引用。取消后迟到的结果无权限推进原发现，也不会补记文件引用。Chrome 从正文〔1〕打开同一文件版本、变量、单位、非空边界及 SHA-256，刷新和新上下文重开可核。依据打开时无目录或原站查询。单位和非空边界不证明时段内连续有效。

最初候选 `89614db` 的独立调度、Chrome 和双侧硬终止恢复结果单独保存在 `~/Library/Application Support/OneEarth Next/iterations/nested-skill-acceptance/evidence/89614db-index.json`。该版在公开受理后改变同一登记版本仍可读到新文件。修订版首次受理把可信 SHA 与任务落在同一事务。主程以 `registration-pinning.json` 验证登记改指、撤权与未变三组对照。前两组同 UUID 重提保留原 SHA，启动后无读取、无引用，末组实际读取原摘要并登记一条引用。 独立测试在 [6384](http://127.0.0.1:6384) 对最终源码独立重建，以可变注册表和另一组固定材料复验。相同编号的重提保持旧摘要。伪造摘要返回 400，改动原请求返回 409，实际 A2A 仅传能力和材料身份。恢复登记后，用新 UUID 发起的 [72e72bce](http://127.0.0.1:6384/?research=72e72bce-b72f-4daf-8f34-480b616c8672) 完成读取，Chrome 打开、刷新及新上下文重开均核到一条原文件引用。独立证据索引为 `~/Library/Application Support/OneEarth Next/iterations/nested-skill-acceptance/evidence/nested-skill-independent-acceptance.json`。

主程证据根为 `~/Library/Application Support/OneEarth Next/iterations/nested-skill-delivery/evidence/candidate-287b8dd/`。从证据根执行 `shasum -a 256 -c self-test.sha256` 与 `shasum -a 256 -c protocol-proof.sha256` 可检查冻结清单。从候选源码运行 `npm run check`、`npm test`、`npm run build`。真实 PostgreSQL 定向与全套用例需要将 `ONEEARTH_A2A_TEST_PG_BIN` 配置为独立可用的 PostgreSQL bin 路径。程序联调入口、执行器和故障驱动在证据根上两级，具体记录及任务 ID 见 `self-test-index.json`。复跑另开输出目录，保留原证据。

联调根是 `~/Library/Application Support/OneEarth Next/iterations/nested-skill-delivery/`。复跑使用该根配置的独立存储和 6274 端口组。为 `NESTED_SKILL_WIRE_LOG` 指定新的输出文件后，运行 `node observe-protocol.mjs` 启动该组代理。用 `node launch-isolated.mjs <role>` 分别启动 `discovery`、`spatial`、`web`。驱动独占启动、停止此隔离组的 `runtime` 和 `worker`，运行前让这两个角色退出，保留其他角色。各次退出后保留文件并写入新输出目录。

```sh
(
  set -e
  cd "$HOME/Library/Application Support/OneEarth Next/iterations/nested-skill-delivery/integration"
  export NESTED_SKILL_EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/oneearth-skill-replay.XXXXXX")"
  deployment="$HOME/Library/Application Support/OneEarth Next/storage-nested-skill-first/deployment.env"
  for mode in suspend retained cancel cancel-active interrupted-read; do
    node --env-file="$deployment" --import tsx ../verify-nested-product.mts "$mode"
  done
  node --env-file="$deployment" --import tsx ../verify-registration-pinning.mts
)
```

总体负责人确认 89614db 的三种调度和双侧硬终止证据，确认 287b8dd 的受理摘要、迟到和拒绝行为及最终引用。其独立复跑的 18 项相关测试全部通过，两份独立证据清单验证一致。

本批只使用受控版本文件、隔离 PostgreSQL 与真实本地进程。供应商模型配额、动态技能图、真实机构权限和具有外部副作用的 Skill 仍待专门验证。常驻 5474 继续运行 rc.9。

## Mac mini 网格问答目录引用 v0.2.0-rc.9

**隔离单项验收通过。** 签收源码 `6b5f2c640a36634fb8fe4cc598ac91bfc0cf9a9e`，构建清单 SHA-256 `25e493fb639f031398a4f59853a31f5294c1297078f2c7b9fb839ea145bf1be7`（3,424 个文件）。隔离候选 [6174](http://127.0.0.1:6174)，rc.8 负基线 [6164](http://127.0.0.1:6164)。类型检查、723 项测试和独立重建通过，包含两个真实隔离 PostgreSQL 测试。

- 原任务 `e52cb271-b3fb-4334-94de-0726be4b857f` 的权威空间结果已有一项精确来源，答复缺引用。Chrome 以原问法重试 [8ee3d47e](http://127.0.0.1:6174/?research=8ee3d47e-818f-4943-99c9-9fdbc4a4978c)，H3 `871f8aa03ffffff`、2003 年、受控论文 A 的范围修订与基线一致。实际 Codex `gpt-6-luna` 一次规划选择 `read` 与目录条目，一次确定性 A2A `records` 按权威内容 ID 返回 A。服务端任务从受理到完成 13.254 秒，精确目录往返代理实测 2.268 毫秒。期间的时空投影 head 是已有周期轮询。未新增发现 Task、论文正文读取或数据文件读取。
- 回答列论文题名和数据产品，从正文编号和来源抽屉均能打开本轮保存的精确目录记录。Chrome 同一会话刷新和干净会话重开均通过。真实隔离数据库经正式导入同键 B 和撤下后，新签范围读取当前索引，旧句柄返回 410；已存研究仍按原 A 重开，归档字节一致。独立测试使用实际网页和模型，A、B 是受控目录样本，覆盖表示目录定位。
- 受控回归覆盖仅计数、普通问答、同义问法、内容补读、明确开放发现、同会话材料复用、服务不可用及过期范围。首次没有精确目录材料时按缺项处理，保持原权威计数及范围。

本机联调根为 `~/Library/Application Support/OneEarth Next/iterations/coverage-answer-references/`。证据在其 `evidence/` 下，包括 `original-failure.json`、`candidate-task-trace.json`、`candidate-current-a.json`、`candidate-current-b-publication.json`、`candidate-withdrawn-publication.json` 与 `candidate-reopen-withdrawn.json`。从联调根运行 `node verify-reopen.mjs 6174 <任务 ID> <精确来源 ID> <新输出名>` 可复测只读打开，使用新的输出名保留原截图及核对结果。固定动作回归在源码目录运行 `node --import tsx --test server/grid-catalogue-answer.test.ts`。

### 日常入口切换

**独立上线复核通过。** 2026-11-22 19:15（上海时间），[常驻 5474](http://127.0.0.1:5474) 切至同一签收代码和构建，沿用原 primary 和存储进程。排空后停写备份，在独立 PostgreSQL 和 Garage 恢复并核对三库、5,950 个对象、197 个当前映射和 217 个精确版本。三条原研究记录、论文依据、实际论文和 RGI 两组范围的成员及修订、森林图层字节均与切前一致。rc.8 原发布、启动配置及停写备份留存供回退。

生产 [3e136b30](http://127.0.0.1:5474/?research=3e136b30-4f89-463f-87d5-8e1aefb47a7f) 在 H3 `871f8a902ffffff` 命中一个真实目录版本，数据 DOI 为 `10.1594/pangaea.886889`。实际 Codex `gpt-6-luna` 一次动作规划，按精确 ID 取得已发布目录记录，14.180 秒从受理到保存答复。浏览器点击与刷新后的归档重开均回到同一条目录记录，发现库任务数 24→24。

独立复测索引为 `~/Library/Application Support/OneEarth Next/iterations/grid-paper-reference-acceptance/evidence/rc9-acceptance-index.json`。切换证据位于 `~/Library/Application Support/OneEarth Next/iterations/primary-rc9-scope-reference/` 的 `cutover.ndjson`、`deployment-verified.json`、`backup-restored-and-verified.json`、`task-persistence-verified.json`。生产重开截图、时间和线路核对见联调根的 `evidence/primary-reopen.json`、`primary-task-trace.json`。

## Mac mini 论文发布与时空投影 v0.2.0-rc.8

**Mac mini 隔离阶段通过独立验收。** 签收源码 `0254e5352572d2b7fbd070757562c92e8ad98e9b`，构建清单 SHA-256 `8c4c1c82450f7426e53c7b784544c0f9f61a12908acff258dedcd718cd89e254`。隔离入口 [5924](http://127.0.0.1:5924)，rc.7 只读对照 [5914](http://127.0.0.1:5914)，新格式恢复 [6094](http://127.0.0.1:6094)。类型检查、693 项测试和构建全通过，包含真实隔离 PostgreSQL 测试。最终候选相对前一实测版 `04bcf02` 的产品差异为三处候选枚举逻辑。

| 验收项 | 实测结果 |
| --- | --- |
| 迁移与稳定 ID | 真实 primary 停写的格式 2 旧包保留 196 项当前发布和 216 个精确版本，迁移与回退导出逐项吻合。同源重试幂等。旧格式 1 控制恢复按已归档发现有限重建，得 191 项当前线索和 209 个可读版本，不能恢复原发布集合。零字节 WAL 与非空 WAL 走不同校验。 |
| 版本变化和失败 | 在原目录加一条受控 A，同格同年、UTC、错年和公开 RGI 结果与旧版一致。正式换 B 后 A 仍可在明确历史子集中定位。发现投影中断、时空重启后仍读上一完整代，恢复后旧范围返回 410。晚到 A 不改当前，新增历史版本只推进同步代。撤下后 A、B 仍可按 ID 读取。 |
| 实际空间读与增量 | `04bcf02` 的正式加入、替换、撤下分别传 1、2、1 条记录，同一候选观察器响应正文 881、1,305、882 字节。最终 Chrome 拖球、滚轮和选格窗口完成 8 个覆盖响应，发现线只有一次周期性 head。实际 SQL 执行空间 GiST 与年份/UTC 条件。513 条论文受控检查中，SQL 命中 1 只查该 ID，命中 0 时纸本 ID 查找和全表枚举均为 0。 |
| 恢复与回退 | 格式 3 备份恢复三库、5,950 个对象和同一代投影。6094 在发现尚未启动时已经从本地索引返回 B 当前视图与旧 A 精确范围。复验原研究记录、论文依据和森林图层。隔离回退把新库当前发布导出为 SQLite 并启动 rc.7，两个版本和旧档仍可读。 |
| 真浏览器范围 | `04bcf02` 一笔真实地图问答 `e52cb271-b3fb-4334-94de-0726be4b857f` 保存了与地图同版的范围、成员和源 ID。最终候选沿同一 A 和原任务重开，并用真实同源 API 和 Chrome 验证热点改动。答复缺可点出处。两版覆盖接口及归档仍保留同一来源 ID，运行时消费缺口另登记。 |

证据根为 `~/Library/Application Support/OneEarth Next/iterations/paper-catalog-ownership/evidence/`。`migration-proof.json`、`export-b-v3.log`、`restore-b-v3.log` 与 `rollback-verification.json` 对应数据操作。`candidate-a-0254e53.json`、`wire-and-index-0254e53.json`、`final-0254e53-actual-index.json`、`hot-path-focused.log` 和 `rc8-hot-path-fingerprint.json` 对应最终代码复验。`scope-answer-missing-clickable-ref.json` 保存问答引用缺口和新旧服务对照。复跑沿相同的隔离端口另取空库或新输出名。发布或制造故障只用隔离夹具。

独立测试记录位于 `~/Library/Application Support/OneEarth Next/iterations/paper-publication-no-sqlite-acceptance/evidence/`，从 `rc8-0254e53-acceptance-index.json` 进入。

### 日常入口切换

2026-11-22 18:36（上海时间），[5474](http://127.0.0.1:5474) 切至同一签收代码与构建。停止受理后，两套队列均无进行中任务。沿用原 primary 和两个存储进程。停写备份恢复三库与 5,950 个对象，逐一核对 197 个当前映射、217 个历史版本及发布元数据。发现和时空先建立完整本地投影，再启动常驻入口。五个应用进程均未打开或重建论文 SQLite。旧文件、原发布和回退启动配置已留存。

迁移前后，原两笔研究、论文依据、森林对象及 rc.7 新写入的 RGI 问答均可读。用现有 RGI 2003 和一条有坐标的精确论文在主库重新签范围，查询修订及成员相同。上线证据位于 `~/Library/Application Support/OneEarth Next/iterations/primary-rc8-final-20261122/`，主要是 `cutover.ndjson`、`publication-and-history-verified.json`、`real-coverage-after.json`、`live-sqlite-ownership.json` 和 `rc7-new-archive-retained.json`。独立上线复核位于相邻 `paper-publication-no-sqlite-acceptance/primary-rc8/`。

## Mac mini 日常入口 v0.2.0-rc.7

2026-11-22，launchd 常驻入口 [5474](http://127.0.0.1:5474) 已切换至 rc.7，签收源码 `555f9e1`，部署来源 `16c49ee`。沿用原回环绑定、primary 的三库、PostGIS、Garage 和凭据。rc.3 已退出日常服务，原发布与启动项副本保留供回退。停写备份已在独立存储恢复三库、196 条当前论文目录记录及 5,950 个对象。切换前后的两条研究记录、论文依据与森林图层一致。

独立测试从网页提交 [RGI 7.0 研究任务](http://127.0.0.1:5474/?research=7fca27cd-a50e-4fde-bb7b-edb13fd62f90)。primary 归档记录一次运行时启动和一次 A2A 发现委托 `5de8b908-1f45-4996-8e3d-1ad23fe77c23`。实测运行时为 Codex `gpt-6-luna`，发现为 DeepSeek `deepseek-flash`，终答保存 5 条网页出处。部署、恢复和脱敏调用记录见 `~/Library/Application Support/OneEarth Next/iterations/primary-rc7-final-20261122/` 下的 `deployment-verification.json`、`restore.log` 和 `research-verified.json`。

## Mac mini 工作台与证据归属候选 v0.2.0-rc.7

**Mac mini 本批独立阶段验收通过。** 总体负责人于 2026-11-22 签收“工作台统一业务 API、发现职责收口”，源码为 `555f9e16bb853c0e8176d025ab46ef3647bf9a5c`，构建清单 SHA-256 为 `c4976780a1976ce3369f754222fcced77291aea2633d3edc5072e192cb6303ad`。入口为本机隔离的 [5894](http://127.0.0.1:5894)，负基线为 `4cad67b` 的 [5884](http://127.0.0.1:5884)。两边从独立 PostgreSQL 和 S3 恢复同一份快照，各恢复三库及 5,950 个对象。最终候选类型检查、构建和含真实隔离 PostgreSQL 的 680 项测试通过。图见[工作台与证据服务架构](../../docs/diagrams/oneearth-mac-mini-rc7.png)。

| 验收项 | 证据与口径 |
| --- | --- |
| 当前论文与历史依据 | 基线当前查询由同源入口直转发现，A2A 按 ID 操作返回 400。候选经运行时转发得到直接 Message。Chrome 重开同一研究任务 `c8c430a9-b5aa-4dea-b1cb-011ca40edc3b` 后，历史 SCIGN 两段原文逐字匹配原档，查看当前详情另发一笔读取。缺 ID 不启动搜索。 |
| 普通查询的故障隔离 | 集成预检临时设无效发现模型。论文详情 200，开放发现 503，发现任务数量不增。停止发现或挂起上游响应时，当前依据返回 503；原研究记录及两段原文仍可读取，原档 SHA-256 一致。最终套件仍覆盖这些边界。 |
| A2A 直接回执兼容 | `b5ca6cd` 修复 `618be0d` 缺少 `contextId` 的回执。实际 5895 论文、海纳均返回有效的独立上下文且没有 `taskId`，PG 中发现任务数 15→15。含 STAC 的受控生产方/客户端回归接受符合规范的回执并拒绝缺失上下文。 |
| 定向取材 | `618be0d` 的 Chrome 实问运行时任务 `9034ce2b-b4a7-428d-a2f8-bb8ed328da2c` 由独立发现任务 `7a8f8637-2856-4e8e-99d1-c462fb276016` 读取所指 SCEC PDF，第 2 页图注的摘录真实可重开。该版答复误将原档已存四站分组写成新补齐事实，已保留原档。最终代码用同一父档、原动作及已存读取回执，走真实 `gpt-6-luna` 合成与原有一次修复，答复将图注及垂向 GPS 吻合句归为此前已有、本轮复核，保留页码、截断和误差未知。两次调用分别 31.768、37.779 秒，总耗时 69.590 秒，无独立分类调用或 PDF 上游重复请求。受控对照另覆盖确有新增材料、裁短后未知，以及新读论文方法段进入模型输入、采用后按原资产和论文块归档。 |
| 真实开放发现 | `618be0d` 上的运行时任务 `d389ebbf-126d-42d5-9ed1-97d8d1342ac6` 触发初次发现 `e9070e3c-697f-44b3-88d5-97023673fc26`，模型判断存在证据缺口后补查 `45c52ada-9dca-49d7-b6e9-421c492db882`。真实进展通过 SSE 到达，Chrome 刷新后同一运行时任务继续，仅启动一个 worker 作业。运行时实际 Codex `gpt-6-luna`，发现实际 DeepSeek `deepseek-flash`。首条可见阶段材料 29.187 秒，首个非空终答正文 192.033 秒。第一条来源的已存依据在 Chrome 打开；另一出版社引用附带临时挑战参数，单项记录于 `evidence/observations/open-discovery-citation-identity.json`，站点可达性未核。 |
| 目录所有权与覆盖 | 海纳分页保持 461 条发布记录，已观测到的上游请求由发现进程发出，普通翻页没有触发同步。混合目录对同一修订继续查询只核对目录状态；用隔离发布接口更换同一真实数据集的版本后读到新版本，旧引用仍能按原 ID 打开。运行时转发时空覆盖，保留过期 410，森林图层对象条件请求仍返回 304。 |
| 逐景查询 | 控制上游验证固定的 Landsat/Sentinel 集合、点和时间窗口、影像条目、明确零结果及不可达的未知状态。运行时向发现方提交结构化条件，已有图层覆盖仍由时空服务提供。 |

证据根为 `~/Library/Application Support/OneEarth Next/iterations/runtime-discovery-ownership/`。基线浏览器与接口见 `evidence/baseline/`，构建指纹、真实查询、脱敏线路与 Chrome 截图见 `evidence/candidate/`。最终重启后的论文归档实测见 `paper-555f9e1-restarted.json`。五个候选应用角色的文件检查见 `file-ownership-555f9e1.json`，纸本 SQLite 由发现与时空打开，派生混合目录索引由运行时 API 打开。受控新论文断言见 `runtime-final-evidence/`，PDF 来源新旧对照见 `runtime-novelty-evidence/archive-replay.json`，A2A 提供方分项日志见 `evidence/discovery-provider/`。

独立复测索引位于 `~/Library/Application Support/OneEarth Next/iterations/workbench-discovery-acceptance/evidence/acceptance-index-555f9e1.json`。同目录的 `final-live-browser-555f9e1.json`、`direct-message-555f9e1.json` 和 `pdf-model-replay-controlled-555f9e1.json` 记录最终版的重启后档案、三类直接回执及 PDF 新旧事实对照，`acceptance-final-555f9e1.sha256` 保存签收证据清单。总体负责人据此签收本机隔离候选。临时挑战链接作为引用稳定性问题由主程单项跟进。

本机 Chrome 157 用相同的父研究记录、问题及 `gpt-6-luna` 各跑一次 PDF 补读。基线/`618be0d` 的服务端规划分别为 14.017/13.716 秒，指定来源实际读取为 2.532/3.051 秒，证据决策为 10.013/11.883 秒，终态为 44.417/41.710 秒。网页非空正文首次可见为 45.063/42.297 秒。候选受托调用合计 3.246 秒，其中包括来源读取。上游与模型缓存未统一，单样本只说明各段耗时。最终代码的回答重放单列于 `pdf-model-replay-555f9e1.json`。从恢复状态首次查混合目录为约 99/130 毫秒，随后同修订筛选为约 2–4 毫秒。论文详情与地图 HTTP 样本分阶段记在 `read-healthy.json`、`read-rc7.json` 和 `workbench-rc7.json`。

在候选源码目录复测类型、含隔离 PostgreSQL 的集成回归和构建。运行时与发现方分别使用各自的库，不读取常驻实例的数据库。

```sh
npm ci
npm run check
ONEEARTH_A2A_TEST_PG_BIN=/path/to/Postgres.app/Contents/Versions/18/bin npm test
npm run build
```

复跑使用新输出目录和独立实例，原截图和 JSON 保留。工作目录中的 `start-isolated.mjs` 记录 5884 或 5894 的角色与本机绑定，并核对三库及对象存储端口。观察器写入本次运行的 `wire.ndjson`。脚本 `probe-reads.mjs`、`probe-paper-browser.mjs` 和 `probe-source.mjs` 支持独立结果命名，报告与截图拒绝覆盖现有同名结果。当前仍有发现与时空之间的论文发布 SQLite 物理共享。机构与项目身份、真实 LAN Safari、多主机和容量另行验收。常驻 5474、前版隔离 5814 和题库部署沿用原配置。

## Mac mini A2A 与发现模型独立配置候选 v0.2.0-rc.6

**Mac mini 本机隔离候选通过独立验收。** 2026-11-22，总体负责人签收 A2A 委托和发现侧模型独立配置。 最终候选代码 `855670db503c4b93d226b03611853410756c644c`，独立入口 [5814](http://127.0.0.1:5814)，构建 SHA-256 为 `5992c2b10d4b545ab459100ee79fab7f2e7fdd6030882102372e3dc1f78c1444`。类型检查、构建和 629 项自动化测试通过，包含真实隔离 PostgreSQL 的受托协议测试。历史版本与常驻入口按原验收范围保留。

| 项目 | 自测观察 |
| --- | --- |
| 真浏览器与实际模型 | 以下真实推理和确认来自已独立复测的 `26efa4c`。公开南加州 GPS／InSAR 问题的运行时 ID 为 `196577e9-5400-446a-8117-c8554ddde42e`，发现 Task 为 `e4d9ba3d-ffcd-4662-bd93-6a57a2af5bab`。运行时用 Codex `gpt-6-luna`，发现进程经已有 Responses 适配调用 DeepSeek `deepseek-flash`，初始计划实际解析成功。网页方向核查达到 18 秒限时，已得材料保留。Search 与 Fetch 的实际调用各三次并成功。刷新续同一运行时任务与发现委托，终答有两项出处，Chrome 已打开保存的网页依据。 |
| 问题确认与普通澄清 | 在 `26efa4c` 的真浏览器川西问题中，Task `7e0e314a-bd73-4534-8bff-06118ef7d7a1` 等待确认前无渠道检索。刷新后确认，重复相同运行时请求得到同一 ID `27ca086e-de6b-4f5e-b81e-3d426b00f5b2`，只执行一次确认续行；模型随后针对新的证据缺口另开委托，终答有七项引用。 普通澄清的受控端到端复测使用真实 Chrome、运行时、发现 API 和分别运行的 PostgreSQL 数据库，模型和发现作业使用固定输入。明确回复沿用原选项和同一发现 Task；普通另问与旧卡不会唤醒等待。刷新和重复提交只执行一次续行。改题先出现确认卡，确认后才开新委托。最终候选回归初次委托已经完成、补查子委托等待的情况，能够重开已有材料，明确回复只推进该子委托。同目标后续新缺口沿用实际受理的目标和授权。 |
| 分离配置和恢复 | 在 `26efa4c` 仅更改发现进程的模型配置为无效值，新 A2A 委托返回 503，未入队。运行时进程仍按原模型完成任务 `c42f16c0-21c7-44c6-b496-1f1ad7f458d4`，已有发现产物哈希一致，随后恢复原授权的 DeepSeek 配置。 在另一套隔离服务，用两个有效的固定模型替身、更换发现进程并保持运行时进程、地址、协议和配置固定，依次读到不同的目录材料。该实验验证配置选择和归档路径；上文为真实 DeepSeek 推理及工具调用。 |
| 兼容和图层 | 干净 Chrome 可重开备份中的原研究记录 `c8c430a9-b5aa-4dea-b1cb-011ca40edc3b` 及来源，新增任务为零。在最终候选启动后重开真实 DeepSeek 首问和出处。前一构建另经浏览器选格、飞入、IMERG 2024 至 2023 年切换和 PostGIS 范围查询，实际从时空服务读取分块。 |

本机证据根为 `~/Library/Application Support/OneEarth Next/iterations/a2a-discovery-1/`。`evidence/final-candidate.json` 保存最终候选、构建和证据归属，`evidence/final-candidate-code.patch` 是相对 `26efa4c` 的八文件代码差异。初次真浏览器实测的版本与配置见 `evidence/candidate.json`；`evidence/browser-a2a-resume.json`、`evidence/browser-a2a-resume-postgres.json` 和 `evidence/deepseek-real-task-planning.json` 可核对真实首问及发现推理。`evidence/clarification-fixture.json` 和 `evidence/configuration-positive-control.json` 分别保存两组受控对照。真实确认见 `evidence/confirmation-browser-a2a-resume-postgres.json`，配置故障与恢复见 `evidence/configuration-processes.json`。旧候选在同一子澄清场景的失败见 `logs/clarification-child-before-fix.log`，最终通过见 `logs/clarification-refined-final.log`。

独立测试在 `independent-26efa4c.f8iiDA/evidence/` 复核前一构建的真实 DeepSeek、确认和配置对照，定向测试 58 项通过。最终构建在 `child-recheck-855670d.ymUQxc/evidence/` 通过独立 Chrome 与临时双 PostgreSQL 的子澄清复测，定向测试 29 项通过。对照旧失败见 `child-baseline-26efa4c.1whB5A/evidence/before-fix.json`，修订后见 `child-recheck-855670d.ymUQxc/evidence/clarification-fixture.json`。

在候选源码目录复测类型、真实隔离 PostgreSQL 契约和构建。

```sh
npm ci
npm run check
ONEEARTH_A2A_TEST_PG_BIN=/path/to/Postgres.app/Contents/Versions/18/bin npm test
npm run build
```

查阅时从证据根及上述独立目录读取归档。重跑前复制脚本到新目录，所有 JSON、截图和观察日志从副本写到新的 `evidence/`。以下只读重开和受控澄清命令已用新目录实跑，原浏览器报告、澄清报告和线路记录的哈希保持一致，核对见 `evidence/retest-output-isolation.json`。受控脚本自建临时数据库，使用固定材料。

```sh
work="$HOME/Library/Application Support/OneEarth Next/iterations/a2a-discovery-1"
retest_dir="$(mktemp -d /tmp/oneearth-a2a-retest.XXXXXX)"
mkdir "$retest_dir/evidence"
cp "$work/observe-wire.mjs" "$work/verify-browser.mjs" \
  "$work/verify-clarification-fixture.mts" "$work/verify-history.mjs" "$retest_dir/"
ln -s "$work/integration" "$retest_dir/integration"
cd "$retest_dir"
node verify-history.mjs 196577e9-5400-446a-8117-c8554ddde42e
node --env-file="$work/integration.env" --import ./integration/node_modules/tsx/dist/loader.mjs \
  verify-clarification-fixture.mts
```

使用当前 5814 实例另测公开问答时，`logs/active-wire-path` 指向独立目录中仍在写入的脱敏线路日志。新运行目录里的链接只供浏览器脚本读取，报告和截图写入本次副本。

```sh
read -r live_wire < "$work/logs/active-wire-path"
ln -s "$live_wire" "$retest_dir/evidence/wire.ndjson"
node verify-browser.mjs
node verify-browser.mjs --confirmation
```

首次启动独立实例时，在新运行目录启动复制的 `observe-wire.mjs`，其输出也落在该目录。在候选源码目录开两个终端按角色使用已有独立部署配置。原始签收证据可在此过程中继续只读查阅。

```sh
cd "$work/integration"
# 两条命令分别在各自终端运行。
node --env-file=../integration.env scripts/launch.mjs runtime worker spatial web
node --env-file=../discovery.env --env-file=../discovery-model.env scripts/launch.mjs discovery
```

机构身份、项目权限、跨机信任、ECS 和容量仍待各自环境验收。A2A 采用本机部署需要的委托操作，产物仍封装旧发现事件，论文目录仍共享 SQLite。常驻 5474 与百题 5794 沿用原构建。

## Mac mini 研究工作流候选 v0.2.0-rc.5

**独立阶段验收通过。** 2026-11-22，总体负责人签收 Mac mini 候选 `1cde6edb510234d829ac70ad20b51f116ca0ea3f`。验证源实例为 [5774](http://127.0.0.1:5774)，新位置恢复副本为 [5764](http://127.0.0.1:5764)。同一构建经类型检查与 565 项测试。签收范围为停写备份及单机候选。在线 5474 仍运行已签收的 rc.3。

| 验收 | 已复测行为 |
| --- | --- |
| 研究与引用 | SciNet 基线含三种首问和两条对象追问。SN-0379 自然追问恢复可打开的稳定引用。川西确认题 `26ddc7d4-b551-4eb5-837c-994abf6582b2` 刷新续接、返回部分材料及五条出处，来源预览可读四条已保存网页依据。 |
| 发现替换 | 运行时构建和进程固定，发现 A/B 实现分别运行。稳定引用从 A 记录重开，独立验证 B 协议内补充发现及边界拒绝；部分渠道失败时保留已得材料。 |
| 覆盖范围 | 同格同年但来源和候选集合不同的论文与 RGI 查询，分别保持其范围和引用。覆盖数字表示目录可定位。论文样本为隔离构造，RGI 为公开目录项。 |
| 发布与恢复 | rc.4 的旧恢复脚本只比较历史记录，漏掉当前论文目录。rc.5 经正式 HTTP 查找发起同一数据集键的版本更新，又经正式全量导入验证年份变化与移除项。受控上游与构造样例用于验证产品路径。停止应用和导入后备份，在空目标恢复三库、5,950 个图层对象及论文发布快照。重新启动时已切回常用授权配置。两端相同发布修订，重新签发范围读到同一材料和版本，历史快照及引用、森林图层可在 Chrome 打开。 |
| 性能 | 真后台发现的 flyto 独立通过。本机三次后台与三次空闲样本 P95 帧间隔为 16.7–16.8 ms。发现 A/B 耗时是单样本实测，两笔补充发现均为终答增加来源。材料充分的两次冻结材料的合成对照减少了一个模型调用，维持原发布默认。 |

本机受控证据根为 `~/Library/Application Support/OneEarth Next/iterations/0a0f409/`。代码和构建指纹位于 `catalog-restore/evidence/rc5-fingerprint.txt`。目录版本、旧失败请求复测、冷启动对照和浏览器结果分别见 `catalog-restore/evidence/` 的 `search-new.json`、`full-new.json`、`cold-endpoint-comparison.json`、`previous-exact-scope-recovery.json` 及 `browser-restore/verification.json`。受控证据保留在本机授权位置。

独立测试在两端分别新建范围，验证同一 H3 格 `871f8aa03ffffff`、2003 年的论文候选和公开 RGI 均有一个目录成员，现有研究记录与 rc.4 的历史记录逐字节一致。晚到的 A 回归使用固定模型与发现返回驱动实际运行时，先暂停在已取得 A，待 B 正式发布后完成任务。终答仍引用 A，按 ID 重开 A 可读，当前目录及新发范围读取 B。冷恢复后两者仍分别可查。独立测试证据见 `retest/paper-coverage-restore/` 的 `rc5-exact-scope-retest.json`、`rc5-catalogue-api-retest.json` 和 `delayed-runtime.json`。

在上述两套本机隔离实例均运行时，使用已归档的受控数据复查当前发布、历史内容 ID 和新范围成员。该命令在两端读取当前目录，并向 `/api/coverage/scopes` 新签范围后查询 `/api/coverage/cells`，同时用 `/api/paper-records?ids=…` 读取 A 和 B 的精确版本。

```sh
proof_root="$HOME/Library/Application Support/OneEarth Next/iterations/0a0f409"
node "$proof_root/spatial/evidence/catalog-restore/catalog-probe.mjs" compare \
  http://127.0.0.1:5774 http://127.0.0.1:5764 full-new 1cde6ed 1cde6ed \
  aebf32ee-ecd9-44f9-81d8-0c561fdaf7ac
```

历史研究记录、论文依据和森林图层另用浏览器复测。

```sh
npm run check
npm test
npm run build
ONEEARTH_SOURCE_URL=http://127.0.0.1:5774 ONEEARTH_URL=http://127.0.0.1:5764 \
  ONEEARTH_EVIDENCE_DIR=/path/to/isolated-evidence \
  node scripts/accept-product-restore.mjs c8c430a9-b5aa-4dea-b1cb-011ca40edc3b
```

机构身份与项目权限、真实 LAN Safari、第二执行器、在途替换、ECS 和容量分别待验证。发现 v1 返回内部计划类型，以及跨进程共享论文缓存，继续列为设计边界。

## Mac mini 复审候选 v0.2.0-rc.3

**独立签收通过。** 2026-11-22，「实测并优化 OneEarth 局域网交互性能」会话正式判定 Mac mini 第一阶段通过。[独立审查结论](reviews/oneearth-review-2603062/审查结论.md)

候选源码提交 `2603062`，独立发布目录 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.3-2603062`，服务入口 [5474](http://127.0.0.1:5474)。类型检查、构建和 553 项自动化测试通过。[构建与隔离核对](rc3/version.json)

本次处理模型规划输出偶尔漏掉编号来源的问题。模型选择研究动作，执行前由服务端补回已解析的单一来源；该补回有结构化标记。未知额外对象、冲突读取和不允许的检索仍会被拒绝。两次校验都失败时，对话给出可继续操作的提示，详细校验原因留在任务诊断。[确定性回归](rc3/planning-tests.log)

| 实际网页请求 | 结果 |
| --- | --- |
| 原审查问法 | `9259ade2-d9c8-481a-ac55-640d4a94b466`。模型选择检索，遗漏已解析来源。服务端补回稳定绑定，保持模型动作，随后委托独立发现并读取新资料，答复引用新找到的三条出处。[事件](rc3/reviewer-phrasing/search.json) · [答复](rc3/reviewer-phrasing/search.png) |
| 自然变体 | `4825f3c3-153a-475c-a97b-70bff19581aa`。模型选定同一编号来源并发起真实发现，最终列出两个新来源。该轮原本就携带正确来源，无需补回。[事件](rc3/numbered/search.json) · [答复](rc3/numbered/search.png) |

5474 继续使用相同的三项 `launchd` 作业。该候选经过受控重启，应用 PID 从 73960 变为 74166，在新浏览器打开同一研究记录和论文引用，森林图层的字节哈希一致。[受控重启](rc3/supervision/verification.json)

```sh
node --import tsx --test server/follow-up-reference.test.ts
npm run test:numbered-research -- search
```

### 独立签收证据

- `8bb9b43b-6711-4c1e-a0d6-a80b094b3dd9` 再次触发模型遗漏引用。事件 5549、5554、5634 依次记录 NOAA 来源定位、服务器补回该来源并保持检索动作、独立发现返回。后续两次读取成功、一次局部失败。论文 DOI `10.3390/w12041179` 与 2003–2017 年的研究时段已由审查方对照原出版页。[独立调用事件](reviews/oneearth-review-2603062/independent-sequence.json) · [网页回答](reviews/oneearth-review-2603062/search.json)
- `00a3ffba-86fd-4772-a2be-7bde1cb3a84e` 使用既有摘录作答，新增读取与发现均为零。`c778b9f4-f6b1-4b14-8997-459bfb66bee0` 读取指定来源一次、发现为零。[复用](reviews/oneearth-review-2603062/respond.json) · [定向读取](reviews/oneearth-review-2603062/read.json)
- 独立核实在线版本、服务托管、重启后记录和引用，以及森林图层哈希一致性。类型检查与 553 项测试独立通过。[线上版本](reviews/oneearth-review-2603062/version.json) · [重启后复核](reviews/oneearth-review-2603062/supervision/live.json)

后续展示问题：定向答复提示到 FAQ 查看下载说明，但把数据集介绍页的 URL 标为 FAQ 直达。该问题已登记，独立审查认定不阻塞签收。机构身份与项目权限、真实 LAN Safari、ECS 部署和容量仍待各自环境验证。本轮针对实际阻塞和回归场景复测，完整 706 题留作后续覆盖。

重跑原审查问法时，设置 `ONEEARTH_QUESTION` 为以下内容，再使用相同的网页复测命令。

> 第二个来源讲的是 CHIRPS。我想知道有哪些研究在长江流域实际使用过这套数据？请找一篇论文，给出研究区、使用年份和论文出处。

## Mac mini 复审候选 v0.2.0-rc.2

独立复审退回。托管、沿用资料和定向补读通过。用同一句自然问法查找新论文时，`f71805e6-088e-426a-b78b-224c94cea90e` 遗漏已绑定来源失败，重试 `e4a3dd65-d970-424c-a33b-8ffa8f16f4cd` 进入发现。[复审证据](reviews/oneearth-review-8d97933/search-terminal.json)

源码提交 `8d9793309a8805d04ec23f480a79f2a519e8bba9`。本机 [5474](http://127.0.0.1:5474) 运行从该提交独立构建的版本。类型检查与 550 项自动化测试通过。[构建与隔离核对](rc2/version.json)

rc.1 审查发现引用定位越权决定了动作。rc.2 把编号、来源身份、真实存量摘录和截断情况交给模型规划。执行器只读取本轮明确选定的来源。启用的 Fetch 按相同原地址读取，失败时可回原站。答复引用和执行记录经过校验，历史节选不算作本轮的读取，定向读取本身不产生检索记录。

三种回归都在新的 Chrome 会话中从同一研究记录 `c4036a5b-0444-4279-b9b0-d6283c9dd4f0` 提交，编号解析到同一 NOAA CHIRPS 页面。部署方式、PostgreSQL 和 Garage 的位置沿用 rc.1。最终候选再次受控重启，应用 PID 从 69128 变为 69402。新浏览器打开同一研究记录和出处，森林图层字节哈希一致。5574 同版本恢复副本抽查通过后关闭。[重启前后](rc2/supervision/verification.json) · [恢复抽查](rc2/restore/verification.json)

```sh
node scripts/macos-product-service.mjs status
npm run test:numbered-research
npm run test:numbered-research -- read
ONEEARTH_EVIDENCE_DIR=evidence/product/rc2/supervision npm run test:managed-release -- 6ed96dd3-e724-43ab-b8f8-5ed873960b8e
```

复测单一动作可指定 `respond`、`read` 或 `search`。机构登录仍单列所需入口、配置及测试身份。ECS 部署与压测保留第二阶段。审查方仍为「实测并优化 OneEarth 局域网交互性能」。

## Mac mini 后续候选 v0.2.0-rc.1

独立审查退回。5474 托管、记录和图层复核通过，气象站仪器漂移题 SN-0001 实际发起了补充发现。编号引用的追问走了旧的动作捷径，两个反例为 `f121845d-e4b6-493d-a477-49113b933866` 与 `05c3d627-6ce5-4dc0-8977-a5b4301b2d37`。[独立审查结论](reviews/oneearth-review-8581ccd/审查结论.md)

候选源码提交 `8581ccd`，独立发布目录 `~/Library/Application Support/OneEarth Next/releases/v0.2.0-rc.1-8581ccd`。主入口 [5474](http://127.0.0.1:5474) 使用本机回环地址。安装后的 `launchd` 作业为 `org.oneearth.next`、`org.oneearth.next.postgres` 和 `org.oneearth.next.garage`，配置位于 `~/Library/LaunchAgents/`，日志位于 `~/Library/Application Support/OneEarth Next/logs/`。构建使用 `npm ci && npm run build`。类型检查和 546 项自动化测试通过。[构建标识](candidate/version.json)

运行时把本轮目标、引用身份及已实际返回材料交给模型决策。统一执行器适配器发出发现协议请求或按稳定身份读取来源。为限制单任务用时，首轮之后最多安排两轮取证，其中补充发现最多一次。补充发现使用新子任务号并校验原问题、确认及渠道设置。

| 检查 | 实测结果 |
| --- | --- |
| 材料已足 | 月降水数据库对比任务 `c4036a5b-0444-4279-b9b0-d6283c9dd4f0` 从网页提交。独立发现返回资料后，模型在同一任务选择直接回答。一次发现、零次补读，答复带两个可打开的来源。在新浏览器重开同一任务截图。[调用记录](candidate/direct.json) · [答复](candidate/direct.png) |
| 材料不足 | IMERG 月字段核验任务 `a67b99b1-5874-4f88-bba7-25e9a1c2c1ff` 在第一批线索到达时刷新，继续同一任务号。发现完成后模型先后两次判定需要补读，实际发出四次指定来源读取，三次取得正文片段、一次失败。模型复核现有材料后选择回答，最终带两个来源，早到线索与失败仍可查看。[调用记录](candidate/additional.json) · [刷新前](candidate/additional-before-refresh.png) · [答复](candidate/additional.png) |
| 用户确认 | 提议任务 `c313cf65-9e4c-4acf-92e9-87de38a81ef8` 停在网页确认卡片，独立发现库中渠道调用为零。点击继续后，PostgreSQL 把确认写入续行任务 `9b6ff93e-66ee-4868-a659-a02cdb0d6d40` 并链接原任务。[确认前界面](candidate/confirmation/awaiting-confirmation.png) · [持久化核查](candidate/confirmation/database.json) · [确认后的实际渠道](candidate/confirmation/results.json) |
| 入口为何停止 | 旧版 5474 以前台终端进程启动，停止时没有独立托管，数据库及对象服务仍在线。旧日志只记录了启动，退出信号未留存。 |
| 启动终端退出与受控重启 | 单独终端中安装后退出。另起 Chrome 打开记录 `6ed96dd3-e724-43ab-b8f8-5ed873960b8e`、同一论文引用及森林图层。应用进程由 PID 1 托管且无 TTY，受控重启 PID 从 57826 变为 57977，研究记录和 S3 图层哈希一致，两个存储服务 PID 保持。[重启取证](candidate/supervision/verification.json) · [重启后引用](candidate/supervision/after-source.png) · [重启后森林图层](candidate/supervision/after-layer.png) |
| 机构登录和 ECS 边界 | 本机入口使用已授权的现有模型与 Search/Fetch 访问配置。机构登录及项目权限验证仍需机构入口、客户端配置和测试身份。ECS 部署与压测安排在第二阶段。 |
| 独立性与恢复 | 应用通过系统策略禁止访问原型目录、启动项和 5174。现网 5174 从隔离范围外可访问。相同候选用独立 PostgreSQL 与 Garage S3 在 5574 重开样例记录、引用和图层，抽查结束关闭 5574。[隔离](candidate/isolation.json) · [恢复](candidate/restore/verification.json) · [球体](candidate/spatial/verification.json) |

复测命令在包含本验收索引的仓库版本运行。候选应用由上面的源码提交构建。

```sh
node scripts/macos-product-service.mjs status
npm run test:managed-release -- 6ed96dd3-e724-43ab-b8f8-5ed873960b8e
npm run test:research-decisions -- direct
npm run test:research-decisions -- additional
```

`test:managed-release` 会受控重启 5474 的应用组，宜在运行任务完成后执行。常驻安装、日志及按需恢复命令见[部署与恢复手册](../../docs/部署与恢复.md)。前一阶段架构图 `.local/exports/OneEarth-当前技术架构-v0.2.0-dev.1.png` 是原机工作区的历史导出文件，需从原工作区取得。[图索引](../../docs/diagrams/README.md#历史架构快照)


## Mac mini 存储与恢复历史基线 v0.2.0-dev.1

版本 `v0.2.0-dev.1`。主入口 [5474](http://127.0.0.1:5474)，恢复验收入口 [5574](http://127.0.0.1:5574)。验收使用 Mac mini、Node.js 26、Chrome 157 和已授权的 Codex `gpt-6-luna`。入口绑定本机回环地址。部署和恢复命令见 [README](../../README.md)。三项核心检查使用真实运行的产品服务，界面预览另有固定样例回归。类型检查、独立构建及 542 项自动化测试通过。

| 项目 | 观察结果与证据 |
| --- | --- |
| 问答与发现 | 川西滑坡首问进入独立发现服务，形成带 3 项引用的答复。闪旱比较方法由模型回答，未新查资料。缺少对象的分辨率比较由模型请求澄清。三个样本均有真实执行器记录。[自然问题](natural-questions/results.json) |
| 刷新与追问 | 西北太平洋首问检索期间刷新，服务端与浏览器继续使用同一任务 UUID。模型答复整理超时，保留 8 个资料来源。随后按“第 2 篇文献”追问，完成答复并保留该篇稳定引用，新增发现调用为零。[任务事件](first-turn/task-evidence.json) |
| 用户确认 | 首轮停在确认卡片，确认前没有资料检索。点击继续后 PostgreSQL 记录一次用户决定，与原任务关联。海纳和文献渠道实际完成，网络渠道部分完成，保留了阶段发现。[确认与渠道记录](confirmation/results.json) · [数据库计数](postgres.json) |
| 独立存储 | PostgreSQL 18.7 保存任务、事件、确认、引用及分享快照。发现库保存任务、事件、发现线索、渠道状态和已发现的论文记录。PostGIS 3.6.3 索引 3 类图层及 6,068 条对象路由，Garage S3 保存 5,950 个去重后的图层对象。独立的 SDK 读取了 2023-07-15 海纳森林原始分区，字节哈希与图层清单一致。论文断言库连接保持只读。[数据库实查](postgres.json) · [海纳校验](haina-read.json) |
| 球体 | 浏览器收到 71 次有效分块响应，确认来自时空服务。执行了选格、飞入、IMERG 2024→2023 时相切换和 PostgreSQL/PostGIS 范围查询。[时空证据](spatial/verification.json) |
| 同版本恢复 | 从专用 PostgreSQL 55432、S3 5900 导出，恢复至独立 PostgreSQL 55434、S3 5920。三个库恢复后计数一致。5,950 个对象逐个核对 SHA-256 后写入新桶。两个入口来自独立构建，网页产物相同。新浏览器实际打开同一研究记录、同一论文来源和森林图层，两边读取的图层字节哈希相同。恢复后又用英文追问川西滑坡答复中的第 2 个来源，真实执行器沿用同一来源，新增发现调用为零。样例旧浏览器会话中的论文引用也能打开。[导出](restore/export.json) · [写入](restore/import.json) · [库计数](restore/postgres.json) · [浏览器](restore/verification.json) · [旧会话样例](legacy-sample/results.json) |
| 界面 | 1512×859、DPR 1 下，新首页、收起 Chat 和选格与参考图的页头及左栏逐像素一致。工作区图像随底图、动态状态与捕获时刻变化。网页与 PDF 用固定样例验证实际预览、分页、局部下载和页码引用到 Chat。[对照数据](visual-comparison.json) · [首页](first-turn/home.png) · [选格](spatial/selected-grid.png) · [预览样例](preview-fixture/pdf-preview.png) |
| 原型独立性 | 两个产品进程树均在 macOS 进程级限制下运行，原型源目录、部署目录、启动项及 TCP 5174 被隔离。恢复和性能验收的浏览器进程树也封锁 TCP 5174，测试期间从限制外仍可访问原型健康接口。凭据由独立路径注入。[发布验证](deployment.json) |

## 实测性能

同一台 Mac mini、无头 Chrome 157、1512×859、DPR 1。连续执行相同的拖动与缩放，每种状态三次。空闲帧间隔 P95 分别为 16.7、16.8、16.8 ms。真实后台检索期间分别为 16.7、16.7、16.8 ms，六次采样均无超过 33.4 ms 的帧。后台检索期间还完成了时相切换、选格和飞入。新浏览器首次 IMERG 图层就绪 462 ms，记录到的 38 个冷图层响应合计 1,255,385 字节，单个响应 3–42 ms。记录文件包含热缓存行为和各次主线程时间。[性能原始记录](performance/results.json)

该次川西研究任务的服务端排队 29 ms，首次真实发现线索 19.5 秒，浏览器看到检索进度约 19.8 秒，最终答复约 87.9 秒。答复以完整消息呈现。推理、网络渠道和前端渲染只有记录中的部分耗时可分解。没有新的局域网 Safari 客户端样本，这组数据适用于本机及本轮实际负载。[执行器与事件记录](performance/results.json)

## 重跑验收

```sh
npm run check
npm test
npm run build

ONEEARTH_URL=http://127.0.0.1:5474 npm run test:natural
ONEEARTH_URL=http://127.0.0.1:5474 ONEEARTH_EVIDENCE_DIR=evidence/product/spatial npm run test:spatial
ONEEARTH_URL=http://127.0.0.1:5474 ONEEARTH_DISCOVERY_URL=http://127.0.0.1:5475 \
  ONEEARTH_LIVE_CONFIRMATION=1 ONEEARTH_EVIDENCE_DIR=evidence/product/confirmation npm run test:fault
ONEEARTH_URL=http://127.0.0.1:5474 ONEEARTH_MEASURE=next ONEEARTH_EXTENDED_MAP=1 \
  ONEEARTH_EVIDENCE_DIR=evidence/product/performance npm run test:performance
npm run test:product-restore -- <已备份到 5574 的论文研究任务 ID>
```

隔离复测可把浏览器命令置于 macOS 的 `sandbox-exec` 下，配置 `(deny network-outbound (remote tcp "*:5174"))`。配合 [隔离发布命令](../../scripts/start-isolated-release.mjs) 验证服务进程。同一 worker 串行消费研究任务，单样本性能测量应等待之前的任务结束。第一次恢复演练在普通产品角色执行 PostGIS 扩展注释时失败，脚本已过滤预装扩展拥有者的条目，随后在新的空目标恢复通过。残留试验数据未用于通过的验收。

## 机构登录与 ECS

机构网页登录需要真实的测试入口、客户端配置及可用于核对用户和项目权限的测试身份，单列外部条件。浏览器验收入口仅用于本机。历史数据只用样例验证，未导入私人历史。

下一阶段以同一 Git 标签、独立数据和凭据配置迁到 ECS。ECS 需要实测 Linux/目标 CPU 上的 Node.js 26、原生 `sharp` 和执行器、无桌面登录、容器网络和代理、健康检查、回退、认证与项目权限。当前环境没有 Docker、Podman 或 Colima，交付证据为 arm64 macOS 的独立构建和实机复部署。ECS 并发与真实 LAN Safari 测试另列，待对应环境到位。
