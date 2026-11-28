# 工作台 AG-UI 接口契约

工作台向同源运行时提交 AG-UI 1.0 请求，受理后在同一个 HTTP 响应接收 SSE。网页使用 `@ag-ui/client` 1.0.5 的 `HttpAgent`，命令行可直接调用同一入口。工作台访问仍受部署的 Host、Origin 和局域网网段校验。以下示例适用于获准访问的实例，首次提交会实际执行一轮模型。[运行时入口](../server/ag-ui-workbench.ts) · [AG-UI HTTP 绑定](https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse) · [访问范围](部署与恢复.md#原生-ag-ui-发布与回退)

## 提交一轮 Chat

示例需要 `curl`、`jq`、Node.js，以及实例已经配置的 DeepSeek Flash。先在同一终端执行以下命令。将 `base` 换成要联调的工作台地址。

```sh
base=http://127.0.0.1:5474
new_id() { node -p 'require("node:crypto").randomUUID()'; }
thread_id=$(new_id)
run_id=$(new_id)
turn_id=$(new_id)

request=$(jq -n --arg thread "$thread_id" --arg run "$run_id" --arg turn "$turn_id" '
{
  protocolVersion: "1.0",
  threadId: $thread,
  runId: $run,
  messages: [{id: $turn, role: "user", content: "用一句话解释地图比例尺。"}],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {
    oneearth: {
      version: 1,
      submission: {
        context: {
          caseId: null,
          filters: {need: -1, type: "", source: "", place: "", period: null, depth: null, maxDem: null},
          gridSystem: "h3",
          layer: "all",
          camera: {center: [0, 0], zoom: 1, reason: "接口示例"},
          citation: null,
          selection: null
        },
        config: {executor: "codex", provider: "deepseek", model: "deepseek-flash"}
      }
    }
  }
}')

post_run() {
  curl -sS -i -N -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    --data-binary "$1" "$base/api/ag-ui"
}
post_run "$request"
```

- `threadId` 对应会话。每次新运行用新的 `runId` 和末条用户消息 ID，分别对应任务和用户轮次。三者均使用小写 UUID。
- 用户问题来自最后一条 `role: "user"` 消息，最长 4,000 字符。业务上下文与模型配置放在 `forwardedProps.oneearth.submission`。先前的对话由服务端从同会话的持久记录读取。
- 提交 JSON 请求体上限为 256 KiB。普通 Chat 可用空 `tools`。需要地图动作时使用[工作台工具声明](../src/domain/native-workspace-tool.ts)和[地图回执契约](架构与接口现状.md#原生-ag-ui)。[请求解析](../server/ag-ui-input.ts) · [业务校验](../server/runtime-input.ts) · [请求体限制](../server/runtime-api-service.ts)

## 读取 SSE

受理后返回 `200`，响应类型为 `text/event-stream; charset=utf-8`。每条业务帧以 `data: ` 开头，后接一个 JSON 事件对象和一个空行。空闲时可能收到 `: keep-alive` 注释。以下示例保留普通答复的关键字段，实际分段及附加字段由本轮结果决定。

```text
data: {"type":"RUN_STARTED","threadId":"ebd75d0c-0e40-45e9-93bc-1864defb33d0","runId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","protocolVersion":"1.0"}

data: {"type":"TEXT_MESSAGE_START","messageId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","delta":"地图比例尺表示"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","delta":"图上距离与实际距离的比例。"}

data: {"type":"TEXT_MESSAGE_END","messageId":"a6de3ccc-5532-43ca-a794-d62f99749cf5"}

data: {"type":"RUN_FINISHED","threadId":"ebd75d0c-0e40-45e9-93bc-1864defb33d0","runId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","result":{"oneearth":{"version":1,"messageId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","response":{"message":"地图比例尺表示图上距离与实际距离的比例。"}}}}

```

先用 `RUN_STARTED` 绑定请求身份，再按同一 `messageId` 拼接正文 `delta`。正常完成时，`TEXT_MESSAGE_END` 闭合正文，`RUN_FINISHED.result.oneearth.response.message` 给出同字终稿。一部分进度和错误事件没有 `runId`，从已绑定的连接归属到原运行。部分模型和执行路径会在终结前一次性发正文。普通成功可省略 `outcome`。`cancelled`、`interrupt`，以及带待办地图工具的 `success` 以实际 `outcome` 区分。

研究运行还可收到 `STEP_STARTED` / `STEP_FINISHED`，以及如下 `STATE_SNAPSHOT`。只接受同一运行、更新的 `revision`。研究动作、交付质量与正文有各自字段。收到正常业务终态后，仍需查看 `response.answerDelivery` 的 `partial` 或 `unavailable`，以及终稿所附的来源引用。

```text
data: {"type":"STATE_SNAPSHOT","snapshot":{"oneearth":{"researchProgress":{"version":1,"runId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","revision":2,"actions":[{"id":"source-paper-1","order":1,"area":"literature","status":"running","topic":"地质填图"}]}}}}

```

[公开事件与终态写入](../server/ag-ui-persistence.ts) · [研究进度结构](../src/domain/native-agui-research-progress.ts) · [答复交付和出处](架构与接口现状.md#研究答复输入与证据降级)

## 原任务恢复、取消和追问

SSE 在收到终态之前断开时，按原 ID 读取状态。状态为 `queued` 或 `running` 时可继续查询。终态出现后读取原档，并核对 `id`、`conversationId`、`turnId`。归档只有在存在可交付的记录时才返回 200，失败或取消也可能只有状态而无归档。状态和归档都可能有顶层 `researchProgress`。断流或退出 `curl` 只结束当前连接，恢复流程使用 GET。明确取消才发送 DELETE，可从另一个终端执行，令 `base` 和 `run_id` 指向原运行。

```sh
curl -sS -i "$base/api/tasks/$run_id"
curl -sS -i "$base/api/tasks/$run_id/record"

# 仅在需要停止该运行时执行
curl -sS -i -X DELETE "$base/api/tasks/$run_id"
```

普通文字追问会以 `RUN_FINISHED.outcome.type: "interrupt"` 返回。下面的命令用于原卡 `responseSchema` 接受文字时。示例沿用上面的请求对象和会话，`run_id` 应为实际发出原追问的运行 ID。

```sh
interrupt_id=$run_id
answer='只看 2020 年至 2023 年。'
next_run=$(new_id)
next_turn=$(new_id)
resume_request=$(printf '%s' "$request" | jq --arg parent "$interrupt_id" \
  --arg next "$next_run" --arg turn "$next_turn" --arg text "$answer" '
  .runId = $next |
  .messages = [{id: $turn, role: "user", content: $text}] |
  .forwardedProps.oneearth.submission.previousTaskId = $parent |
  .resume = [{interruptId: $parent, status: "resolved", payload: {text: $text}}]
')
post_run "$resume_request"
```

- `previousTaskId` 与 `resume[0].interruptId` 都引用持久原卡。选项答复用原卡的 `optionId`，末条用户消息写实际选项标签。卡允许选项加补充时，消息写实际标签、换行、补充文字。普通确认类卡的选项与文字需按其 `responseSchema` 选择。
- 问题确认使用 `payload.choice` 的 `original`、`proposed` 或 `edited`。只有 `edited` 需要 `dataQuestion`，此类续答的末条用户消息仍是原卡的原问题。
- 明确放弃用新运行、同样的原卡绑定和 `status: "cancelled"`，省略 `payload`。续答仍需带实际末条用户消息。`parentRunId` 在此入口返回 422。地图工具有待办结果时，按[地图回执契约](架构与接口现状.md#原生-ag-ui)随显式新轮提交已存结果。[追问绑定](../server/ag-ui-interrupt.ts) · [任务状态路由](../server/task-store.ts)

## HTTP 与流内错误

| 状态或事件 | 示例或触发条件 | 调用方处理 |
| --- | --- | --- |
| HTTP 400 | 非法 JSON、请求过大、字段不合规或无效任务编号 | 核对 `error` 及请求体。 |
| HTTP 403 | 访问的 Host、Origin 或局域网来源未获准 | 改用实例配置的访问地址。 |
| HTTP 404 | 查不到原生追问、任务或可读取的现存归档 | 对照原 ID。运行中归档未生成时先查状态。 |
| HTTP 406 / 415 | `Accept` 不接受 SSE / 提交媒体类型非 JSON | 用示例中的两个请求头。 |
| HTTP 409 · `RUN_ALREADY_ACCEPTED` | 同一运行 ID 和同一请求，带 `Location: /api/tasks/<runId>` | GET 该运行的状态与归档。 |
| HTTP 409 · `RUN_ID_CONFLICT` | 同一运行 ID 对应不同提交，同样带原任务 `Location` | 原 ID 继续属于原请求。明确发起另一轮才分配新 ID。 |
| HTTP 409 · `WORKSPACE_TOOL_RESULTS_REQUIRED` | 当前会话的待办地图结果缺失或已变化，响应带 `pendingToolCallIds` | 读取当前待办与原档，按实际已保存结果准备下一次明确提交。 |
| HTTP 409 · 其他冲突 | 追问已被领取、续答水位失效或取消时任务已终结 | 读取原卡或原运行的真实状态。DELETE 的 409 为文本状态响应。 |
| HTTP 422 | 不支持的协议主版本、`parentRunId` 或工具声明 | 使用 1.0 和已登记的工作台能力。 |
| HTTP 429 | 前台容量不足，`Retry-After: 2` | 等待后再发起明确提交。 |
| HTTP 503 | 服务停止受理或无法持久受理 | 若接收结果不确定，先按原 ID 查状态。 |
| HTTP 204（DELETE） | 原任务取消事务成功，响应无正文 | 同流可用 `RUN_FINISHED.outcome.type: "cancelled"` 确认。晚到的远端停止回执从状态另查。 |
| SSE `RUN_ERROR` | 已受理运行遇到执行或终稿交付失败，HTTP 仍为 200 | 按流内失败处理，再读原任务状态和已保存资料。 |

可用下面的命令核验 `406`。它在受理前返回 `{"error":"AG-UI 需要 text/event-stream。"}`。

```sh
curl -sS -i -H 'Content-Type: application/json' -H 'Accept: application/json' \
  --data-binary "$request" "$base/api/ag-ui"
```

重复受理的响应示例（`Location` 指向实际原运行）。

```http
HTTP/1.1 409 Conflict
Location: /api/tasks/a6de3ccc-5532-43ca-a794-d62f99749cf5
Content-Type: application/json

{"error":"该运行已受理，请只读原状态与归档。","code":"RUN_ALREADY_ACCEPTED"}
```

受理后的流内失败帧示例。

```text
data: {"type":"RUN_ERROR","message":"本轮未完成。请查看该运行的已保存记录。","code":"run_failed"}

```

[HTTP 受理和重号处理](../server/ag-ui-workbench.ts) · [终态投影](../server/ag-ui-persistence.ts) · [地图待办查询](../server/ag-ui-workspace-inventory.ts)

## 持久业务操作（隔离候选）

发现委托等待用户补答时，原卡在 `GET /api/tasks/:runId/record` 的 `interrupt.operation` 中给出 `operationId` 和 `stepId`。收到此字段时，在原生 `resume` 之外，把原卡上的两项值原样放入 `forwardedProps.oneearth.submission.operationReply`。下面是要合入正常续答请求的字段：

```json
{
  "previousTaskId": "a6de3ccc-5532-43ca-a794-d62f99749cf5",
  "operationReply": {
    "operationId": "5f901d09-e501-4307-b450-cf62efefbe21",
    "stepId": "23d3fc2a-56fd-45ce-9f2a-41778c69793f"
  }
}
```

`previousTaskId` 和标准 `resume[0].interruptId` 指向同一原卡，`runId` 和末条用户消息 ID 属于新的交互。普通提问可以在同会话里继续受理。过期、错步骤、已消费的补答返回 409。服务端无法为经核实的原操作准备续行时，返回 `OPERATION_RESUME_UNAVAILABLE`。

同一地图业务可以发布多个 `STATE_SNAPSHOT.snapshot.oneearth.workspaceEffect`。每个待办包含原 `runId`、`operationId`、`stepId`、`stepOrder`。`stepOrder` 严格递增，中间可以有服务步骤。浏览器创建原轮时发送 `forwardedProps.oneearth.submission.workspacePage.token`，其值是本页面生成的 64 位十六进制凭据。原页面断流后带 `X-OneEarth-Workspace-Page` 读取原运行的当前待办。收到实际观察后，使用同一凭据发送：

```http
PUT /api/workspaces/<conversationId>/actions/<operationId>/effects/<stepId>/receipt
Content-Type: application/json
X-OneEarth-Workspace-Page: <原页面凭据>
```

飞行回执使用 `{kind:"flight",flight:{state,observedAt,...}}`，确认实际到达时带实际 H3 地面点。目录绘制使用 `{kind:"catalogue-presentation",presentation:{conversationId,turnId,batchId,coverageRevision,items}}`，每项绑定原数据集 ID 和版本。200 返回保存的事实；能力凭据或归属失配返回 404，事实与原待办冲突返回 409。归档的 `workspaceEffects` 可读本轮各浏览器步骤。等待状态表明尚未验证回执，整页刷新只恢复已存结果及原任务状态。用户可显式取消。

[工作台运行时](../server/runtime-map-operation.ts) · [回执路由](../server/workspace-effect-routes.ts) · [原追问事务](../server/ag-ui-operation-discovery.ts)

### 从工作台独立发现资料（隔离候选）

工作台使用当前输入和会话修订，在原会话提交长操作。此路径直接保存资料批次。用户选择「引用到 Chat」后，下次实际发送的消息才读取相应原批次。

```http
POST /api/workspaces/<conversationId>/actions
Content-Type: application/json
X-OneEarth-Operation-Key: <本操作独立的64位小写十六进制随机值>

{"kind":"discover-materials","actionId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","expectedRevision":0,"query":"查找祁连山冰川前缘资料"}
```

受理返回 HTTP 202 和 `Location: /api/workspaces/<conversationId>/operations/<operationId>`。响应结构如下。

```json
{"operationId":"5f901d09-e501-4307-b450-cf62efefbe21","actionId":"a6de3ccc-5532-43ca-a794-d62f99749cf5","conversationId":"4a5a2f00-e513-4154-8792-b59fe643bd17","status":"queued"}
```

| 请求 | 行为 |
| --- | --- |
| `GET /api/workspaces/:conversationId/actions/:actionId` | 在 202 响应丢失时用原动作和原凭据找回受理结果。 |
| `GET /api/workspaces/:conversationId/operations/:operationId` | 读取当前状态、受理时的会话修订和已归档资料。 |
| `GET /api/workspaces/:conversationId/operations/:operationId/record` | 读取原资料批次及出处。尚无归档时返回 404。 |
| `DELETE /api/workspaces/:conversationId/operations/:operationId` | 持久化取消。成功返回 204，已终结返回 409。 |

这些请求使用提交时的同一 `X-OneEarth-Operation-Key`。错会话、错凭据或未知编号返回 404。会话修订冲突和同动作编号改输入返回 409。已登记的同包重传返回原操作地址。读回和历史重开保持原批次。

原生 Chat 发起时，末条用户消息为「发现资料：<题目>」，`forwardedProps.oneearth.submission.discoveryAction` 带 `{actionId,expectedRevision,accessKey}`。从工作台选择原批次后发送普通 Chat，使用 `discoveryReference:{operationId,batchId,accessKey}`。两字段互斥。服务端使用原档的标题、出处和实际记录；引用路径直接整理原批次。凭据从提交解析后移出 Chat 正文、历史与归档。Chat 发起的资料发现通过原 `/api/tasks/:runId` 取消时，同样携带该操作的凭据。

[运行时受理](../server/ag-ui-workbench.ts) · [受保护操作路由](../server/workspace-discovery-operations.ts) · [输入和结果结构](../src/domain/workspace-discovery.ts)
