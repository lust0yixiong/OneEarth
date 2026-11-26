from pathlib import Path
from html import escape
import base64
import sys

out = Path(sys.argv[1])
W, H = 2420, 1470
brand = Path(__file__).resolve().parents[2] / "public/brand/OneEarth-lockup-light-transparent@1x.png"
logo=base64.b64encode(brand.read_bytes()).decode()
blue="#266074"
muted="#46616d"
purple="#6246a5"
green="#3b6b60"
orange="#a4592f"
navy="#20333c"
proposed="#616080"
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
'<defs><linearGradient id="page" x2="0" y2="1"><stop stop-color="#f0f6f7"/><stop offset="1" stop-color="#f9fbfc"/></linearGradient>',
'<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity=".08"/></filter>']
for ident,color in [('blue',blue),('green',green),('purple',purple),('orange',orange),('proposed',proposed)]:
    svg.append(f'<marker id="{ident}" viewBox="0 0 10 10" markerWidth="9" markerHeight="9" refX="9" refY="5" orient="auto-start-reverse"><path fill="{color}" d="M 0 0 L 10 5 L 0 10 z"/></marker>')
svg+=['</defs>','<style>text{font-family: "PingFang SC","Hiragino Sans GB",Arial,sans-serif}.mono{font-family:Menlo,monospace}.small{font-size:20px}.tag{font-size:19px;font-weight:600;letter-spacing:1px}</style>']

def rect(x,y,w,h,fill="#fff",border=None,r=18,shadow=False,dashed=False):
    stroke=f' stroke="{border}" stroke-width="1.5"' if border else ""
    if dashed: stroke+=' stroke-dasharray="10 7"'
    effect=' filter="url(#shadow)"' if shadow else ''
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{stroke}{effect}/>')

def text(x,y,value,size=24,color=navy,weight=400,cls="",anchor="start"):
    svg.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" class="{cls}" text-anchor="{anchor}">{escape(value)}</text>')

def line(x,y,w,color="#e3edf0"):
    svg.append(f'<path d="M {x} {y} h {w}" stroke="{color}" stroke-width="2"/>')

def badge(x,y,w,label,ink=blue,fill="#e6f2f4"):
    rect(x,y,w,32,fill,None,8)
    text(x+12,y+23,label,18,ink,650)

def arrow(path,kind,reverse=False,dashed=False,element_id=None):
    color={"blue":blue,"purple":purple,"green":green,"orange":orange,"proposed":proposed}[kind]
    attrs=f' marker-end="url(#{kind})"'
    if reverse: attrs+=f' marker-start="url(#{kind})"'
    if dashed: attrs+=' stroke-dasharray="10 7"'
    if element_id: attrs+=f' id="{element_id}"'
    svg.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="3.7" stroke-linecap="round" stroke-linejoin="round"{attrs}/>')

rect(0,0,W,H,"url(#page)",None,0)
svg.append(f'<image x="72" y="54" width="180" height="63" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,{logo}"/>')
text(274,104,"公开逻辑架构",46,navy,720)
text(76,157,"同源工作台、独立发现与运行时工具执行，预留数据处理和统一表征委托",27,muted)
rect(1971,68,372,73,"#e6eff1",None,16)
text(1995,99,"v0.2.0-rc.10",25,navy,680,"mono")
text(1995,126,"在运基线 · 含设计预留",18,blue,560)
line(74,185,2272,"#cadde2")
for x,n in [(75,"访问侧"),(390,"同源入口"),(780,"运行时"),(1445,"业务服务"),(1940,"来源与存储")]:
    text(x,222,n,20,blue,700,"tag")

rect(75,352,245,244,border="#d7e5e9",shadow=True)
text(97,396,"研究者浏览器",28,navy,680)
line(97,412,197)
text(97,446,"本机与指定局域网",21)
text(97,481,"Chat、订阅、历史记录",19,muted)
text(97,514,"地图与数据目录",19,muted)
badge(97,540,184,"业务同源")

