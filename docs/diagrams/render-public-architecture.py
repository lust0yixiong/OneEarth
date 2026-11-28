"""Render the public OneEarth architecture diagram as a self-contained SVG."""
import base64
from html import escape
from pathlib import Path
import sys


WIDTH, HEIGHT = 1800, 1142
PAGE = "#f1f6f3"
WHITE = "#ffffff"
INK = "#162d27"
MUTED = "#486058"
BORDER = "#d9e5de"
RUNTIME_FILL = "#eff7f3"
PLAN_FILL = "#f7f5fa"
PLAN_BORDER = "#ded6eb"
COLORS = {
    "request": "#285a73",
    "executor": "#655098",
    "data": "#2a6e5f",
    "planned": "#645381",
    "egress": "#985220",
}

svg = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
    f'viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title desc">',
    '<title id="title">OneEarth 逻辑架构</title>',
    '<desc id="desc">工作台、运行时、业务服务与来源。实线表示现行链路，虚线表示规划链路。</desc>',
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


def rect(x, y, width, height, fill=WHITE, border=BORDER, radius=16, dashed=False, id_=None):
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


def arrow(id_, path, color="request", *, planned=False, bidirectional=False):
    end = f' marker-end="url(#{color})"'
    start = f' marker-start="url(#{color})"' if bidirectional else ""
    dash = ' stroke-dasharray="8 6"' if planned else ""
    svg.append(
        f'<path id="{id_}" d="{path}" fill="none" stroke="{COLORS[color]}" '
        f'stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"{dash}{start}{end}/>'
    )


def card(id_, x, y, width, height, title, lines=(), *, fill=WHITE, border=BORDER,
         title_size=28, body_size=22, planned=False):
    rect(x, y, width, height, fill, border, dashed=planned, id_=id_)
    text(x + 22, y + 38, title, title_size, weight=700)
    for index, line in enumerate(lines):
        text(x + 22, y + 72 + 30 * index, line, body_size, MUTED)


def edge_label(x, y, value, color="request", size=19, anchor="middle"):
    text(x, y, value, size, COLORS[color], 600, anchor)


# Page header and shared notation.
rect(0, 0, WIDTH, HEIGHT, PAGE, None, 0)
brand = Path(__file__).resolve().parents[2] / "public/brand/OneEarth-lockup-light-transparent@1x.png"
logo = base64.b64encode(brand.read_bytes()).decode()
svg.append(
    f'<image x="59" y="35" width="154" height="54" preserveAspectRatio="xMinYMid meet" '
    f'href="data:image/png;base64,{logo}"/>'
)
text(235, 76, "逻辑架构", 46, weight=720)
rule(58, 1742, 107)
for x, heading in [(64, "用户交互"), (410, "运行时"), (1002, "业务服务"), (1486, "来源与存储")]:
    text(x, 151, heading, 20, MUTED, 650)

rect(410, 183, 436, 552, RUNTIME_FILL, "#c4dbd0", 18, id_="runtime-active")
text(437, 221, "OneEarth 运行时", 30, weight=710)

card("workbench", 64, 249, 255, 185, "工作台")
text(86, 322, "网页界面（React）", 22, MUTED)
rule(86, 296, 343)
text(86, 380, "统一入口（Express）", 22, MUTED)

card("runtime-api", 447, 241, 375, 125, "运行时 API",
     ("受理 Chat，按配置选择执行器", "判断与回复，研究任务入库"), body_size=21)
card("research-worker", 447, 435, 375, 113, "研究 worker",
     ("从 PostgreSQL 领取任务", "委托发现并归档研究证据"), body_size=20)
card("executor-adapters", 447, 622, 375, 95, "执行器适配层",
     (r"可选执行器  Codex CLI \ Claude Code",), fill="#f1edf8", border="#ddd2ee", body_size=19)

card("discovery", 1002, 246, 333, 278, "数据发现智能体服务", title_size=27)
text(1024, 331, "检索目录、定位来源", 22, MUTED)
text(1024, 365, "规划取证、回传材料", 22, MUTED)
rule(1024, 1313, 389)
text(1024, 430, "目录查询与研究委托", 22, COLORS["request"], 650)
text(1024, 468, "保留原任务与来源", 21, MUTED)

