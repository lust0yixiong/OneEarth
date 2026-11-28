# OneEarth 架构与界面图索引

## 公开逻辑主图

[OneEarth 主架构图](oneearth-public-architecture.png)由 [README](../../README.md#当前工作台) 和[架构与接口现状](../架构与接口现状.md#公开逻辑架构)共用。图中包括同一浏览器工作台内的 Chat 与 Cesium、5474 的同源网关和运行时、持久化队列、多实例 worker、独立发现与时空服务。实线用于现行组件，虚线用于预留接入。[连线说明](../架构与接口现状.md#主图连线说明)

[规划图快照](oneearth-planned-architecture.png)记录数据处理智能体、统一表征数据服务和独立工具服务的连线。其生成源为 [render-planned-architecture.py](render-planned-architecture.py)。

修改主图可编辑[生成脚本](render-public-architecture.py)。在仓库根目录运行下列命令生成 SVG，再用 Chromium 按 SVG 原始画布大小导出 PNG，更新 README 引用的主图。

```sh
python3 docs/diagrams/render-public-architecture.py /tmp/oneearth-public-architecture.svg
```

<a id="在运实况"></a>

## rc.10 首发实况

[Mac mini v0.2.0-rc.10 横版实况图](oneearth-mac-mini-rc10.png)对应正式发布源码 `7d44a0b`。图中仅画 rc.10 已发布的调用关系，工作台入口和内部服务以逻辑名称标记。任务提交与领取、研究取证与浏览预览另有图注。[架构现状与 rc.10 图注](../架构与接口现状.md#rc10-图注) · [正式验收](../../evidence/product/ACCEPTANCE.md#mac-mini-rc10-公开网络工具与局域网正式发布)

## 目标与阶段设计

| 图 | 用途 |
| --- | --- |
| [执行架构目标图](oneearth-execution-target.png) | 以 rc.9 为出发点，说明可替换执行器、工具与 Skill 的设计关系。虚线表示使用依赖。实际调用和结果经运行时的执行接口。固定只读范例及验证口径见 [Skill 嵌套执行与验收](../Skill嵌套执行与验收.md)。 |
| [重构启动目标图](../spec/目标技术架构图.png) | 重构启动时确认的目标服务及数据所有权，配合[基线文字](../spec/01-目标与架构.md)阅读。 |

目标图表达方向。已发布范围和待验证项以[架构现状](../架构与接口现状.md)和相应验收为准。

## 历史架构快照

| 图 | 对应快照 |
| --- | --- |
| [Mac mini rc.8](oneearth-mac-mini-rc8.png) | 论文发布与 PostGIS 投影切换。[验收](../../evidence/product/ACCEPTANCE.md#mac-mini-论文发布与时空投影-v020-rc8) |
| [Mac mini rc.7](oneearth-mac-mini-rc7.png) | 工作台、研究材料和证据归属的签收快照。[当时的接口边界](../架构与接口现状.md#mac-mini-v020-rc7-签收快照) |
| [Mac mini rc.5](oneearth-mac-mini-rc5.png) | 研究工作流候选，仍有当时的 v1 委托和共享目录路径。[当时的候选实现](../架构与接口现状.md#mac-mini-v020-rc5-候选实现) |
| `OneEarth-当前技术架构-v0.2.0-dev.1.png` | 早期验收提及的原机导出图，在 Git 仓库外，须从原工作区取得。[历史验收小节](../../evidence/product/ACCEPTANCE.md#mac-mini-后续候选-v020-rc1) |

## 界面基准与验收截图

- [首页与 Chat 展开](../spec/界面参考/首页与Chat.png)、[地球工作区](../spec/界面参考/地球工作区.png)是原型的界面参照，采样条件见[核心验收基线](../spec/03-验收与证据.md#mac-mini-核心验收)。
- [早期验收截图](../../evidence/ACCEPTANCE.md)和[各阶段产品验收截图](../../evidence/product/ACCEPTANCE.md)按对应场景、浏览器或发布候选保留。
- [品牌素材说明](../../public/brand/README.md)记录标识与校验。
