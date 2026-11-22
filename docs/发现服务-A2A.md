# 运行时与数据发现服务

适用于 Mac mini 上的 OneEarth A2A 候选。网页任务 API 及同源入口维持现有用法。运行时持有研究记录、轮次、引用和研究者确认，数据发现服务持有一次受托任务及渠道检索过程。

## 委托与取回材料

内部发现接口绑定回环地址。使用 A2A 1.0 的 HTTP+JSON 绑定，操作请求带 `A2A-Version: 1.0`，JSON 请求正文使用 `application/a2a+json`。协议说明以 [A2A v1.0.1 正式规范](https://a2a-protocol.org/v1.0.1/specification/) 为准。

| 操作 | 在 OneEarth 中的用途 |
| --- | --- |
| `GET /.well-known/agent-card.json` | 声明数据发现能力和流式订阅 |
| `POST /message:send` | 接收一个业务消息，响应 `{task}`。运行时显式设置 `configuration.returnImmediately=true`，随后按已受理的 Task ID 取进展 |
| `POST /message:stream` | 接收委托并打开该任务的 SSE |
| `GET /tasks/{id}` | 读取已保存的受托任务状态与材料 |
| `POST /tasks/{id}:subscribe` | 首帧给出 Task 快照，随后推送按序保存的进展。任务快速结束或连接断开时按同一 ID 取回快照 |
| `POST /tasks/{id}:cancel` | 取消已验证受理的委托。服务不可达时保留取消未确认的诊断 |

`message.parts` 携带一个带 `kind=oneearth.discovery.request.v1` 的数据 part。它描述本次目的、证据缺口、已确认范围、引用或已取得材料，以及本轮 DeepSeek Search 和 DeepSeek Fetch 两个开关。启用条件是本轮开关和发现部署配置同时允许。既有 Bing、DataCite 等渠道仍可发公开查询。机构和项目权限、具体材料能否外发由各自权限边界约束。模型、执行器、访问凭据和内部计划由发现服务保管。发现服务按既有逻辑规划和检索。

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

缺少发现配置时，新委托的错误响应为 HTTP 503，正文例如 `{"error":{"code":503,"status":"UNAVAILABLE","message":"ONEEARTH_DISCOVERY_CHAT_MODEL 未配置。"}}`。已受理 Task 的读取、幂等、确认等待和终态竞态示例见[隔离 PostgreSQL 契约测试](../server/discovery-a2a.test.ts)及[客户端回归](../server/discovery-a2a-client.test.ts)。

运行时消息的 `messageId` 用于同一委托提交的幂等。发现服务另行生成并保存外部 Task ID，返回后由运行时写入研究事件；服务进程用内部作业执行实际工作。相同的消息及业务输入只登记一次，改动内容后重用消息 ID 会失败。稳定的产物 ID 和保存的事件序号用于重放去重。浏览器刷新接回运行时的同一个任务，发现客户端断线则以已经确认受理的 A2A Task 恢复材料。运行时进程重启仍沿用已归档材料及 `worker_interrupted` 语义。

发现结果需要研究者补充或确认时，对外状态为 `TASK_STATE_INPUT_REQUIRED`。明确的确认使用原 Task ID 和新的稳定消息 ID，并校验原提议、已确认范围和工具许可。服务将同一 Task 指向新的内部作业，重放保留旧确认记录，运行时通过事件水位读取本次进展。已经交付的受托任务保持完成状态，后续新缺口通过新消息创建有父关联的委托。一次受托任务的结束与整项研究的进度分别记录。

发现服务发出的普通澄清可以在原消息上选择「回复此问题」，在输入框补充或取消关联。运行时核对同会话的父记录和授权范围，从已保存的受理事件取 Task ID 和等待水位。A2A 续行携带 `continuedFrom` 与 `clarificationReply: {text, afterSeq}`，发现方对照当前等待阶段，从原受理请求恢复目的、范围和权限。旧水位或未经确认的目标变更无法推进原委托。普通下一句和运行时自行发出的澄清沿用各自的聊天路径。

## 部署与兼容

发现进程单独读取并校验 `ONEEARTH_DISCOVERY_CHAT_MODEL`，启动器只向发现角色传递此选择。已有授权的原生执行器模型或 DeepSeek 模型可以按部署配置启用；部署使用自己的凭据来源。缺少有效配置时，新 A2A 委托返回可识别的 `UNAVAILABLE`，此前保存的任务和材料可读取。运行时模型和执行器仍取其原有授权配置。参见[部署说明](../README.md)。

旧调用方可以继续使用 `/v1/discoveries` 的 HTTP+NDJSON 接口。发现服务配置了有效的本地模型时，v1 使用该模型，DeepSeek Search/Fetch 按本地与请求的开关取交集。旧部署未设置独立模型时，v1 沿用其请求中的合法配置；A2A 新委托返回 503。显式设置了无效配置时，现有档案继续可读，新委托报告配置错误。连接只提供旧接口的发现服务时，运行时须显式设置 `ONEEARTH_DISCOVERY_PROTOCOL=v1`。研究记录保持原本的运行时任务 ID 和引用。

A2A Task 的受理关系、消息去重和作业映射随发现 PostgreSQL 库保存，由停写产品备份包含。内部计划由发现服务产生，归档产物沿用的结果结构仍包含历史计划字段。

此批验证同一 Mac mini 上的服务间委托与已列操作。受托成果仍封装现有发现事件和结果类型，包含历史计划结构。论文缓存仍是共享 SQLite，机构身份、项目权限和跨主机授权另待验证。List Tasks 和推送通知未在本批启用。