rect(385,328,297,289,border="#d7e5e9",shadow=True)
text(410,373,"工作台网关",29,navy,680)
badge(410,391,222,"Express / React")
text(410,455,"工作台和业务接口同源",20,navy,550)
text(410,486,"本机与受限局域网入口",20,navy,550)
line(410,510,246)
text(410,545,"Host / Origin 校验",21)
text(410,578,"局域网按直连网段限制",19,muted)

rect(775,250,543,639,"#e9f3f5","#c5dce1",22)
text(802,293,"OneEarth 运行时",31,navy,680)
text(802,320,"业务 API 与研究 worker 分进程运行",19,muted)
rect(800,342,493,123,"#fff","#d5e7eb",13)
text(822,375,"运行时 API",25,navy,680)
text(822,402,"统一任务、材料和目录入口",18,muted)
text(822,428,"覆盖业务查询 → 时空服务",18,green,560)
text(822,452,"内部工具受理及持久回执",18,muted)
rect(800,512,493,120,"#fff","#d5e7eb",13)
text(822,550,"研究 worker",26,navy,680)
text(822,582,"领取任务、请求发现、汇总证据",19,muted)
text(822,608,"恢复轮次、归档研究和稳定引用",19,muted)
rect(800,677,493,179,"#f3eff9","#e0d1ef",13)
text(822,718,"工具执行队列与适配层",25,purple,680)
text(822,755,"API 进程内独立有界队列",20,muted)
text(822,788,"Search、Fetch、原站及 PDF",20,muted)
text(822,822,"绑定原 Task、消息与调用编号",19,purple,550)
arrow("M 1048 468 V 506","blue",dashed=True)
arrow("M 1295 434 H 1306 V 755 H 1295","purple",dashed=True)

rect(1440,260,377,317,border="#d7e5e9",shadow=True)
text(1465,303,"数据发现智能体服务",29,navy,680)
badge(1465,320,218,"A2A · 已上线")
text(1465,388,"独立 DeepSeek 规划模型",21)
text(1465,422,"决定检索词、URL、读法与采纳",20,muted)
text(1465,454,"保留目录、原发现任务和材料",20,muted)
line(1465,477,326)
text(1465,516,"按同一委托收工具回执",20,purple,560)
text(1465,548,"论文、海纳与逐景目录走业务查询",17,muted)

rect(1440,621,377,141,"#f6f5fa","#8b87aa",18,dashed=True)
text(1465,662,"数据处理智能体服务",28,navy,680)
badge(1465,676,82,"预留",proposed,"#eae7f2")
text(1465,738,"拟议 A2A 受理处理并回传结果",20,proposed,550)

rect(1440,788,377,141,"#f6f5fa","#8b87aa",18,dashed=True)
text(1465,833,"统一表征数据服务（预留）",28,navy,680)
text(1465,872,"查询或获取统一表征数据",20,proposed,550)
text(1465,902,"返回数据、来源与版本",20,proposed,550)

spatial=1000
rect(1440,spatial,377,231,border="#d7e5e9",shadow=True)
text(1465,spatial+44,"时空数据服务",29,navy,680)
badge(1465,spatial+59,160,"内部服务")
text(1465,spatial+117,"覆盖业务查询",18,green,560)
text(1465,spatial+148,"签发权威范围、提供图层产物",19,muted)
text(1465,spatial+178,"后台同步发现方发布投影",18,muted)
text(1465,spatial+206,"覆盖查询使用本地 PostGIS 索引",18,muted)

rect(1940,260,403,156,border="#d7e5e9",shadow=True)
text(1965,307,"专业资料来源",28,navy,680)
text(1965,348,"论文断言只读、海纳与 STAC",22,muted)
text(1965,378,"发现服务按业务契约查取",19,muted)
rect(1940,458,403,168,"#fcf7f0","#ebd8c7",18,True)
text(1965,504,"公开网络供应商与原站",26,navy,680)
text(1965,548,"Bing、DataCite、DeepSeek",20,muted)
text(1965,580,"原站、PDF、公开归档索引",20,muted)

