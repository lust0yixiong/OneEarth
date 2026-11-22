# OneEarth Next

OneEarth 用于提出研究问题、核对数据和文献来源，并在球体上查看数据的空间范围与时相。Mac mini 是首个部署环境。历史开发基线保存在 `v0.1.0`，Mac mini 存储与恢复基线为 `v0.2.0-dev.1`，后续候选版本见验收记录。本机入口和实测证据见 [产品验收记录](evidence/product/ACCEPTANCE.md)。开发基线的截图、故障与隔离复测见 [历史验收记录](evidence/ACCEPTANCE.md)。

## Mac mini 部署

准备 Node.js 26、带 PostGIS 的 PostgreSQL 18 和实际的 S3 兼容服务。Mac mini 可以使用 [Postgres.app 的 PostgreSQL 与 PostGIS 命令行组件](https://postgresapp.com/downloads.html)和 [Garage 的本地服务](https://garagehq.deuxfleurs.fr/documentation/quick-start/)。部署不需要原型服务或启动项。使用新工程已有的独立基础网格与 IMERG 数据副本，或用 `npm run data:prepare -- <独立数据目录>` 准备新位置所需的包。海纳原始数据仍由上游保存。

从原型沿用上游访问权时，在具备原始授权环境的研发工作区一次性执行 `npm run access:import`。脚本仅将已授权的上游访问配置写到当前用户独占的 `~/Library/Application Support/OneEarth Next/access.json`，并保留本机已授权的执行器登录。独立发布指定该文件或等效凭据注入，生产启动不启用 `ONEEARTH_USE_EXISTING_ACCESS=1`。

```sh
npm ci
npm run check
npm test
npm run build
ONEEARTH_PG_BIN_DIR=/path/to/Postgres.app/Contents/Versions/18/bin \
  node scripts/macos-product-storage.mjs init primary 55432 5900
deploy_config="$HOME/Library/Application Support/OneEarth Next/storage-primary/deployment.env"
node --env-file="$deploy_config" scripts/launch.mjs seed
ONEEARTH_PORT=5474 ONEEARTH_DISCOVERY_PORT=5475 ONEEARTH_SPATIAL_PORT=5476 \
  node --env-file="$deploy_config" scripts/launch.mjs
```

启动前配置见 [.env.example](.env.example)。Mac mini 验收实例使用 5474–5477。也可使用 `node --env-file="$deploy_config" scripts/start-isolated-release.mjs <原型目录绝对路径>`，验证运行进程无法读取原型目录和启动项或连接 5174。应用前台用 Ctrl+C 停止。数据库与对象存储可以用 `node scripts/macos-product-storage.mjs start primary` 重新启动。

### Mac mini 常驻入口

在现有 primary 存储基础上，使用 `launchd` 托管应用、PostgreSQL 和 Garage。Bootstrap 在当前 Mac 用户的 GUI 会话中执行，终端关闭后由系统保持进程。应用入口绑定 `127.0.0.1:5474`。把候选源码与依赖构建到 `~/Library/Application Support/OneEarth Next/releases/` 下的独立目录，基础 H3/S2 数据放在同一专用目录下的 `base-data/`，保留现有 `storage-primary/deployment.env`。

```sh
oneearth_home="$HOME/Library/Application Support/OneEarth Next"
node scripts/macos-product-service.mjs install "$oneearth_home/releases/<候选目录>" "$oneearth_home/base-data"
node scripts/macos-product-service.mjs status
node scripts/macos-product-service.mjs restart
```

安装命令只接管 OneEarth Next 的主存储与应用。重新安装不同发布目录时保留主数据库和对象存储。用 `stop` 和 `start` 控制主应用。应用与存储日志写到 `$oneearth_home/logs/`。恢复演练仍通过独立配置按需启动 5574。其他平台可直接通过 `scripts/launch.mjs` 注入同一套服务配置。

## 服务与数据

模块职责、核心接口和 ECS 部署前需要验证的边界见[架构与接口审查](docs/架构与接口现状.md)。

| 程序 | 职责 |
| --- | --- |
| 网页入口 | 保留 React 界面、Canvas 球体和来源预览，转发同源任务和图层请求 |
| 运行时 API 与 worker | PostgreSQL 保存任务、按序事件、用户确认、答复引用及结果快照。worker 通过统一适配器调用模型、读取指定来源与委托独立发现。模型看到已返回材料后决定直接回答、补读、补充发现或澄清；运行时记录决定和阶段结果 |
| 数据发现 | 独立任务库保存发现任务、事件、线索、渠道状态及可随产品恢复的资料记录。论文断言库始终只读 |
| 时空服务 | PostgreSQL + PostGIS 保存图层与分块的空间及时间索引，由 S3 API 保存和读取概览与分块。已有计算缓存可由服务重建 |

客户端提交 `POST /api/tasks` 并通过 `GET /api/tasks/:taskId/events?after=<seq>` 订阅。刷新继承原任务号。用户确认绑定历史提议。`?research=<taskId>` 可在浏览器重新打开已结束的同一条研究记录。图层请求走时空服务，问答期间可继续浏览球体。补充发现使用独立子任务编号，沿用已确认问题及 Search/Fetch 配置。

机构网页登录缺少外部入口或配置引用，单列验证。本机产品入口绑定回环地址。与机构登录和项目授权联调前，保持本机范围。

## 备份和恢复

应用停写或无活动任务时备份产品数据库与对象，备份目录内包含研究记录，应仅交付已授权数据。初始化另一个 PostgreSQL 实例、Garage 服务和空桶，并在独立配置下恢复。恢复在独立目标中完成，全部通过后再启动应用。若恢复中断，保留失败目标用于排查，使用新的空目标重跑。

```sh
export ONEEARTH_PG_BIN_DIR=/path/to/Postgres.app/Contents/Versions/18/bin
node --env-file="$deploy_config" scripts/product-backup.mjs export .local/product-backup
node scripts/macos-product-storage.mjs init restored 55433 5910
restore_config="$HOME/Library/Application Support/OneEarth Next/storage-restored/deployment.env"
node --env-file="$restore_config" scripts/product-backup.mjs restore .local/product-backup
ONEEARTH_PORT=5574 ONEEARTH_DISCOVERY_PORT=5575 ONEEARTH_SPATIAL_PORT=5576 \
  node --env-file="$restore_config" scripts/launch.mjs
```

`scripts/accept-product-restore.mjs` 使用干净的浏览器会话比对原始实例和恢复实例中的同一任务、来源和森林图层。产品数据库和对象服务配置可替换为 ECS 的独立 PostgreSQL、PostGIS 与 S3 兼容服务。云环境的连通性、并发、生产认证与切换留待第二阶段实测。
