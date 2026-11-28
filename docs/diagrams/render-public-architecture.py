"""Render the current OneEarth deployment diagram as a self-contained SVG."""
import base64
from html import escape
from pathlib import Path
import sys


WIDTH, HEIGHT = 2000, 1230
PAGE = "#f1f6f3"
WHITE = "#ffffff"
INK = "#162d27"
MUTED = "#486058"
BORDER = "#d9e5de"
RUNTIME_FILL = "#eff7f3"
STORAGE_FILL = "#e9f4ef"
STORAGE_BORDER = "#b8d3c6"
PLAN_FILL = "#f5f2f8"
PLAN_BORDER = "#aaa0bc"
COLORS = {
    "request": "#285a73",
    "executor": "#655098",
    "data": "#2a6e5f",
    "tools": "#98612f",
    "planned": "#69577d",
}

svg = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
    f'viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc">',
    '<title id="title">OneEarth 架构</title>',
    '<desc id="desc">5474 现行进程、各服务的持久存储和预留接入。</desc>',
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


def rect(x, y, width, height, fill=WHITE, border=BORDER, radius=16, id_=None, dashed=False):
    box_id = f' id="{id_}"' if id_ else ""
    stroke = f' stroke="{border}" stroke-width="1.5"' if border else ""
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    svg.append(
        f'<rect{box_id} x="{x}" y="{y}" width="{width}" height="{height}" '
        f'rx="{radius}" fill="{fill}"{stroke}{dash}/>'
    )


def text(x, y, value, size=22, color=INK, weight=400, anchor="start"):
    svg.append(
        f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" '
        f'font-weight="{weight}" text-anchor="{anchor}">{escape(value)}</text>'
    )


def rule(x1, x2, y):
    svg.append(f'<path d="M{x1} {y} H{x2}" stroke="{BORDER}" stroke-width="1.5"/>')


def arrow(id_, path, color="request", *, bidirectional=False, dashed=False):
    end = f' marker-end="url(#{color})"'
    start = f' marker-start="url(#{color})"' if bidirectional else ""
    dash = ' stroke-dasharray="8 6"' if dashed else ""
    svg.append(
        f'<path id="{id_}" d="{path}" fill="none" stroke="{COLORS[color]}" '
        f'stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"{dash}{start}{end}/>'
    )


def card(id_, x, y, width, height, title, lines=(), *, fill=WHITE, border=BORDER,
         title_size=28, body_size=22, dashed=False):
    rect(x, y, width, height, fill, border, id_=id_, dashed=dashed)
    text(x + 22, y + 38, title, title_size, weight=700)
    for index, line in enumerate(lines):
        text(x + 22, y + 72 + 30 * index, line, body_size, MUTED)


def edge_label(x, y, value, color="request", size=19, anchor="middle"):
    text(x, y, value, size, COLORS[color], 600, anchor)


def storage(id_, x, y, width, height, title, lines):
    card(id_, x, y, width, height, title, lines, fill=STORAGE_FILL, border=STORAGE_BORDER,
         title_size=24, body_size=19)


def planned(id_, x, width, title, detail):
    card(id_, x, 135, width, 100, title, (detail,), fill=PLAN_FILL, border=PLAN_BORDER,
         title_size=19, body_size=18, dashed=True)


rect(0, 0, WIDTH, HEIGHT, PAGE, None, 0)
brand = Path(__file__).resolve().parents[2] / "public/brand/OneEarth-lockup-light-transparent@1x.png"
logo = base64.b64encode(brand.read_bytes()).decode()
svg.append(
    f'<image x="57" y="30" width="152" height="54" preserveAspectRatio="xMinYMid meet" '
    f'href="data:image/png;base64,{logo}"/>'
)
text(229, 70, "架构", 43, weight=720)
text(1945, 69, "Mac mini · 5474", 23, MUTED, 600, "end")
rule(55, 1945, 101)

planned("data-processing", 1060, 280, "数据处理智能体服务（预留）", "受理处理委托")
planned("unified-representation", 1370, 280, "统一表征数据服务（预留）", "提供表征、来源与版本")
planned("independent-tool-service", 1680, 265, "独立工具服务（规划）", "工具调用与结果回传")

card("workbench", 55, 315, 295, 220, "OneEarth 工作台",
     ("Chat、执行过程与历史", "Cesium 球体、选区与图层", "查找资料可由按钮或 Chat 发起"), body_size=18)
card("runtime-api", 510, 315, 460, 220, "工作台后端 · 5474", fill=RUNTIME_FILL, border="#c4dbd0")
text(532, 390, "同源网关与运行时 API · 同一进程", 22, weight=650)
rule(532, 948, 414)
text(532, 454, "受理 Chat 与结构化工作台动作", 22, MUTED)
text(532, 490, "同一资料发现受理 · 原轮状态与归档", 20, MUTED)

card("runtime-web-tools", 55, 635, 295, 135, "运行时工具队列",
     ("Search、Fetch 与 PDF 读取", "5474 进程内执行并保存回执"), fill="#fff9ef", border="#e5d2bb", body_size=18)
