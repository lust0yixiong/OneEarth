"""Render the current OneEarth deployment diagram as a self-contained SVG."""
import base64
from html import escape
from pathlib import Path
import sys


WIDTH, HEIGHT = 1800, 1112
PAGE = "#f1f6f3"
WHITE = "#ffffff"
INK = "#162d27"
MUTED = "#486058"
BORDER = "#d9e5de"
RUNTIME_FILL = "#eff7f3"
COLORS = {
    "request": "#285a73",
    "executor": "#655098",
    "data": "#2a6e5f",
}

svg = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
    f'viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc">',
    '<title id="title">OneEarth 现行架构</title>',
    '<desc id="desc">5474 工作台、持久研究与操作、发现和时空服务。</desc>',
    '<style>text{font-family:"PingFang SC","Hiragino Sans GB",'
    '"Noto Sans CJK SC",Arial,sans-serif}</style>',
    "<defs>",
]
for name, color in COLORS.items():
    svg.append(
        f'<marker id="{name}" markerUnits="userSpaceOnUse" viewBox="0 0 12 12" '
        f'markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse">'
        f'<path d="M1 1 L11 6 L1 11 Z" fill="{color}"/></marker>'
    )
svg.append("</defs>")


def rect(x, y, width, height, fill=WHITE, border=BORDER, radius=16, id_=None):
    box_id = f' id="{id_}"' if id_ else ""
    stroke = f' stroke="{border}" stroke-width="1.5"' if border else ""
    svg.append(
        f'<rect{box_id} x="{x}" y="{y}" width="{width}" height="{height}" '
        f'rx="{radius}" fill="{fill}"{stroke}/>'
    )


def text(x, y, value, size=22, color=INK, weight=400, anchor="start"):
    svg.append(
        f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" '
        f'font-weight="{weight}" text-anchor="{anchor}">{escape(value)}</text>'
    )


def rule(x1, x2, y):
    svg.append(f'<path d="M{x1} {y} H{x2}" stroke="{BORDER}" stroke-width="1.5"/>')


def arrow(id_, path, color="request", *, bidirectional=False):
    end = f' marker-end="url(#{color})"'
    start = f' marker-start="url(#{color})"' if bidirectional else ""
    svg.append(
        f'<path id="{id_}" d="{path}" fill="none" stroke="{COLORS[color]}" '
        f'stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"{start}{end}/>'
    )


def card(id_, x, y, width, height, title, lines=(), *, fill=WHITE, border=BORDER,
         title_size=28, body_size=22):
    rect(x, y, width, height, fill, border, id_=id_)
    text(x + 22, y + 38, title, title_size, weight=700)
    for index, line in enumerate(lines):
        text(x + 22, y + 72 + 30 * index, line, body_size, MUTED)


def edge_label(x, y, value, color="request", size=19, anchor="middle"):
    text(x, y, value, size, COLORS[color], 600, anchor)


# Header and columns.
rect(0, 0, WIDTH, HEIGHT, PAGE, None, 0)
brand = Path(__file__).resolve().parents[2] / "public/brand/OneEarth-lockup-light-transparent@1x.png"
logo = base64.b64encode(brand.read_bytes()).decode()
svg.append(
    f'<image x="57" y="30" width="152" height="54" preserveAspectRatio="xMinYMid meet" '
    f'href="data:image/png;base64,{logo}"/>'
)
text(229, 70, "现行架构", 43, weight=720)
text(1742, 68, "Mac mini · 5474", 23, MUTED, 600, "end")
rule(58, 1742, 101)
for x, title in ((58, "用户工作台"), (570, "受理、存储与执行"), (1284, "独立业务服务")):
    text(x, 141, title, 22, MUTED, 670)

# Browser, shared operation admission and authoritative runtime records.
card("workbench", 58, 167, 364, 272, "OneEarth 工作台", body_size=22)
text(80, 243, "Chat、执行过程与历史", 24, weight=620)
text(80, 283, "Cesium 球体、选区与图层", 24, weight=620)
rule(80, 400, 308)
text(80, 351, "镜头与临时选区属于当前窗口", 20, MUTED)
text(80, 392, "地图效果与绘制结果回报原操作", 19, MUTED)

card("runtime-api", 570, 167, 476, 272, "工作台后端 · 5474", fill=RUNTIME_FILL, border="#c4dbd0")
text(592, 242, "同源网关与运行时 API · 同一进程", 22, weight=650)
rule(592, 1024, 263)
text(592, 308, "受理 Chat 与结构化工作台动作", 22, MUTED)
text(592, 350, "查询状态、归档及已发布图层", 22, MUTED)
text(592, 394, "内部工具队列执行 Search、Fetch、PDF 读取", 19, MUTED)

