# 运行时与数据发现服务

本文是 Mac mini OneEarth rc.10 的发现服务现行接口契约。运行时持有研究记录、轮次、引用和研究者确认，发现服务持有一次受托任务及渠道检索过程。网页使用同源运行时任务接口，不直接调用发现端。当前常驻版本和部署地址见[架构与接口现状](架构与接口现状.md)。

## 委托与取回材料

内部发现接口绑定回环地址。使用 A2A 1.0 的 HTTP+JSON 绑定，操作请求带 `A2A-Version: 1.0`，JSON 请求正文使用 `application/a2a+json`。协议说明以 [A2A v1.0.1 正式规范](https://a2a-protocol.org/v1.0.1/specification/) 为准。

| 操作 | 在 OneEarth 中的用途 |
| --- | --- |
| `GET /.well-known/agent-card.json` | 声明数据发现能力和流式订阅 |
| `POST /message:send` | 论文查询、论文时空投影、海纳目录和指定条件逐景查询返回 `200 {message}`。开放发现、精确补读与私有观测委托返回 `200 {task}`。运行时设置 `configuration.returnImmediately=true`，受理后按原 Task ID 读取进展。 |
| `POST /message:stream` | 提交受托任务并开启该任务的 SSE。直接 Message 查询使用 `/message:send`。 |
| `GET /tasks/{id}` | 返回 Task 对象本身 `{id,contextId,status,artifacts}`。用于按原 ID 取回状态及已保存材料。 |
| `POST /tasks/{id}:subscribe` | SSE 首帧为 `{task}`，随后按序发送 `artifactUpdate` 与状态变更 `statusUpdate`。请求体可为空或为 `{}`。 |
| `POST /tasks/{id}:cancel` | 取消已验证受理的委托，成功返回 Task 对象本身。已取消的 Task 可重复核对取消结果。请求体可为空或为 `{}`。 |

所有委托用一条 `ROLE_USER` 消息和一个 `message.parts[0].data = {kind,input}` 数据 part。开放发现的 kind 为 `oneearth.discovery.request.v1`，其输入描述本次目的、证据缺口、已确认范围、引用或已得材料及本轮 DeepSeek Search 和 DeepSeek Fetch 开关。其他操作使用下文所列的 kind。发现服务用自己的配置选择规划模型并管理查找计划。公开网络的实际执行经过运行时适配层。机构和项目权限、具体材料能否外发由各自权限边界约束。

直接 Message 带每次响应新生成的 `contextId` 和 `messageId`，且没有 `taskId`。受托 Task 使用服务端生成的 Task ID，当前实现的 Task `contextId` 与 Task ID 相同。运行时分别保存提交消息 ID、发现 Task ID、上下文和消费进度。稳定的产物 ID 和保存的事件序号用于去重。首帧包含当前快照，断流时从同一个 Task 读回存档。SSE 数据帧为 `data: <JSON>` 加空行，也可能有 `: keepalive` 注释。[服务端路由](../server/discovery-a2a-server.ts) · [运行时客户端](../server/discovery-a2a-client.ts) · [A2A Message 规范](https://a2a-protocol.org/v1.0.1/specification/#414-message)

常驻研究 worker 在持久步骤中通过 GET 核对原 Task，远端仍执行时保存进度并让出 worker 名额。普通发现客户端在无持久步骤时使用 GET 与 SSE 订阅。私有观测客户端按原 Task 短请求读取状态与产物。订阅与完成竞态时，已结束的 Task 返回 HTTP 400，`error.status` 为 `FAILED_PRECONDITION`，`error.details[].reason` 为 `UNSUPPORTED_OPERATION`。改用 GET 读取原档。完成先于取消时，同样返回 HTTP 400，细因为 `TASK_NOT_CANCELABLE`。运行时通过原 Task 的 GET 核对实际终态，服务不可达时记录取消未确认。[持久研究步骤](../server/runtime-step.ts) · [状态、订阅与取消](../server/discovery-a2a-client.ts)

### 服务身份与凭据

普通开放发现、精确补读的 A2A 提交及其非私有 Task 操作，以及直接目录 Message，在回环入口无需 Bearer。具体网页读取仍由独立回调授权。以下三类服务凭据按接口使用。

| 凭据 | 调用方向及用途 |
| --- | --- |
| `ONEEARTH_DISCOVERY_RECOVERY_TOKEN` | 运行时 worker → 发现的本机回环受理查证。作为查证请求的 Bearer，另需原请求指纹。 |
| `ONEEARTH_SKILL_SERVICE_TOKEN` | 运行时 → 发现的私有观测提交、继续提交读据、读取、订阅及取消。提交凭据无效时返回 401。合法路径和任务身份下，无权读、订阅或取消私有 Task 返回 404。 |
| `runtimeWebToolGrant` | 运行时按本轮消息发给发现服务。发现 → 运行时的工具回调使用它作 Bearer，并出示实际受理身份和调用 ID。 |

[服务端授权](../server/discovery-a2a-server.ts) · [观测客户端](../server/observation-discovery-client.ts) · [部署与恢复](部署与恢复.md#端口)

### 受理回执恢复

持久委托请求发出后若未取得 Task ID，worker 在 IPv4 回环调用发现端 `GET /internal/discovery-delegations/{messageId}`，附查证 Bearer 及 `X-OneEarth-Request-Fingerprint`。观测类另带 `X-OneEarth-Delegation-Family: observation`。指纹是按对应业务种类选取身份和原输入后，对递归排序对象键的 JSON 求 SHA-256。数组顺序保留，传输选项不计入指纹。[指纹算法](../server/discovery-request-fingerprint.ts)

| 查证返回 | 运行时处理 |
| --- | --- |
| `200 {taskId,idempotentReplay:true}` | 已确认受理。读取原 Task。 |
| `404 {code:"DELEGATION_NOT_FOUND",idempotentReplay:true}` | 确认未受理。持久委托仅在原请求、消息身份和原授权仍有效，且剩余重送额度允许时原样提交。 |
| 409、无受理身份的其他响应或网络失败 | 保留原执行记录。单独的 HTTP 404 不足以证明可重送。 |

查证只返回受理身份。离开持久步骤的普通客户端在还未受理时使用同一个消息 ID 和原请求做有界重试，取得受理后按原 Task 读回。[恢复客户端](../server/discovery-delegation-recovery.ts) · [提交及恢复策略](../server/discovery-a2a-client.ts)

### 发现渠道范围

发现服务从当前用户原问题、已确认问题和可信续查上下文解析来源范围，再启动相应渠道。问「海纳内部有哪些这类数据」即限定海纳。先前引用的论文或网页可帮助理解对象，不能授权新一次查询这些渠道。网页继续提交原问题和既有上下文字段。

| 用户表达 | 查找行为 |
| --- | --- |
| 限定一个或多个渠道 | 只执行所限定的渠道。全部无匹配时报告该范围内的结果，故障时报告还不能确认。扩大范围取决于用户的新指示。 |
| 优先某渠道 | 先完成优先渠道。有可用候选时先用该渠道；没有取得候选时，可按用户已给的范围继续查找。 |
| 指定顺序及后备条件 | 先等优先渠道的结果。「海纳找不到再看论文」在海纳完成且无匹配后执行论文。海纳有结果或查询失败时，论文和公开网络均不执行。 |
| 未限定渠道的开放查找 | 沿现有策略查询有有效参数的各路，保留每路的独立结果。 |

计划产物可包含 `sourcePolicy`，用 `restricted` 或 `preferred` 及有序的 `sources` 记录来源策略。只在前一渠道确认零命中后启用下一渠道时，计划包含 `fallback: "no_match"`。来源标识为 `haina`、`paper`、`web`、`constellation`。星座接收库查询由运行时负责。同一研究轮的补查继承归档中的范围和条件结果。父任务已在海纳找到资料时，子任务未查到该资料的某个字段不会打开原先未启用的论文渠道。执行产物 `sourceStatus` 中，`done` 且 `count: 0` 表示完成但未命中，`failed` 表示失败，`not_requested` 的渠道没有启动工具记录。

### 开放研究中的多主题文献检索

当一个研究计划有多个有效且去重的文献主题，且未指定单一名称时，发现服务在同一个受托任务内按计划顺序逐项查询。该文献分支共享 30 秒调度窗口，单一主题对断言库的查询期限至多 13 秒，剩余不足 11 秒的主题记录为本轮未查。渠道范围仍沿原计划。查询成功的主题先发布其可按原 ID 读取的论文记录，再回报当前成果。计数按已核对到明确论文用法的不同论文 ID 去重，每主题可附四条可打开的资料。候选上限、超时和未启动分别留证。目录数量与文献命中数量独立。运行时将这些事实投影到原研究轮的公开进度。[主题执行](../server/literature-topic-search.ts) · [工作台公开进度](架构与接口现状.md#原生-ag-ui)

### 确定性论文查询

`kind=oneearth.paper.query.v1` 在同一个 `POST /message:send` 接收 `input.operation`。网页仍使用运行时提供的相同 `/api/paper-records` 路径。以下操作使用当前发现域的发布记录与只读论文连接。打开归档回答时，当轮原材料仍来自运行时研究记录。

| operation | input 其余字段 | 返回的 value |
| --- | --- | --- |
| `records` | `ids`，1–20 个精确内容 ID | 按输入顺序返回找到的记录。未知 ID 不触发查找 |
| `list` | `view` 为 `full`、`catalog` 或 `map`，`cursor` 为字符串，`limit` 为 1–500 | `records`、`nextCursor`、`total`、`catalog` 和 `cached`。`catalog.revision` 是发现库持久的当前发布修订，供消费方校验分页 |
| `questions` | `id`、`cursor`，起始游标为空字符串 | `items` 和 `nextCursor` |
| `evidence` | `id` | `dataset` 和 `papers`。缺失 ID 返回 404，断言读取不可用返回相应错误 |
| `search` | 用户明确输入的 `query`，最长 240 字符 | 原名称/DOI 检索结果和渠道限制。沿用显式查询的发布行为 |

已知 ID 查询不要求模型可用，不创建受托任务。显式 `search` 可以查上游并更新发布目录。空记录和错误不降级为搜索。以下请求在没有该内容 ID 时返回空数组。

```json
{
  "message": {
    "messageId": "5f1a50e7-d613-495e-b559-189296f07626",
    "role": "ROLE_USER",
    "parts": [{"data": {
      "kind": "oneearth.paper.query.v1",
      "input": {"operation": "records", "ids": ["earthnano:0000000000000000000000000000000000000000000000000000000000000000"]}
    }}]
  }
}
```

```json
{
  "message": {
    "messageId": "82e55883-259b-4bc4-9028-d8d7c436e8cd",
    "contextId": "c9125c51-a10e-490b-9c48-8cd2ebf93872",
    "role": "ROLE_AGENT",
    "parts": [{"data": {"kind": "oneearth.paper.result.v1", "operation": "records", "value": []}}]
  }
}
```

### 论文时空投影

时空服务后台调用 `kind=oneearth.paper.projection.query.v1`。同一 `POST /message:send` 返回带有效 `contextId` 的直接 Message，数据 part 的 kind 为 `oneearth.paper.projection.result.v1`。本查询无需模型或受托任务。

| input.operation | 输入与产物 |
| --- | --- |
| `head` | 无附加参数。返回 `revision`、`generation`、`publishedCount` 和 `versionCount`。发布修订指当前目录，只有历史版本增加时仅同步代推进。 |
| `page` | 必传目标 `generation`、游标 `cursor` 和 `limit`（1–250）。沿用上页 `nextCursor`，初始为 `""`。返回带相同元数据的 `entries` 和 `nextCursor`，`null` 表示末页。传 `baseGeneration` 读取相对于本地已提交代的增量，产物会回显它。省略时读取完整一代。 |

以下为使用已保存代的请求数据 part。两个代的标识由实际 head 回执提供。

```json
{
  "kind": "oneearth.paper.projection.query.v1",
  "input": {
    "operation": "page",
    "generation": "5652ce37-defb-43c6-b9a3-bd9d42f44307",
    "baseGeneration": "1ae586e3-3787-4c94-ba24-847acf20154b",
    "cursor": "",
    "limit": 250
  }
}
```

各条目有精确 `id`、`dsKey`、标题、类型、来源、坐标、覆盖范围和时段。换版本或撤下通过相应旧 ID 的 `published:false` 表示，旧版本仍可用于明确指定的历史范围。时空服务检查分页、应用后总数和代标识，随后原子切换本地投影。目标代已变化返回 `CATALOG_GENERATION_CHANGED`，下一轮按新 head 重试。基准代超出可追溯历史返回 `CATALOG_BASE_UNAVAILABLE`，重新获取完整代。其余传输失败保留上一完整代，首次尚无完整投影时覆盖未知。

### 海纳目录分页

`kind=oneearth.haina.catalog.query.v1` 的输入为 `{"cursor":0,"limit":250}`。游标为上页返回的 `nextCursor`，`null` 表示末页。返回直接 Message，其数据 part 为 `kind=oneearth.haina.catalog.result.v1`，`value` 含发布快照时间 `synced`、条目及总数、端点和分区、下一页游标及可用性说明。运行时统一 API 保持网页原 `GET /api/haina/catalog` 的分页格式。

发现服务负责同步并发布完整目录。数据触达按同一快照加载，各次筛选复用现有投影。开放发现返回本轮命中海纳记录及实际状态，运行时用于回答和重开；旧研究仍读其原档。此契约只涉及目录及引用，原始文件沿既有获取路径。

### 指定集合的逐景查询

`kind=oneearth.scene.catalog.query.v1` 接收已知 Landsat C2 L2 或 Sentinel-2 L2A 的 `assetIds`、经纬度 `point`、起止年 `years` 和可选半开 UTC `utcWindow`。发现服务以这些原条件查询 Earth Search STAC，直接返回 `kind=oneearth.scene.catalog.result.v1`。每个已查集合在 `lookups` 保留匹配数、最多五条实际返回的影像元数据、采集时刻、云量和出处。服务不可用或来源响应异常列在 `failures`，运行时显示匹配数未知。来源确认没有匹配时，才以 `matched:0` 归档。地图覆盖、瓦片和已接入图层仍沿时空服务查询。

### 指定来源补读

在 `POST /message:send` 创建 `kind=oneearth.source.read.v1` 的新委托，提交 `input.question` 及 `input.targets` 中的 1–3 项明确来源。论文用精确内容 ID `{"kind":"paper","id":"earthnano:…"}`。网页与 PDF 用原地址和标题，可选 `discoveredBy` 为 `user` 或 `assistant`。查论文由发现服务执行。网页目标可通过语法校验，但实际读取须由运行时针对当前消息和指定 URL 签发 `runtimeWebToolGrant`，并在发现服务受理后绑定 Task。

网页目标可附 `locators`，每个目标接受 1–4 项不重复的 `{kind,value}`。支持 `section`、`table`、`figure`、`page`、`equation`，页码 `value` 使用正整数的字符串。运行时的证据决策每次定位一个获准网页身份。同一来源已实际取得时计文内定位额度，尚未取得的获准来源计新外取额度。定位不会扩大 URL 授权。工具回调会核对其 `operation.url` 与 `operation.hit.url` 都属于受权集合，定位时还要求两者是同一规范化 URL。提供定位时走原站或 PDF 路径。常规获准 URL 也可在没有 DeepSeek Fetch 时沿原站或 PDF 路径读取。[补读输入校验](../server/discovery-material-operations.ts) · [定位结构](../src/domain/source-read-locator.ts) · [取证预算](../server/research-evidence.ts) · [工具授权](../server/runtime-web-tool-store.ts)

以下是定向读取 PDF 第 2 页的委托示例。域名仅示意，须使用当前任务实际获准的 URL。运行时替换消息 ID，并填入绑定该消息及同一 URL 的实际授权。纸本专用委托可省略 `runtimeWebToolGrant`。

```json
{
  "message": {
    "messageId": "5a55e6ed-04e3-450f-a17c-836428dd17a9",
    "role": "ROLE_USER",
    "parts": [{"data": {
      "kind": "oneearth.source.read.v1",
      "input": {
        "question": "核对该报告第 2 页的观测方法。",
        "targets": [{
          "kind": "web",
          "url": "https://example.org/report.pdf",
          "title": "报告",
          "locators": [{"kind": "page", "value": "2"}]
        }],
        "deepseekFetch": false,
        "runtimeWebToolGrant": "<由运行时为本消息和该 URL 签发>"
      }
    }}]
  },
  "configuration": {"returnImmediately": true}
}
```

受理只确认已有 Task。终态成果位于保存事件中的 `sourceReadResult`，包含 `searches`、`papers` 和 `issues`，可附带具有实际读取时间的 `paperEvidence`。有定位请求时，`locatorResults` 跟随对应网页命中，按请求顺序返回 `found`、`partial`、`not_found` 或 `unsupported`，可附原文窗口。运行时分别保存新材料与旧档摘录。未取得新材料时保留实际失败。浏览器普通预览沿自己的读取入口。

### 公开网络工具的运行时执行

发现服务决定公开查找的搜索词、提供方、所选 URL、补读范围、替代和采纳。运行时按本轮渠道、工具开关及部署授权发放临时委托凭据，经内置适配层执行业务调用。运行时规划模型、发现规划模型与工具供应分别配置。DeepSeek Search 和 DeepSeek Fetch 的供应还要求相应本轮开关、部署开关及运行时有效凭据。限定海纳的委托不调用公开网络工具。指定来源补读的许可只覆盖给定 URL，不允许关键词搜索。

运行时在发出委托前建立能力记录，通过委托的内部字段 `runtimeWebToolGrant` 传递本轮临时凭据。收到有效 A2A 受理后绑定实际 Task。补查及确认续行使用本次消息自己的授权。凭据不进入规划输入、公开任务事件或研究引用。

工具入口与工作台共用端口，常驻地址为 `127.0.0.1:5474` 上的 `POST /internal/discovery-web-tool/v1`。局域网或浏览器请求该路径返回 404。发现服务使用 `Authorization: Bearer <runtimeWebToolGrant>`，发送 JSON `{taskId,messageId,callId,operation}`。例如一笔关键词查找的 `operation` 是 `{"kind":"search","provider":"Bing","query":"NASA IMERG Final Run"}`。取回正文时，`operation` 使用 `kind:"fetch"`，带提供方、所选 `url` 和来源标识 `hit`。原生搜索使用 `kind:"native-search"` 和 `queries`，仅凭运行时已授权的原生执行器配置运行。

运行时先检查授权仍有效、父研究仍在运行，再按相同授权和原 `callId`、原输入读回结果。排队和回执由运行时 API 自己的执行队列管理。发现服务在 202、425 或部分网络中断时，使用同一授权和逐字相同的请求重试。已保存的调用复用原回执。执行中断且结果未知时，恢复同一调用可在授权有效期间读回失败回执，避免重复调用上游。

| 回调 HTTP 状态 | 含义 |
| --- | --- |
| 202 | 已排队或正在执行，返回 `{"state":"pending"}`。 |
| 200 | 终态回执。业务成功为 `{state:"complete",value}`，业务失败为 `{state:"failed",error}`。 |
| 400 | 调用身份或输入格式无效。 |
| 403 | 授权无效、无权、已撤销、到期或父研究已结束。既有回执也适用该授权校验。 |
| 409 | 同一 `callId` 已用于不同授权或输入。 |
| 425 | 已有有效授权，但尚未绑定发现 Task。 |
| 429 | 本轮调用预算或执行队列已满。 |
| 503 | 运行时工具通道暂不可用。 |

取消、到期和委托结束时停止可取消的工作。回执失败是业务结果，调用方仍须检查 200 响应内的 `state`。[回调路由](../server/runtime-web-tool-router.ts) · [运行时回执与授权](../server/runtime-web-tool-store.ts) · [发现调用与重试](../server/discovery-web-tools.ts)

### 最小委托示例

向隔离发现端发送 `POST /message:send`，请求头为 `A2A-Version: 1.0` 和 `Content-Type: application/a2a+json`。以下示例关闭该轮 DeepSeek Search/Fetch，模型选择来自发现进程配置。

```json
{
  "message": {
    "messageId": "0d11c988-cf74-4541-81f0-e7d1f4b0484c",
    "role": "ROLE_USER",
    "parts": [
      {
        "data": {
          "kind": "oneearth.discovery.request.v1",
          "input": {
            "query": "查找可用于湿地冻融研究的公开观测目录",
            "history": [],
            "references": [],
            "currentDatasets": [],
            "scope": {
              "filters": {"need": -1, "type": "", "source": "", "place": "", "period": null, "depth": null, "maxDem": null},
              "selection": null,
              "caseId": null,
              "citation": null
            },
            "deepseekTools": {"search": false, "fetch": false}
          }
        }
      }
    ]
  },
  "configuration": {"returnImmediately": true}
}
```

受理时返回 HTTP 200 和 `{task}`。订阅返回的首帧也用 `{task}`，后续产物更新使用相同 Task ID。已归档的初始事件示例如下。

```json
{
  "task": {
    "id": "b71c2c82-ff57-4122-8b71-3d6f777e91d2",
    "contextId": "b71c2c82-ff57-4122-8b71-3d6f777e91d2",
    "status": {"state": "TASK_STATE_SUBMITTED", "timestamp": "2026-11-22T07:10:16.635Z"},
    "artifacts": [{
      "artifactId": "b71c2c82-ff57-4122-8b71-3d6f777e91d2:1",
      "parts": [{"data": {
        "kind": "oneearth.discovery.event.v1",
        "event": {"taskId": "b71c2c82-ff57-4122-8b71-3d6f777e91d2", "seq": 1, "at": 1795331416635, "queued": true, "queuedAt": 1795331416635}
      }}]
    }]
  }
}
```

缺少发现模型配置时，新的开放发现委托返回 HTTP 503，正文例如 `{"error":{"code":503,"status":"UNAVAILABLE","message":"ONEEARTH_DISCOVERY_CHAT_MODEL 未配置。"}}`。确定性目录查询与精确补读按各自来源的可用性处理。已受理 Task 的读取、幂等、确认等待和终态竞态示例见[隔离 PostgreSQL 契约测试](../server/discovery-a2a.test.ts)及[客户端回归](../server/discovery-a2a-client.test.ts)。

受托 Task 的提交以 `messageId` 和业务指纹去重。相同身份和输入复用原 Task，复用消息 ID 却改变业务输入会返回 HTTP 409 `ALREADY_EXISTS`。发现服务另有内部作业 ID，用于实际执行。同一 Task 续答以新消息登记新作业，同时保留原 Task 和产物序列。直接 Message 查询每次执行查询逻辑，未纳入这套 Task 去重。显式论文 `search` 可更新目录，运行时在其响应不确定时停止自动重试。[直接查询与受托任务](../server/discovery-a2a-server.ts) · [论文查询重试](../server/discovery-a2a-client.ts)

浏览器刷新按工作台自己的运行 ID 读取状态。运行时进程重启时，持久研究通过已存步骤与发现受理身份恢复原 Task 和材料。运行中断且缺少持久检查点时，原任务以 `worker_interrupted` 结束。[工作台断线恢复](工作台-AG-UI.md#原任务恢复取消和追问) · [后台恢复](../server/postgres-task-store.ts)

发现结果需要研究者补充或确认时，对外状态为 `TASK_STATE_INPUT_REQUIRED`。明确的确认使用原 Task ID 和新的稳定消息 ID，并校验原提议、已确认范围和工具许可。服务将同一 Task 指向新的内部作业，重放保留旧确认记录，运行时通过事件水位读取本次进展。已经交付的受托任务保持完成状态，后续新缺口通过新消息创建有父关联的委托。一次受托任务的结束与整项研究的进度分别记录。

发现服务发出的普通澄清可以在原消息上选择「回复此问题」，在输入框补充或取消关联。运行时核对同会话的父记录和授权范围，从已保存的受理事件取 Task ID 和等待水位。A2A 续行携带 `continuedFrom` 与 `clarificationReply: {text, afterSeq}`，发现方对照当前等待阶段，从原受理请求恢复目的、范围和权限。旧水位或未经确认的目标变更无法推进原委托。普通下一句和运行时自行发出的澄清沿用各自的聊天路径。

隔离候选支持同一原消息上的人工追问弹框。有效发现计划保留原澄清文本，并可在结果中附 `clarificationOptions`（两至四个由服务端赋 ID 的选项，空数组表示只需输入文字）。运行时确认真实 Task 处于 `TASK_STATE_INPUT_REQUIRED` 后，才把这类问题投影成 `clarificationPrompt.kind = "research"`。旧记录和不带选项元数据的旧提供方仍可从原消息手动回复。观测执行器回执与其他机器等待不投影为人工弹框。

正式工作台按[原生 AG-UI 追问续答](工作台-AG-UI.md#原任务恢复取消和追问)提交同线程的新运行，绑定原问题及 `resume.interruptId`。运行时核实同会话归档和对应选项，再把实际文字续接到 A2A。A2A 请求为 `continuedFrom` 与 `clarificationReply: {text, afterSeq}`。本地校验发现答复不完整时，可在新的本地回复消息中重新提出问题，后续仍指向已经保存的原 Task 和等待水位。若用户改了原研究目标，沿用原有问题确认流程。

### 只读观测核对与机器续接

Mac mini 隔离候选 `287b8dd` 接受显式能力输入 `POST /api/tasks` 的 `input.observationCheck`。普通研究问答继续使用原委托。观测核对需要运行时的授权注册表，按文件身份、指定版本和变量授权。运行时 API 在首次合法提交时从操作者注册表取得 SHA-256，和研究请求及执行检查点在同一事务固定。相同 UUID 和相同请求复用原检查点。浏览器无法指定该摘要。执行器收到发现需求后只接受已固定且仍获准的 SHA-256。登记改指或撤权时明确未启动，归档保留原身份。通过校验后只有执行器的读子进程打开文件。文件以 `oneearth.observations.v1` 存放变量单位和含 `at`、`value` 的 UTC 日期记录。核对结论仅覆盖单位和非空记录的起止边界。

运行时向发现方发送 `POST /message:send`，使用 `A2A-Version: 1.0`、`Content-Type: application/a2a+json` 和配置在服务侧的 bearer 凭据。下面是脱敏的请求体，`researchTaskId` 属于运行时，发现方签发自己的 Task。

```json
{
  "message": {
    "messageId": "bcea1854-ec8a-48d5-afe7-e2e274bf459b",
    "role": "ROLE_USER",
    "parts": [{
      "data": {
        "kind": "oneearth.skill.observation-check.request.v1",
        "input": {
          "researchTaskId": "6c60c94f-0869-4646-bf7b-78639e9273fa",
          "check": {
            "skill": "oneearth.observation-check@1",
            "artifactId": "mac-mini-observation",
            "version": "controlled-a",
            "variable": "temperature",
            "unit": "K",
            "start": "2020-12-28",
            "end": "2021-01-05"
          }
        }
      }
    }]
  },
  "configuration": { "returnImmediately": true }
}
```

受理返回 `{task}`。发现方的首个作业保存 `skillDemand` 及事件序号，归还作业名额。原 Task 保持 `TASK_STATE_WORKING`，经授权的 `GET /tasks/{id}` 返回任务和已归档产物。运行时接回需求后核对本研究身份、版本、能力和等待序号。它通过同一接口发送 `oneearth.skill.observation-check.result.v1`，带新 `messageId`、原 `message.taskId` 和 `message.contextId`，业务输入为 `{requestId, afterSeq, result}`。发现方在同一事务核对等待点并登记后续作业。重复的同编号同内容回执复用原任务，冲突内容、过期序号、取消后才到达的回执均会拒绝。人工确认仍使用现有的 `TASK_STATE_INPUT_REQUIRED` 语义。

以下为来自 Task 归档的能力请求字段示例。事件中的 `seq` 用作回送时的 `afterSeq`。

```json
{
  "kind": "oneearth.discovery.event.v1",
  "event": {
    "seq": 88,
    "skillDemand": {
      "requestId": "aa252bb5-7c23-4379-b931-42c6bb103766",
      "researchTaskId": "6c60c94f-0869-4646-bf7b-78639e9273fa",
      "check": {
        "skill": "oneearth.observation-check@1",
        "artifactId": "mac-mini-observation",
        "version": "controlled-a",
        "variable": "temperature",
        "unit": "K",
        "start": "2020-12-28",
        "end": "2021-01-05"
      }
    }
  }
}
```

启用时，运行时 API、worker 和发现服务从各自的部署环境取得同一 `ONEEARTH_SKILL_SERVICE_TOKEN`。注册表路径 `ONEEARTH_SKILL_REGISTRY` 只用于运行时 API 和 worker。配置中设置 `ONEEARTH_SKILL_MODE=suspend` 使用可让出的步骤。`retained` 启用保留父名额的路径，并按 `ONEEARTH_SKILL_CAPACITY`、`ONEEARTH_SKILL_CHILD_CAPACITY` 分配本地执行资源。首例是登记的固定只读方法，回执不包含本机路径、凭据或原始文件下载链接。执行器不在该委托中接受自由命令或供应商配置。

### 普通 Chat 的观测资料

工作台从同源 `GET /api/observation-materials` 获取获准材料及来源绑定。在已有研究的来源与依据面板中，只有来源网址匹配时才显示对应的观测文件卡。研究者可主动选入该版本，再按正常提问流程发送问题。Chat 输入框的全局观测资料下拉已移除。运行时依据操作者登记的 `modelVisible: true` 发布可供对话使用的版本，普通材料项只含文件身份、版本、显示名和变量名。附着范围只记录 `{kind:"observation",artifactId,version,title}`，材料与摘要由运行时从可信登记读取。[界面变更验收](../evidence/product/ACCEPTANCE.md#mac-mini-chat-观测资料入口静态发布)

运行时用受权 A2A `oneearth.observation.research.request.v1` 联系发现方。输入为 `{researchTaskId,question,materials,evidence}`。新会话首次提问时 `evidence` 为空。后续从同一会话的可信父任务取得仍获准的真实依据。运行时在受理检查点固定资料的 SHA-256。发现模型的规划输入仅含获准的资料身份、变量名、问题和已得事实。初始委托和复用规划均省去单列的授权摘要字段。通过验证的执行回执仍按原契约提交 SHA-256。

发现模型可选择请求读取、引用已得依据、澄清，或交回通用问答。读取需求引用一个获准资料版本和变量。报告实际单位、非空记录数及首尾日期时，需求使用 `purpose: "describe"`。对照已给标准时沿用明确的单位和起止日。两种需求使用相同只读执行链。运行时复核冻结的摘要与当前授权，并将结果交回同一个发现 Task。发现确认实际可用的证据，运行时据此保存可打开的版本引用。

已得依据支持本轮时，发现模型可以在一次规划中选择复用，运行时回引归档中的文件版本，文件读取次数为零。文件中的变量全部为空时，已读单位和零非空条数仍可复用。后续撤掉模型使用许可时，原回答及其依据仍可重开，新提问按当前授权使用可用材料。显式观测核对通过同源 `POST /api/ag-ui` 提交，核对字段为 `forwardedProps.oneearth.submission.observationCheck`。沿用上文的核对参数及版本权限。上文 `POST /api/tasks` 示例用于了解历史隔离候选。选择来源卡时先加入待发送的提问范围，实际取证随用户提交的研究任务执行。

### 从已保存来源读取已登记的 NetCDF 文件

操作者可给获准文件版本登记 `source`，包含发布方下载入口 `dataUrl`、发布目录 `catalogUrl`、发布方版本说明 `versionLabel` 和已验证的关联网址 `referenceUrls`。运行时在 `GET /api/observation-materials` 的可选 `sourceBindings` 中发布这些字段及文件身份。工作台以完整来源网址匹配当时可选的精确文件版本。研究者主动选择后，仍提交原有观测附件形状。旧研究里的元数据链接和保存摘录保留其原有身份。

以下响应示例中的两个数组以 `artifactId` 和 `version` 配对。撤权后，该条目及绑定从清单移除。

```json
{
  "materials": [{"artifactId":"coastal-station","version":"release-1","title":"海岸观测","variables":["TEMP"]}],
  "sourceBindings": [{
    "artifactId":"coastal-station",
    "version":"release-1",
    "dataUrl":"https://data.example.org/files/coastal.nc",
    "catalogUrl":"https://data.example.org/catalog/coastal",
    "versionLabel":"2026-10-27T02:00:56Z",
    "referenceUrls":["https://data.example.org/metadata/coastal"]
  }]
}
```

执行子进程可直接读取经典和 64 位偏移 NetCDF 的单值时间序列。文件必须在受权注册表中，实际完整文件的 SHA-256 须与受理版本一致。结果可带 `netcdf`，保存所查变量、单位、时间轴、首末原始时间值与 UTC 时刻、缺测标记、声明范围和计数口径。在同一文件中登记的其他变量可附上头部元数据。归档的 `artifactSource` 记录本次采用的发布入口及版本。发现规划使用公开版本 ID，初始请求省去单独的授权摘要字段、原文件路径和归档来源对象。若登记者选用内容寻址标识，公开版本 ID 本身可包含文件 SHA-256。已取得读据仍经原 Task 交回。归档详情可直接显示本次保存的依据，发布方链接可能提供更新版本。

当前直接执行上限为 256 MiB 和每变量 200 万样本。读取器支持一个时间维和其余长度均为一的维度，以及支持范围内的公历 CF 时间轴。遇到超限文件或未支持的布局、历法和 NetCDF 格式时，返回可辨识的失败读据状态。

## 部署与兼容

发现进程单独读取并校验 `ONEEARTH_DISCOVERY_CHAT_MODEL`，启动器只向发现角色传递此选择。已有授权的原生执行器模型或 DeepSeek 模型可以按部署配置启用，部署使用自己的凭据来源。缺少有效配置时，新的开放发现委托返回 `UNAVAILABLE`。已保存任务、确定性论文查询及可用来源的精确补读继续各走原路径。运行时模型和执行器仍取其原有授权配置。参见[部署与恢复手册](部署与恢复.md)。

旧调用方可以继续使用 `/v1/discoveries` 的 HTTP+NDJSON 接口及发现端旧纸本路由。发现服务配置了有效的本地模型时，v1 使用该模型。未设置独立模型时，v1 沿用其请求中的合法配置，新 A2A 开放发现返回 503。连接只提供旧接口的发现服务时，`ONEEARTH_DISCOVERY_PROTOCOL=v1` 仅用于开放发现。公开网络工具需要实际运行时委托授权，缺少授权或工具通道不可用时保留渠道失败与已得材料。当前论文查询和精确补读需要提供对应 A2A 操作的发现服务。研究记录保持原本的任务 ID 和引用。

A2A Task 的受理关系、消息去重和作业映射随发现 PostgreSQL 库保存，由停写产品备份包含。内部计划由发现服务产生，归档产物沿用的结果结构仍包含历史计划字段。

此批覆盖同一 Mac mini 上的服务间委托与已列操作。开放发现的归档产物仍包含旧内部计划结构。论文目录的发布状态与稳定版本由发现 PostgreSQL 保管，时空消费其最小版本化投影并保存自己的本地索引。运行时经协议读取当前论文或使用自己的历史材料。机构身份、项目权限和跨主机授权另待验证。List Tasks 和推送通知尚未启用。
