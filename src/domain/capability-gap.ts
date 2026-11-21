import type { CapabilityGap, DiscoveryResponse } from "./types";

type Kind = CapabilityGap["operation"];
import { assetById } from "./datasets";

// These are statuses of the original requested deliverable. Product acceptance
// separately checks the data sources, access path and evidence actually returned.
const requestStatus = {
  extraction: "insufficient_evidence",
  fulfillment: "needs_data",
  inference: "cannot_perform_yet",
  computation: "cannot_perform_yet",
  development: "cannot_perform_yet",
  workflow: "cannot_perform_yet",
} as const;

// Curated variable/product aliases point to specific, inspectable catalog records.
// A discovery match alone never establishes coverage of the requested event.
const sourceAliases: { pattern: RegExp; assetId: string }[] = [
  {
    pattern: /\b(?:DEM|GLO-30|digital elevation model)\b|数字高程模型/i,
    assetId: "Q02-0",
  },
  { pattern: /\bCHIRPS\b/i, assetId: "Q01-1" },
  { pattern: /\bERA5-Land\b/i, assetId: "Q02-1" },
  { pattern: /\bERA5\b(?!-Land)/i, assetId: "Q10-1" },
  {
    pattern: /\b(?:OISST|SST|sea.surface temperature)\b|海表温度/i,
    assetId: "Q05-1",
  },
  { pattern: /\b(?:chlorophyll(?:-a)?|Chl-a)\b|叶绿素/i, assetId: "Q05-3" },
  {
    pattern: /\b(?:GRDC|river discharge|discharge gauges?)\b|河流流量/i,
    assetId: "Q16-1",
  },
  { pattern: /\b(?:MOD13Q1|NDVI)\b|归一化植被指数/i, assetId: "Q18-0" },
  {
    pattern: /\b(?:FLUXNET2015|FLUXNET|flux towers?)\b|通量塔/i,
    assetId: "Q09-0",
  },
  {
    pattern: /\b(?:OSM roads?|OpenStreetMap roads?)\b|OSM道路/i,
    assetId: "Q14-3",
  },
  { pattern: /\bAERONET\b/i, assetId: "Q12-3" },
  { pattern: /\b(?:soil moisture)\b|土壤水分/i, assetId: "Q16-6" },
  {
    pattern: /\b(?:MOD15A2H|leaf area index|LAI)\b|叶面积指数/i,
    assetId: "Q09-1",
  },
];
const requestPatterns: [Kind, RegExp][] = [
  [
    "workflow",
    /\b(?:tenant(?:s| isolation| policy)|paper.to.model.{0,35}(?:ingest|implement)|end.to.end (?:campaign|workflow)|campaign.{0,25}end.to.end|digitization pipeline|manuscript.grade export|belief.revision notification)\b|租户隔离|跨租户|数字化全流程|启动持续研究工作流/i,
  ],
  [
    "development",
    /\b(?:capabilitygapreport|capability gap|gap report|skill gap|creation plan|candidate (?:skill|surrogate|spec)|needs? (?:a )?[\w-]+ surrogate|domain extension|refusal.at.dispatch|(?:simulator|capability) (?:absent|is missing)|model.skill plan|model the platform lacks|not yet certified|(?:design|plan|upgrade).{0,70}(?:monitoring|network|sampling).{0,70}(?:uncertainty|budget|cost|voi)|voi.ranked|expert_or_partner_request|induce (?:a|the) candidate concept)\b|能力缺口报告|建立.*(?:验收门|验证基线)|设计.{0,12}(?:监测网|采样方案)|审批.{0,6}模型上线/i,
  ],
  [
    "computation",
    /\b(?:pre.registered|certified (?:\w+[ -]){0,3}(?:tool|model|adapter|inversion|operator)s?|co.simulation|recompute|replay manifest|simulate|run (?:a |an |the )?(?:[\w+-]+ ){0,4}(?:experiment|simulation|model|scenario)|hindcast|coupled [\w-]+ scenario|reconstructed position.{0,40}model)\b|实际运行|运行.{0,12}(?:模拟器|反演|模拟实验)|预注册实验|回放清单|求解.{0,6}模型/i,
  ],
  [
    "inference",
    /\b(?:posterior(?:s)?|probability (?:of|that)|marginalized over|compute the probability|causal attribution|calibrated probability|risk ranking with calibrated intervals)\b|计算.{0,12}(?:概率|置信区间)|后验(?:概率|分布)|概率归因/i,
  ],
  [
    "extraction",
    /\b(?:extract|digitize|transcribe|does (?:the |local )?evidence.{0,100}support|parse and georeference)\b|(?:从|基于).{0,60}(?:提取|逐条读取).{0,45}(?:要素|坐标|像元|实测数值|表格记录)|逐条提取/i,
  ],
  [
    "fulfillment",
    /\b(?:fulfill|assemble (?:the |an? )?(?:evidence|dataset|data bundle)|retrieve and (?:join|validate|download))\b|实际下载.{0,10}(?:数据包|文件)|检索并下载|交付.{0,10}(?:数据包|证据包)/i,
  ],
];