card("discovery-entries", 58, 513, 364, 161, "资料发现双入口",
     ("点「查找资料」或在 Chat 明确发起", "受理后使用同一发现能力"), body_size=20)
card("identities", 58, 733, 364, 150, "会话、运行与操作",
     ("conversationId · 会话研究状态", "runId · Chat 运行  /  operationId · 操作"), body_size=18)

card("runtime-postgres", 570, 512, 476, 146, "运行时 PostgreSQL",
     ("会话修订、冻结范围、任务与待执行步骤", "原委托、公开事件、回执与研究归档"), body_size=22)
card("research-worker", 570, 733, 476, 150, "研究 worker（多实例）",
     ("按租约领取同一队列中的步骤", "等待外部结果时让位，按原检查点续行"), body_size=22)
card("executor-adapters", 570, 956, 476, 105, "运行时执行器适配层",
     ("默认前台 Flash API  ·  后台 Codex / Claude",), fill="#f2eef8", border="#ded5ec", body_size=19)

# Each business service owns its records and accesses them inside its process.
card("discovery", 1284, 167, 458, 272, "数据发现智能体服务 · 5475")
text(1306, 243, "A2A 目录查询与异步研究委托", 22, weight=650)
text(1306, 282, "检索论文断言、海纳与其他授权来源", 20, MUTED)
text(1306, 318, "发现模型按本服务独立配置", 20, MUTED)
rule(1306, 1720, 344)
text(1306, 384, "发现 PostgreSQL · 目录、委托与材料", 20, MUTED)

card("spatial", 1284, 563, 458, 246, "时空数据服务 · 5476")
text(1306, 641, "权威覆盖范围、网格与发布修订", 22, weight=650)
text(1306, 680, "图层目录、分块和已发布对象", 21, MUTED)
rule(1306, 1720, 709)
text(1306, 749, "PostGIS · 图层索引与论文覆盖投影", 20, MUTED)
text(1306, 783, "Garage / S3 · 图层对象", 20, MUTED)

# Arrows start from the actual initiator. Returning HTTP responses follow the same call.
arrow("chat-sse", "M426 230 H566", bidirectional=True)
edge_label(496, 214, "AG-UI / SSE", size=17)
arrow("workbench-actions", "M426 367 H566")
edge_label(496, 351, "HTTP 动作与回执", size=17)
arrow("api-persistence", "M783 443 V508", "data", bidirectional=True)
edge_label(806, 481, "受理与持久化", "data", anchor="start")
arrow("worker-lease", "M783 729 V662", "data", bidirectional=True)
edge_label(806, 702, "领取租约与写回", "data", anchor="start")
arrow("api-executor", "M566 416 H523 V1003 H566", "executor")
edge_label(506, 994, "前台选择与调用", "executor", size=17, anchor="end")
arrow("worker-executor", "M783 887 V952", "executor")
edge_label(806, 930, "后台模型调用", "executor", anchor="start")

arrow("discovery-catalogue", "M1050 231 H1280")
edge_label(1165, 215, "A2A 目录查询", size=18)
arrow("discovery-tool-callback", "M1280 317 H1050", "executor")
edge_label(1165, 302, "HTTP 取证回调 · 回环", "executor", size=17)
arrow("api-spatial", "M1050 421 H1204 V586 H1280", "data")
edge_label(1220, 487, "HTTP 覆盖", "data", size=17, anchor="start")
edge_label(1220, 514, "与图层转发", "data", size=17, anchor="start")
# The visual bridge keeps independent call paths distinct where they cross.
svg.append(f'<path d="M1114 431 V411" fill="none" stroke="{PAGE}" stroke-width="10"/>')
arrow("worker-discovery", "M1050 756 H1114 V375 H1280")
edge_label(1212, 360, "A2A 研究委托", size=17)
arrow("worker-spatial", "M1050 821 H1183 V690 H1280", "data")
edge_label(1229, 674, "HTTP 覆盖", "data", size=17)
arrow("spatial-catalogue-sync", "M1513 559 V443", "data")
edge_label(1534, 504, "A2A 拉取发布投影", "data", size=18, anchor="start")

rule(58, 1742, 1082)
text(58, 1102, "单箭头指向调用目标，双箭头表示事件或读写往返。", 17, MUTED)
text(1742, 1102, "部署源码 5c8697c", 17, MUTED, 500, "end")

svg.append("</svg>")
Path(sys.argv[1]).write_text("\n".join(svg), encoding="utf-8")
