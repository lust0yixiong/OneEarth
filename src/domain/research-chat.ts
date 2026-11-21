import { interpretations } from "./interpretation";
import { cases, caseById, resources } from "./catalog";
import { assets } from "./datasets";
import { candidates, spatialRelation } from "./results";
import { needVisible } from "./spatial";
import type {
  CaseStudy,
  DiscoveryContext,
  DiscoveryResponse,
  ResearchAnswer,
} from "./types";

// Distinctive study concepts supplement the original question titles and IDs.
const topics: [string, RegExp][] = [
  [
    "Q20",
    /湖终止|湖水深|lake.?terminating|冰川.*(?:入湖|崩解)|(?:阿拉斯加|加拿大).*湖泊/i,
  ],
  ["Q19", /79\s*(north|n|度)|Nioghalvfjerd|格陵兰.*(?:冰量|温盐|冰舌)/i],
  [
    "Q02",
    /冰川.{0,8}(?:质量|物质|收支)平衡|冰川.*逐时气象|DEM.*冰川边界|冰川.*收支|glacier mass balance/i,
  ],
  [
    "Q07",
    /(?:青藏|高原西部|西藏).*(?:雪|snow)|(?:雪深|积雪).*高原|tibetan.*snow/i,
  ],
  ["Q14", /巴[尔特]滕|Bart[iı]n|(?:土耳其|生态系统).*自然度/i],
  ["Q01", /酒庄|农业旅游|葡萄园|葡萄酒|农旅|wine.?tourism/i],
  ["Q03", /稀树草原|小型哺乳|小兽|savanna|草原.*啮齿/i],
  ["Q04", /臭氧|ozone|东亚季风.*O3/i],
  ["Q05", /珊瑚|coral/i],
  ["Q06", /粒雪|firn|格陵兰.*(?:储水|滞水|蓄水|融水)/i],
  ["Q08", /\bPDO\b|海冰.*(?:年代际|年际|太平洋)|太平洋年代际/i],
  ["Q09", /叶面积|通量塔|\bFLUXNET(?:2015)?\b|\bLAI\b|陆气.*通量/i],
  [
    "Q10",
    /近全球|WPS|WRF(?![- ]?Chem).*?(?:季节|边界|地形|地理场)|对流尺度|对流分辨|对流许可|(?:区域|季节).*对流.*模拟/i,
  ],
  ["Q11", /幸福感|生活满意度|主观福祉|绿地.*(?:福祉|幸福)/],
  ["Q12", /沙尘|起沙|WRF.?Chem/i],
  ["Q13", /融池|融水塘|微波亮温|融水池|melt.?pond/i],
  ["Q15", /SDPP|BAMSE|AMIGO|PIAMA|搬迁|迁居|搬家|全暴露组|迁址/i],
  [
    "Q16",
    /撒哈拉以南|当地利益相关方|(?:非洲|马拉维|赞比西).*(?:水文|径流|流域|灌区|地下水|取水)|(?:灌区|灌溉).*(?:径流|流量|地下水|取水井|实际用水)/,
  ],
  [
    "Q17",
    /粮食安全|食物保障|食物安全|南非.*(?:家庭|农户)|贝叶斯信念网络|\bBBN\b/i,
  ],
  [
    "Q18",
    /返青|green.?up|内蒙古.*(?:物候|生长季)|草原.*物候|(?:草地|草原|NDVI).*春季.*(?:上升|开始|起始)|NDVI.*生长季.*(?:开始|起点)/i,
  ],
  ["dongting", /洞庭湖|城陵矶/],
  ["manaus", /马瑙斯|内格罗/],
  ["glacier", /冰川(?:融化|退缩|消融)/],
];
export function identifyCase(query: string) {
  const q = query.trim();
  const exact = cases.find((c) => c.question === q || c.title === q);
  if (exact) return exact.id;
  const numbered = q.match(/(?:\bQ\s*0?(\d{1,2})(?!\d)|第\s*(\d{1,2})\s*题)/i);
  if (numbered) {
    const id = "Q" + (numbered[1] || numbered[2]).padStart(2, "0");
    if (caseById(id)) return id;
  }
  return topics.find(([, pattern]) => pattern.test(q))?.[0];
}

