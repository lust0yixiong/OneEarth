# Mac mini 产品验收

## Mac mini 后续候选 v0.2.0-rc.1

自测通过，待审查。指定审查会话为「实测并优化 OneEarth 局域网交互性能」（`01a1ded9-6d75-7cc0-9810-248ab7b50b91`）。

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

`test:managed-release` 会受控重启 5474 的应用组，宜在运行任务完成后执行。常驻安装、日志及按需恢复命令见 [README](../../README.md)。[前一阶段已交付的架构 PNG](../../.local/exports/OneEarth-当前技术架构-v0.2.0-dev.1.png) 保存在本机工作区。


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
