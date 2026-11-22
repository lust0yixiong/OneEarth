# Mac mini 产品验收

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

`test:managed-release` 会受控重启 5474 的应用组，宜在运行任务完成后执行。常驻安装、日志及按需恢复命令见 [README](../../README.md)。[前一阶段已交付的架构 PNG](../../.local/exports/OneEarth-当前技术架构-v0.2.0-dev.1.png) 保存在本机工作区。


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