const synonyms = [
  ["降水", "降雨", "雨量"],
  ["地表温度", "地温", "LST"],
  ["水分平衡", "水量平衡"],
  ["植被指数", "NDVI"],
  ["质量掩膜", "QA", "质量控制", "云掩膜"],
  ["土地利用", "土地覆盖", "地类"],
  ["逐时气象", "小时气象", "逐小时"],
  ["DEM", "数字高程", "海拔"],
  ["冰川边界", "冰川轮廓"],
  ["温盐", "CTD", "盐度"],
  ["雪深", "积雪深度"],
  ["通量塔", "涡度协方差"],
  ["探空", "高空气球"],
  ["海冰范围", "海冰面积"],
  ["PDO", "年代际指数"],
  ["静态地理场", "WPS", "地形场"],
  ["初始和侧边界", "初边值", "侧边界"],
  ["队列地址", "住址", "居住史", "地址", "住宅历史"],
  ["污染物", "空气污染", "PM2.5"],
  ["噪声", "噪音"],
  ["静态地理", "下垫面"],
  ["径流", "流量"],
  ["幸福感", "生活满意度"],
  ["协变量", "混杂因素"],
  ["冰流速", "冰川流速"],
  ["湖水深", "湖深", "测深"],
  ["冰前缘", "前缘线"],
];
const normal = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s/·、（）()\-]+/g, "");
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const common = new Set([
  "数据",
  "需要",
  "相关",
  "研究",
  "空间",
  "资料",
  "变化",
  "覆盖",
  "范围",
  "当前",
  "时段",
  "这项",
  "获取",
  "查看",
]);
export function matchRoles(c: CaseStudy, query: string): number[] {
  const q = normal(query);
  return c.needs.flatMap((n, i) => {
    const name = normal(n.name);
    const terms = Array.from(segmenter.segment(n.name), (p) =>
      normal(p.segment),
    ).filter((s) => s.length >= 2 && !common.has(s));
    const aliases = synonyms
      .filter((group) => group.some((v) => name.includes(normal(v))))
      .flat();
    const products = assets
      .filter((a) => a.caseId === c.id && a.needIndex === i)
      .flatMap((a) => [
        a.title,
        ...(a.title.normalize("NFKC").match(/[a-z][a-z0-9-]{2,}/gi) || []),
      ]);
    return [name, ...terms, ...aliases, ...products].some((t) =>
      q.includes(normal(t)),
    )
      ? [i]
      : [];
  });
}

export function researchAnswer(
  c: CaseStudy,
  context: DiscoveryContext,
  intent: ResearchAnswer["intent"],
  roles?: number[],
): DiscoveryResponse {
  const { filters, selection, layer } = context;
  const wanted =
    roles ||
    c.needs.map((_, i) => i).filter((i) => needVisible(c.id, i, filters));
  const roleFilter = roles?.length === 1 ? roles[0] : roles ? -1 : filters.need;
  const scope =
    roleFilter === filters.need ? filters : { ...filters, need: roleFilter };
  const rows = wanted.map((index) => {
    const need = c.needs[index];
    const resource = resources.find(
      (r) => r.caseId === c.id && r.needIndex === index,
    )!;
    const matches = candidates(
      c.id,
      { ...scope, need: index },
      layer,
      selection,
    );
    const references =
      !matches.length && scope.period
        ? candidates(
            c.id,
            { ...scope, need: index, period: null },
            layer,
            selection,
          )
        : [];
    const first = matches[0];
    const detail =
      intent === "coverage"
        ? first
          ? [
              first.profile?.coverage,
              spatialRelation(first, scope, selection, layer),
            ]
              .filter(Boolean)
              .join(" · ")
          : "当前条件下未匹配到候选，覆盖待核。"
        : intent === "access"
          ? first?.profile?.access ||
            (first?.url
              ? "从" + first.source + "的来源入口核对获取方式。"
              : "当前目录未列出可核对的获取入口。")
          : resource.profile?.limitation || resource.why;
    return {
      index,
      name: need.name,
      detail,
      ids: matches.map((a) => a.id),
      ...(references.length ? { references: references.map((a) => a.id) } : {}),
    };
  });
  const ids = [...new Set(rows.flatMap((r) => r.ids))];
  const result = {
    overview:
      "已按 " +
      rows.length +
      " 项研究需求整理出 " +
      ids.length +
      " 份候选资料。" +
      (scope.period && rows.some((r) => r.references)
        ? "另列出了研究期仍待核对的来源。"
        : ""),
    access: "按需求列出了发布方和获取途径。",
    coverage: "以下为当前研究范围内的目录覆盖说明和空间依据。",
    gap: c.gap,
    fit: c.gap,
    role:
      "已找到与“" +
      rows.map((r) => r.name).join("、") +
      "”相关的 " +
      ids.length +
      " 份候选资料。",
  };
  return {
    message: result[intent],
    ...(scope !== filters ? { filters: scope } : {}),
    research: {
      caseId: c.id,
      intent,
      rows,
      steps: [
        { title: "匹配研究问题", detail: c.id + " · " + c.title },
        {
          title: "读取数据需求",
          detail: rows.map((r) => r.name).join("、") || "当前筛选没有可见需求",
        },
        {
          title: "检索当前目录",
          detail:
            ids.length + " 份候选。已按当前来源、区域、时间及网格选区筛选。",
        },
      ],
    },
  };
}