storage=1010
rect(1940,storage,403,222,border="#d7e5e9",shadow=True)
text(1965,storage+44,"Primary 持久存储",27,navy,680)
text(1965,storage+82,"PostgreSQL / PostGIS",21,muted)
text(1965,storage+116,"运行时、发现、时空各持有本域库",18,muted)
text(1965,storage+152,"Garage / S3",21,muted)
text(1965,storage+185,"图层与对象均在回环边界内",19,muted)

arrow("M 321 476 H 381","blue")
arrow("M 685 468 H 713 Q 731 468 731 450 V 413 Q 731 402 746 402 H 797","blue")
arrow("M 1296 544 H 1436","blue",True)
rect(1320,481,107,55,"#f4f8fa",None,6)
text(1372,498,"A2A",16,blue,680,"mono","middle")
text(1372,515,"目录 Message",14,blue,570,"","middle")
text(1372,531,"研究 Task",14,blue,570,"","middle")
arrow("M 1436 389 H 1297","purple",True)
rect(1321,343,99,32,"#f4f8fa",None,6)
text(1371,365,"工具回执",17,purple,620,"","middle")
arrow("M 1819 353 H 1935","green")
arrow(f"M 1819 {spatial+135} H 1935","green")

arrow("M 1296 589 H 1340 Q 1357 589 1357 607 V 672 Q 1357 689 1374 689 H 1436","proposed",True,True)
text(1368,639,"拟议 A2A",15,proposed,680)
text(1368,662,"委托／结果",14,proposed,620)
arrow("M 1319 618 Q 1330 618 1330 638 V 812 Q 1330 830 1348 830 H 1436","proposed",True,True,"unified-representation-a2a")
text(1349,796,"拟议 A2A",16,proposed,680)
text(1349,817,"委托／结果",16,proposed,620)

arrow("M 1848 955 V 578 Q 1848 558 1829 558 H 1821","green",dashed=True)
svg.append('<path d="M 1818 1021 H 1830 Q 1848 1021 1848 1008 V 982" fill="none" stroke="#3b6b60" stroke-width="3.7" stroke-dasharray="10 7"/>')
text(1871,633,"目录",17,green,600,"","middle")
text(1871,655,"同步",17,green,600,"","middle")
arrow("M 1296 850 H 1371 Q 1388 850 1388 867 V 951 Q 1388 969 1406 969 H 1876 Q 1895 969 1895 950 V 554 Q 1895 535 1913 535 H 1937","orange")
rect(1494,948,277,42,"#f9f2e9",None,8)
text(1515,976,"运行时适配层实际出站",20,orange,650)
arrow("M 796 432 H 761 V 1075 Q 761 1096 782 1096 H 1436","green")
rect(863,1075,262,42,"#eff5f5",None,8)
text(884,1103,"时空覆盖范围与修订",20,green,600)
arrow("M 551 621 V 1260 Q 551 1278 569 1278 H 1597 Q 1615 1278 1615 1260 V 1235","green",dashed=True)
rect(779,1257,336,43,"#eff5f5",None,8)
text(802,1286,"已发布地图与图层资源",20,green,600)

footer=1315
line(74,footer,2272,"#cddfe3")
text(76,footer+49,"一次公开网络研究",24,navy,675)
text(296,footer+49,"发现选择来源  →  运行时核准并执行  →  发现按原 Task 取回回执  →  运行时归档依据",23,muted)
text(76,footer+102,"灰紫色虚框和连线表示未来委托。现行网络工具调用、目录查询与图层传输均有各自路径。",22,blue)
svg.append("</svg>")
out.write_text("\n".join(svg),encoding="utf-8")
