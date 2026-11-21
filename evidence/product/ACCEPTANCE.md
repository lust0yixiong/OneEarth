# Mac mini 产品验收

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