card("network-sources", 55, 837, 295, 125, "公开网络来源",
     ("搜索供应商、网页与 PDF 原站",), body_size=18)

storage("runtime-postgres", 510, 610, 460, 150, "运行时 PostgreSQL",
        ("会话修订与冻结范围、任务与操作步骤", "原委托、公开事件、回执与研究归档"))
card("research-worker", 510, 837, 460, 155, "研究 worker（多实例）",
     ("从同一队列按租约领取步骤", "等待外部结果时让位，按原检查点续行"), body_size=21)
card("executor-adapters", 510, 1063, 460, 105, "执行器适配层",
     (r"进程内调用 · Flash API / Codex CLI \ Claude Code",),
     fill="#f2eef8", border="#ded5ec", body_size=17)

card("discovery", 1220, 315, 385, 220, "数据发现智能体服务 · 5475", title_size=26)
text(1242, 390, "A2A 查询与异步研究委托", 22, weight=650)
text(1242, 430, "论文断言、海纳与其他授权来源", 20, MUTED)
text(1242, 474, "本服务独立配置发现模型", 20, MUTED)
storage("discovery-postgres", 1650, 355, 295, 130, "发现 PostgreSQL", ("目录、委托与研究材料",))

card("spatial", 1220, 665, 385, 205, "时空数据服务 · 5476", title_size=27)
text(1242, 741, "权威覆盖范围、网格与发布修订", 21, weight=650)
text(1242, 783, "图层目录、分块及发布对象", 20, MUTED)
storage("spatial-postgis", 1650, 665, 295, 100, "时空 PostGIS", ("图层索引与论文覆盖投影",))
storage("spatial-objects", 1650, 800, 295, 100, "Garage / S3", ("发布图层对象",))

arrow("planned-processing", "M740 311 V204 H1056", "planned", bidirectional=True, dashed=True)
edge_label(984, 187, "A2A", "planned", size=17)
arrow("planned-representation", "M790 311 V272 H1510 V239", "planned", bidirectional=True, dashed=True)
edge_label(1331, 260, "A2A", "planned", size=17)
arrow("planned-tool-service", "M840 311 V295 H1810 V239", "planned", dashed=True)
edge_label(1669, 283, "A2A / MCP / API", "planned", size=17)

arrow("chat-sse", "M354 374 H506", bidirectional=True)
edge_label(430, 358, "AG-UI / SSE", size=17)
arrow("workbench-actions", "M354 470 H506")
edge_label(430, 454, "HTTP 动作与回执", size=17)
arrow("api-tools", "M506 512 H395 V703 H354", "tools")
edge_label(385, 609, "内部执行", "tools", size=17, anchor="end")
arrow("tools-outbound", "M202 774 V833", "tools")
edge_label(225, 807, "实际网络请求", "tools", size=17, anchor="start")

arrow("api-persistence", "M740 539 V606", "data", bidirectional=True)
edge_label(762, 580, "受理与持久化", "data", anchor="start")
arrow("worker-lease", "M740 833 V764", "data", bidirectional=True)
edge_label(762, 804, "领取租约与写回", "data", anchor="start")
arrow("api-executor", "M506 529 H470 V1117 H506", "executor")
edge_label(453, 1105, "前台选择与调用", "executor", size=17, anchor="end")
arrow("worker-executor", "M740 996 V1059", "executor")
edge_label(762, 1034, "后台模型调用", "executor", anchor="start")

arrow("discovery-catalogue", "M974 369 H1216")
edge_label(1095, 352, "A2A 目录查询", size=18)
arrow("discovery-tool-callback", "M1216 450 H974", "tools")
edge_label(1095, 433, "HTTP 取证回调 · 回环", "tools", size=17)
arrow("api-spatial", "M974 521 H1134 V697 H1216", "data")
edge_label(1120, 592, "HTTP 覆盖", "data", size=17, anchor="end")
edge_label(1120, 617, "与图层转发", "data", size=17, anchor="end")

# Independent paths cross at this point without joining.
svg.append(f'<path d="M1030 531 V511" fill="none" stroke="{PAGE}" stroke-width="10"/>')
arrow("worker-discovery", "M974 867 H1030 V495 H1216")
edge_label(1123, 478, "A2A 研究委托", size=17)
arrow("worker-spatial", "M974 940 H1100 V808 H1216", "data")
edge_label(1158, 791, "HTTP 覆盖", "data", size=17)
arrow("spatial-catalogue-sync", "M1417 661 V539", "data")
edge_label(1439, 599, "A2A 拉取发布投影", "data", size=17, anchor="start")
arrow("discovery-db", "M1609 419 H1646", "data", bidirectional=True)
arrow("spatial-db", "M1609 718 H1646", "data", bidirectional=True)
arrow("spatial-storage", "M1609 846 H1646", "data")
edge_label(1628, 832, "读取", "data", size=14)

rule(55, 1945, 1192)
text(55, 1217, "实线为现行调用与读写，虚线为预留或规划接入。", 18, MUTED)
text(1945, 1217, "部署源码 5c8697c", 17, MUTED, 500, "end")

svg.append("</svg>")
Path(sys.argv[1]).write_text("\n".join(svg), encoding="utf-8")