// A suitability question asks what an observation can support. It does not
// authorize a change to the user's time window, map, or active role.
export function asksAboutFit(q: string) {
  if (/(?:如何|怎么|哪里|从哪).*(?:申请|获取|下载|访问)/.test(q)) return false;
  return (
    /(?:能否|能不能|是否|可以|能直接|就能|足以|充当|代表|当作|当成|替代|代替|等于|证明|复现|意味着|无需|不用|不需要|适合|适用|局限|限制|能自动|能当|可直接|满足.{0,20}吗|可靠吗|对吗)/.test(
      q,
    ) &&
    !/(?:能否|是否可以|可以|能不能).{0,4}(?:帮我|请你|打开|预览|切换|查看|显示|播放)/.test(
      q,
    )
  );
}

const contentWords = (input: string) =>
  new Set(
    Array.from(segmenter.segment(input.toLowerCase()), (s) => s.segment).filter(
      (s) =>
        s.length > 1 &&
        !common.has(s) &&
        !/^(?:可以|直接|需要|是否|已经|不能|当前|研究|输入)$/.test(s),
    ),
  );

export function assessFit(
  c: CaseStudy,
  context: DiscoveryContext,
  q: string,
): DiscoveryResponse {
  const note = interpretations[c.id]?.find((item) => item.topic.test(q));
  if (note) {
    const selected = c.needs.flatMap((n, i) =>
      note.roles.includes(n.name) ? [i] : [],
    );
    const answer = researchAnswer(c, context, "fit", selected);
    delete answer.filters;
    return { ...answer, message: note.answer };
  }
  const roles = matchRoles(c, q);
  const terms = contentWords(q);
  const overlap = (s: string) =>
    [...contentWords(s)].filter((term) => terms.has(term)).length;
  const relevant = c.needs
    .map((need, i) => {
      const relation = resources.find(
        (r) => r.caseId === c.id && r.needIndex === i,
      )!;
      const detail = need.profile?.limitation || relation.why;
      const parts = [need.detail];
      if (!need.detail.includes(detail)) parts.push(detail);
      if (need.profile && /单位|百分比|平方|阈值|分辨率|尺度/.test(q))
        parts.push(need.profile.coverage);
      if (need.profile && /下载|申请|授权|公开/.test(q))
        parts.push(need.profile.access);
      return {
        index: i,
        statement: parts.filter(Boolean).join(""),
        score:
          Math.max(
            overlap(need.detail),
            overlap(need.profile?.coverage || ""),
          ) + (roles.includes(i) ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);
  const chosen = relevant.filter((r) => r.score > 0).slice(0, 2);
  const selected = chosen.length ? chosen.map((r) => r.index) : undefined;
  const answer = researchAnswer(c, context, "fit", selected);
  delete answer.filters;
  answer.message = [
    c.gap,
    ...chosen.map((r) => c.needs[r.index].name + " · " + r.statement),
  ].join("\n");
  return answer;
}