export function asksForResearchMaterial(q: string) {
  if (
    /^(?:please\s+)?(?:run|execute|simulate|extract|fulfill|recompute|digitize|transcribe)\b|^(?:请)?(?:实际运行|运行模拟|逐条提取|检索并下载)/i.test(
      q,
    )
  )
    return false;
  if (
    /(?:and then|and also|then)\s+(?:run|execute|estimate|compute|extract|download)|并(?:实际)?(?:运行|计算|提取|下载)|再(?:运行|计算|提取|下载)/i.test(
      q,
    )
  )
    return false;
  return /\b(?:find|look for|search for|looking for|where (?:can|do|to)|which|what)\b.{0,85}\b(?:data(?:sets?)?|sources?|products?|guides?|manuals?|documentation|references?|methods?)\b|\b(?:data(?:sets?)?|sources?|guides?|documentation)\b.{0,40}\b(?:need|available|can I use)\b|(?:需要|用|找|查找|检索|有哪些|推荐|提供).{0,14}(?:哪些|什么)?(?:数据|资料|来源|文档|方法说明)|(?:数据|资料|文档|方法).{0,12}(?:哪里|从哪|如何获取)/i.test(
    q,
  );
}

// Retain source names supplied by the requester even when no matching file was read.
const inputTerms =
  /\b(?:[A-Z][A-Z0-9]{1,10}(?:[-/][A-Z0-9]+)*|(?:Sentinel|Landsat|MODIS|Argo|ShakeMap|GPlates|InSAR|LiDAR|GRACE|GeoTIFF|NetCDF)(?:[- ][A-Z0-9]+)?|(?:assay|results|water.quality|measurement|gauge|calibration) tables?|(?:event|observatory|weather) bulletins?|(?:seismic|landslide|field|regional) inventor(?:y|ies)|(?:well|pumping|maintenance|management|injection) records?|(?:scanned|geological|velocity) maps?|station maxima|well hydrographs|facility registries|digitized layer|source files|drill cores?|(?:calibration|validation|training) data|(?:rainfall|discharge|gas|isotope|temperature) (?:series|gauges?|records?)|basin polygons|ice core|lake sediment|speleothem)\b|降水序列|井位|地震目录|卫星影像|取水记录|地质图|原始观测|矢量边界|气象站记录/g;
const nonInputs = new Set([
  "AND",
  "OR",
  "CRS",
  "QA",
  "QC",
  "UQ",
  "LOS",
  "CCS",
  "OCR",
  "ID",
]);

// Classify the requested work, independent of any question ID or rubric.
// Bare product names can occur as one input to an unrelated scientific task.
export function capabilityGap(q: string): DiscoveryResponse | undefined {
  if (
    asksForResearchMaterial(q) ||
    /^(?:what (?:is|are)|how does|explain|介绍|解释|什么叫|什么是)/i.test(q)
  )
    return;
  // A secondary clause about access or validation does not replace the primary deliverable.
  const directive = q
    .match(/^(?:please\s+)?(fulfill|extract|digitize|transcribe)\b/i)?.[1]
    ?.toLowerCase();
  const operation = directive
    ? directive === "fulfill"
      ? "fulfillment"
      : "extraction"
    : requestPatterns.find(([, pattern]) => pattern.test(q))?.[0];
  if (!operation) return;
  const lang = /[\u3400-\u9fff]/.test(q) ? 0 : 1;

  const referencedInputs = [
    ...new Set((q.match(inputTerms) || []).map((s) => s.trim())),
  ]
    .filter((s) => !nonInputs.has(s))
    .slice(0, 7);
  const candidates = sourceAliases.flatMap(({ pattern, assetId }) => {
    const input = q.match(pattern)?.[0],
      a = assetById.get(assetId);
    return input && a?.url
      ? [{ input, assetId, title: a.title, source: a.source, url: a.url }]
      : [];
  });
  const unmatchedInputs = referencedInputs.filter(
    (input) =>
      !candidates.some((c) => c.input.toLowerCase() === input.toLowerCase()),
  );
  const gap: CapabilityGap = {
    operation,
    status: requestStatus[operation],
    referencedInputs,
    dataSupport: { candidates, unmatchedInputs },
    missing:
      lang === 0
        ? "目标区域、时段、获准使用的版本及其实际覆盖需要核对。"
        : "The target area, dates, accessible versions and actual coverage still need verification.",
    next:
      lang === 0
        ? "请给出研究范围和时段，或一份原始文件，以便核对变量、版本及来源。"
        : "Provide the study area and dates, or a source file, to check variables, versions and provenance.",
    verification:
      lang === 0
        ? "按文件、表格行、文档页或像元位置核对可获得的数据，并记录缺件。"
        : "Verify accessible files, rows, pages or pixels and record missing inputs.",
  };
  const named = [
    ...new Set([...candidates.map((c) => c.input), ...referencedInputs]),
  ].join(lang === 0 ? "、" : ", ");
  const message =
    lang === 0
      ? [
          named && "题中涉及的资料：" + named + "。",
          candidates.length
            ? "当前目录找到 " +
              candidates.length +
              " 条相关来源，可打开核对用途与获取方式。具体研究范围内的可用性待核。"
            : "当前目录尚未匹配到可核对的具体来源。",
          gap.next,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          named && "Data mentioned in the request: " + named + ".",
          candidates.length
            ? candidates.length +
              " related catalog sources are available for inspection. Event-specific coverage is unverified."
            : "No specific source match has been verified in the current catalog.",
          gap.next,
        ]
          .filter(Boolean)
          .join("\n");
  return { message, gap };
}
