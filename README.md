# OneEarth Next

Mac mini 本地验收入口为 http://127.0.0.1:5274 。发布版本为 `0.1.0`。原型 5174 保留。新版运行所需的网格、图层对象、目录缓存和任务数据位于新版自己的目录。已有上游访问通过部署进程加载。

## 构建和启动

本机实测为 macOS arm64、Node.js 26.0.0、npm 11.12.1。首次安装在独立工程目录执行。

```sh
npm ci
npm run data:prepare
npm run data:seed
npm run build
ONEEARTH_USE_EXISTING_ACCESS=1 npm start
```

`data:prepare` 一次性从指定的资料目录复制基础网格和 IMERG 2023、2024 两年。可传入资料目录，或者将独立网格副本放入 `.local/globe-data`。`data:seed` 在时空进程启动前运行，把已发布分块和海纳森林／城市切片登记入 PostGIS 和对象存储。旧版源码下载包没有纳入新版发布。

```sh
npm run status
npm run check
npm test
npm run test:e2e
npm run test:spatial
```

前台启动后用 Ctrl+C 停止同一组进程。`node scripts/launch.mjs web runtime worker discovery spatial` 可指定角色。默认入口与服务均绑定本机。通过 [.env.example](.env.example) 配置独立端口和写目录。

## 服务边界

| 监听 | 程序 | 数据与职责 |
| --- | --- | --- |
| 5274 | 网页入口 | 继承原型 React、Canvas 球体和预览，同源转发任务与图层请求 |
| 5277 | 运行时任务 API | 提交、状态、按序事件重放、取消。SQLite 仅保存在新版状态目录 |
| 无浏览器入口 | 后台 worker | 从任务队列领取工作，通过 Codex／Claude 适配入口执行。首期实测 Codex `gpt-6-luna` |
| 5275 | 发现服务 | 独立队列和 HTTP 协议。组织文献、海纳、Search/Fetch 和渠道结果。断言只读 |
| 5276 | 时空服务 | 图层、分块及空间时间索引。Mac mini 使用 PGlite/PostGIS 与按内容哈希保存的对象。可配置外部 PostgreSQL 和 S3 兼容桶 |

网页端使用 `POST /api/tasks` 提交任务和稳定会话标识，使用 `GET /api/tasks/:taskId/events?after=<seq>` 读取 NDJSON 事件。浏览器刷新会用原任务号重新订阅，期间不重复派发。研究问题确认绑定实际返回的待确认任务。进程中断时保留旧事件和证据，记录中断并要求明确重试，避免重复未知状态的外部调用。

时空服务支持 `GET /api/spatial/layers`、`GET /api/spatial/layers/:id/chunks` 及版本化对象读取。分块按视野、尺度、时段加载。源研究区与数据集覆盖分开。原型网格交互使用的覆盖计算在时空服务中保留独立缓存。

## 凭据与还原

现有授权由 Mac mini 启动器从原型已有环境来源读取，仅注入进程。配置模板不存放密钥。新版不会复制私人浏览器会话。Mac mini 验收预设为本机用户入口。

样例导出需要指定已结束的公开验收任务。新版已运行时可以从时空服务的本地端口读取对象，并按哈希核对。

```sh
ONEEARTH_EXPORT_ORIGIN=http://127.0.0.1:5276 npm run backup:sample -- export .local/restore-sample <首问编号> <追问编号>
ONEEARTH_STATE_DIR=.local/restore-state npm run backup:sample -- restore .local/restore-sample
ONEEARTH_PORT=5304 ONEEARTH_DISCOVERY_PORT=5305 ONEEARTH_SPATIAL_PORT=5306 ONEEARTH_STATE_DIR=.local/restore-state npm start
```

样例包包含任务、事件、引用和一个完整森林图层，留在 `.local`。目标需要先构建并准备基础网格。备份实测和 ECS 待验证项见 [验收记录](evidence/ACCEPTANCE.md)。
