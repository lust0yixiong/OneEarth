# 运行时与数据发现服务

适用于 Mac mini 上的 OneEarth A2A 候选。网页任务 API 及同源入口维持现有用法。运行时持有研究记录、轮次、引用和研究者确认，数据发现服务持有一次受托任务及渠道检索过程。

## 委托与取回材料

内部发现接口绑定回环地址。使用 A2A 1.0 的 HTTP+JSON 绑定，操作请求带 `A2A-Version: 1.0`，JSON 请求正文使用 `application/a2a+json`。协议说明以 [A2A v1.0.1 正式规范](https://a2a-protocol.org/v1.0.1/specification/) 为准。

| 操作 | 在 OneEarth 中的用途 |
| --- | --- |
| `GET /.well-known/agent-card.json` | 声明数据发现能力和流式订阅 |
| `POST /message:send` | 确定性的论文查询、论文时空投影、海纳目录与指定条件逐景查询响应 `{message}`。开放发现和精确补读响应 `{task}`，运行时显式设置 `configuration.returnImmediately=true`，随后按已受理的 Task ID 取进展 |
| `POST /message:stream` | 接收委托并打开该任务的 SSE |
| `GET /tasks/{id}` | 读取已保存的受托任务状态与材料 |
| `POST /tasks/{id}:subscribe` | 首帧给出 Task 快照，随后推送按序保存的进展。任务快速结束或连接断开时按同一 ID 取回快照 |
| `POST /tasks/{id}:cancel` | 取消已验证受理的委托。服务不可达时保留取消未确认的诊断 |

直接 Message 带服务端生成的 `contextId` 和 `messageId`。这种查询使用独立响应上下文，不生成 `taskId` 或受托任务。运行时接受提供方的非空上下文标识。参见 [A2A Message 规范](https://a2a-protocol.org/v1.0.1/specification/#414-message)。

`message.parts` 携带一个带 `kind=oneearth.discovery.request.v1` 的数据 part。它描述本次目的、证据缺口、已确认范围、引用或已取得材料，以及本轮 DeepSeek Search 和 DeepSeek Fetch 两个开关。发现服务用自己的配置选择规划模型并管理查找计划。公开网络的实际执行经过下述运行时适配层。既有 Bing、DuckDuckGo 和 DataCite 可发公开查询。机构和项目权限、具体材料能否外发由各自权限边界约束。

### 发现渠道范围

发现服务从当前用户原问题、已确认问题和可信续查上下文解析来源范围，再启动相应渠道。问「海纳内部有哪些这类数据」即限定海纳。先前引用的论文或网页可帮助理解对象，不能授权新一次查询这些渠道。网页继续提交原问题和既有上下文字段。

| 用户表达 | 查找行为 |
| --- | --- |
| 限定一个或多个渠道 | 只执行所限定的渠道。全部无匹配时报告该范围内的结果，故障时报告还不能确认。扩大范围取决于用户的新指示。 |
| 优先某渠道 | 先完成优先渠道。有可用候选时先用该渠道；没有取得候选时，可按用户已给的范围继续查找。 |
| 指定顺序及后备条件 | 先等优先渠道的结果。「海纳找不到再看论文」在海纳完成且无匹配后执行论文。海纳有结果或查询失败时，论文和公开网络均不执行。 |
| 未限定渠道的开放查找 | 沿现有策略查询有有效参数的各路，保留每路的独立结果。 |

计划产物可包含 `sourcePolicy`，用 `restricted` 或 `preferred` 及有序的 `sources` 记录来源策略。只在前一渠道确认零命中后启用下一渠道时，计划包含 `fallback: "no_match"`。来源标识为 `haina`、`paper`、`web`、`constellation`。星座接收库查询由运行时负责。同一研究轮的补查继承归档中的范围和条件结果。父任务已在海纳找到资料时，子任务未查到该资料的某个字段不会打开原先未启用的论文渠道。执行产物 `sourceStatus` 中，`done` 且 `count: 0` 表示完成但未命中，`failed` 表示失败，`not_requested` 的渠道没有启动工具记录。

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

`kind=oneearth.source.read.v1` 发送 `question` 和最多三项明确来源。论文用精确内容 ID `{"kind":"paper","id":"earthnano:…"}`，公开网页和 PDF 用原地址和标题 `{"kind":"web","url":"https://example.org/report.pdf","title":"报告"}`。发现服务查询论文依据；公开页和 PDF 由运行时适配层按原地址读取，遵守现有公开 URL 及重定向约束。关闭 DeepSeek Fetch 供应时，获准的指定地址仍可按原站或 PDF 路径读取。

请求示例带 `configuration.returnImmediately=true`。确认受理后用 Task ID 获取快照、SSE 和取消。已保存的终态成果位于受托事件的 `sourceReadResult`，含取得的 `searches`、`papers`、`issues`，可包含带实际读取时间的 `paperEvidence`。新材料与旧档摘录由运行时分别保存。精确补读未取得新材料时保留真实失败，普通打开原站或传输 PDF 文件不产生这类研究任务。

### 公开网络工具的运行时执行

发现服务决定公开查找的搜索词、提供方、所选 URL、补读范围、替代和采纳。运行时按本轮渠道、工具开关及部署授权发放临时委托凭据，经内置适配层执行业务调用。运行时规划模型、发现规划模型与工具供应分别配置。DeepSeek Search 和 DeepSeek Fetch 的供应还要求相应本轮开关、部署开关及运行时有效凭据。限定海纳的委托不调用公开网络工具。指定来源补读的许可只覆盖给定 URL，不允许关键词搜索。

运行时在发出委托前建立能力记录，通过委托的内部字段 `runtimeWebToolGrant` 传递本轮临时凭据。收到有效 A2A 受理后绑定实际 Task。补查及确认续行使用本次消息自己的授权。凭据不进入规划输入、公开任务事件或研究引用。

工具入口为运行时回环上的 `POST /internal/discovery-web-tool/v1`。发现服务使用 `Authorization: Bearer <runtimeWebToolGrant>`，发送 JSON `{taskId,messageId,callId,operation}`。例如一笔关键词查找的 `operation` 是 `{"kind":"search","provider":"Bing","query":"NASA IMERG Final Run"}`。取回正文时，`operation` 使用 `kind:"fetch"`，带提供方、所选 `url` 和来源标识 `hit`。原生搜索使用 `kind:"native-search"` 和 `queries`，仅凭运行时已授权的原生执行器配置运行。

受理绑定之前返回 425，发现侧可原样重送。受理后排队或执行中返回 HTTP 202 和 `{"state":"pending"}`。原 `callId` 与相同输入可查询已保存的 HTTP 200 回执，成功为 `{state:"complete",value}`，失败为 `{state:"failed",error}`。越权返回 403，重用编号提交不同输入返回 409。运行时 API 侧的有界执行队列与等待发现的研究 worker 分开推进。取消、到期和委托结束时停止可取消的工作。执行中断且结果未知会留下明确失败回执；再次查询原执行不重新请求上游。网页入口不提供此路径。

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

运行时消息的 `messageId` 用于同一委托提交的幂等。发现服务另行生成并保存外部 Task ID，返回后由运行时写入研究事件；服务进程用内部作业执行实际工作。相同的消息及业务输入只登记一次，改动内容后重用消息 ID 会失败。稳定的产物 ID 和保存的事件序号用于重放去重。浏览器刷新接回运行时的同一个任务，发现客户端断线则以已经确认受理的 A2A Task 恢复材料。运行时进程重启仍沿用已归档材料及 `worker_interrupted` 语义。

发现结果需要研究者补充或确认时，对外状态为 `TASK_STATE_INPUT_REQUIRED`。明确的确认使用原 Task ID 和新的稳定消息 ID，并校验原提议、已确认范围和工具许可。服务将同一 Task 指向新的内部作业，重放保留旧确认记录，运行时通过事件水位读取本次进展。已经交付的受托任务保持完成状态，后续新缺口通过新消息创建有父关联的委托。一次受托任务的结束与整项研究的进度分别记录。

发现服务发出的普通澄清可以在原消息上选择「回复此问题」，在输入框补充或取消关联。运行时核对同会话的父记录和授权范围，从已保存的受理事件取 Task ID 和等待水位。A2A 续行携带 `continuedFrom` 与 `clarificationReply: {text, afterSeq}`，发现方对照当前等待阶段，从原受理请求恢复目的、范围和权限。旧水位或未经确认的目标变更无法推进原委托。普通下一句和运行时自行发出的澄清沿用各自的聊天路径。

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

工作台从同源 `GET /api/observation-materials` 显示可供对话使用的资料。运行时从操作者登记中挑选显式标记 `modelVisible: true` 的条目，列表只含文件身份、版本、显示名和变量名。工作台按正常提问流程发送问题。附着范围只记录 `{kind:"observation",artifactId,version,title}`，实际材料信息和摘要由运行时读取可信登记。

运行时用受权 A2A `oneearth.observation.research.request.v1` 联系发现方。输入为 `{researchTaskId,question,materials,evidence}`。新会话首次提问时 `evidence` 为空。后续从同一会话的可信父任务取得仍获准的真实依据。运行时在受理检查点固定资料的 SHA-256。发现模型的规划输入仅含获准的资料身份、变量名、问题和已得事实。初始委托和复用规划均省去单列的授权摘要字段。通过验证的执行回执仍按原契约提交 SHA-256。

发现模型可选择请求读取、引用已得依据、澄清，或交回通用问答。读取需求引用一个获准资料版本和变量。报告实际单位、非空记录数及首尾日期时，需求使用 `purpose: "describe"`。对照已给标准时沿用明确的单位和起止日。两种需求使用相同只读执行链。运行时复核冻结的摘要与当前授权，并将结果交回同一个发现 Task。发现确认实际可用的证据，运行时据此保存可打开的版本引用。

已得依据支持本轮时，发现模型可以在一次规划中选择复用，运行时回引归档中的文件版本，文件读取次数为零。文件中的变量全部为空时，已读单位和零非空条数仍可复用。后续撤掉模型使用许可时，原回答及其依据仍可重开，新提问按当前授权使用可用材料。显式 `input.observationCheck` 继续沿用原请求、执行及权限语义。观测资料浏览等待用户主动发出问题。

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

发现进程单独读取并校验 `ONEEARTH_DISCOVERY_CHAT_MODEL`，启动器只向发现角色传递此选择。已有授权的原生执行器模型或 DeepSeek 模型可以按部署配置启用，部署使用自己的凭据来源。缺少有效配置时，新的开放发现委托返回 `UNAVAILABLE`。已保存任务、确定性论文查询及可用来源的精确补读继续各走原路径。运行时模型和执行器仍取其原有授权配置。参见[部署说明](../README.md)。

旧调用方可以继续使用 `/v1/discoveries` 的 HTTP+NDJSON 接口及发现端旧纸本路由。发现服务配置了有效的本地模型时，v1 使用该模型。未设置独立模型时，v1 沿用其请求中的合法配置，新 A2A 开放发现返回 503。连接只提供旧接口的发现服务时，`ONEEARTH_DISCOVERY_PROTOCOL=v1` 仅用于开放发现。公开网络工具需要实际运行时委托授权，缺少授权或工具通道不可用时保留渠道失败与已得材料。当前论文查询和精确补读需要提供对应 A2A 操作的发现服务。研究记录保持原本的任务 ID 和引用。

A2A Task 的受理关系、消息去重和作业映射随发现 PostgreSQL 库保存，由停写产品备份包含。内部计划由发现服务产生，归档产物沿用的结果结构仍包含历史计划字段。

此批覆盖同一 Mac mini 上的服务间委托与已列操作。开放发现的归档产物仍包含旧内部计划结构。论文目录的发布状态与稳定版本由发现 PostgreSQL 保管，时空消费其最小版本化投影并保存自己的本地索引。运行时经协议读取当前论文或使用自己的历史材料。机构身份、项目权限和跨主机授权另待验证。List Tasks 和推送通知尚未启用。