card("professional-sources", 1486, 262, 250, 130, "专业资料来源",
     ("论文断言、海纳、STAC",), title_size=26, body_size=20)
card("spatial", 1002, 892, 333, 147, "时空数据服务",
     ("覆盖范围与修订", "地图图层与发布投影"))
card("storage", 1486, 892, 250, 147, "持久存储",
     ("PostgreSQL / PostGIS", "Garage / S3"), title_size=26, body_size=20)

card("data-processing", 1002, 554, 333, 115, "数据处理智能体服务（预留）",
     ("受理处理委托并回传结果",), fill=PLAN_FILL, border=PLAN_BORDER, title_size=22, body_size=20, planned=True)
card("unified-representation", 1002, 715, 333, 116, "统一表征数据服务（预留）",
     ("返回表征数据、来源与版本",), fill=PLAN_FILL, border=PLAN_BORDER, title_size=23, body_size=20, planned=True)
card("tool-service", 447, 815, 375, 126, "独立工具服务（规划）",
     ("供运行时及其他获授权的调用方使用", "执行工具并返回状态和结果"), fill=PLAN_FILL, border=PLAN_BORDER,
     title_size=27, body_size=18, planned=True)
card("network-sources", 1486, 720, 250, 119, "公开网络供应商与原站",
     ("搜索、网页与 PDF 来源",), fill="#fffbf5", border="#e8d8c6", title_size=22, body_size=19)

arrow("workbench-runtime", "M322 303 H443")
edge_label(383, 287, "AG-UI / HTTP", size=17)
arrow("research-task-handoff", "M637 369 V431")
edge_label(654, 409, "入库后领取", anchor="start")
arrow("api-executor-call", "M479 368 V380 Q479 394 465 394 H442 Q428 394 428 408 V651 Q428 665 442 665 H443", "executor")
arrow("worker-executor-call", "M637 550 V618", "executor")
edge_label(655, 592, "模型调用", "executor", anchor="start")

arrow("discovery-tool-callback", "M997 279 H826", "executor", bidirectional=True)
edge_label(911, 265, "发现取证回调", "executor")
arrow("discovery-catalogue", "M826 343 H997")
edge_label(911, 329, "A2A 目录查询")
arrow("discovery-research", "M826 480 H997", bidirectional=True)
edge_label(911, 466, "A2A 研究委托")
arrow("discovery-sources", "M1339 320 H1482", "data")
edge_label(1410, 306, "读取资料", "data")

arrow("spatial-catalogue-sync", "M1339 930 H1376 Q1392 930 1392 914 V483 Q1392 467 1376 467 H1339", "data")
edge_label(1410, 552, "同步发布", "data", size=17, anchor="start")
edge_label(1410, 576, "投影", "data", size=17, anchor="start")
arrow("spatial-storage", "M1339 982 H1482", "data")
edge_label(1410, 968, "索引与对象", "data")
arrow("workbench-spatial", "M191 438 V1062 Q191 1078 207 1078 H1130 Q1146 1078 1146 1062 V1043", "data")
edge_label(681, 1066, "覆盖查询与地图图层", "data")

arrow("data-processing-a2a", "M850 568 H905 Q921 568 921 584 V601 Q921 617 937 617 H998",
      "planned", planned=True, bidirectional=True)
edge_label(963, 603, "A2A", "planned")
arrow("unified-representation-a2a", "M850 638 H871 Q887 638 887 654 V754 Q887 770 903 770 H998",
      "planned", planned=True, bidirectional=True)
edge_label(951, 756, "A2A", "planned")
arrow("independent-tool-service", "M637 739 V811", "planned", planned=True)
edge_label(657, 783, "A2A / MCP / API", "planned", anchor="start")
rect(1384, 859, 16, 14, PAGE, None, 0)
arrow("tool-service-egress", "M826 866 H1421 Q1437 866 1437 850 V793 Q1437 777 1453 777 H1482",
      "egress", planned=True)
edge_label(1189, 854, "工具服务出站（规划）", "egress")

rule(58, 1742, 1098)
text(64, 1127, "实线为现行链路，虚线为规划链路", 19, MUTED, 550)
text(1736, 1127, "单箭头标发起或交接方向 · 双箭头另标回传", 19, MUTED, 500, "end")

svg.append("</svg>")
Path(sys.argv[1]).write_text("\n".join(svg), encoding="utf-8")
