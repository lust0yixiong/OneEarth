import { findOpticalData } from "./earth-search";
import { combinesSources } from "./research-question";
import { candidates } from "./results";
import { evidenceFor } from "./evidence";
import { asksForResearchMaterial, capabilityGap } from "./capability-gap";
import { assets } from "./datasets";
import {
  assessFit,
  asksAboutFit,
  identifyCase,
  matchRoles,
  researchAnswer,
} from "./research-chat";
export { identifyCase } from "./research-chat";
import { discoverWind } from "./wind-discovery";
import { dataCamera, eligibleStations } from "./visualization";
import { cases, caseById } from "./catalog";
import {
  fitCamera,
  emptyFilters,
  spatialEntries,
  localEntries,
  getModel,
} from "./spatial";
import tables from "../data/evidence/research-tables.json";
import { s2Levels } from "../data/evidence/research-grid.mjs";
import { zoomBands } from "../data/evidence/globe-navigation.mjs";
import type {
  CaseStudy,
  DiscoveryContext,
  DiscoveryResponse,
  Filters,
} from "./types";
const periodPattern =
  /(?<![a-z0-9])((?:19|20)\d\d)(?!\d)(?:\s*年?\s*[至到–—~～-]\s*((?:19|20)\d\d))?/i;
const depthPattern =
  /(\d+(?:\.\d+)?)\s*(?:米|m)?\s*[至到–—~～-]\s*(\d+(?:\.\d+)?)\s*(?:米|m)/i;
const demLimitPattern =
  /(?:DEM|高程).*?(\d+(?:\.\d+)?)\s*(?:米|m)\s*(?:以内|以下|上限)/i;

function queryYears(q: string) {
  const withoutMeasurements = q
    .replace(depthPattern, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:千米|公里|米|km\b|m\b|hPa\b)/gi, " ");
  return withoutMeasurements.match(periodPattern);
}

function queryScope(c: CaseStudy, q: string, initial: Filters) {
  const filters = { ...initial };
  const labels: string[] = [];
  const years = queryYears(q);
  if (years) {
    filters.period = [+years[1], +(years[2] || years[1])];
    if (filters.period[1] < filters.period[0])
      return { error: "结束年份早于起始年份，请调整时段。" } as const;
    labels.push(filters.period.join("–") + " 年");
  }
  const depth = c.id === "Q19" && q.match(depthPattern);
  if (depth) {
    filters.depth = [+depth[1], +depth[2]];
    if (filters.depth[1] < filters.depth[0])
      return { error: "结束深度应大于或等于起始深度。" } as const;
    filters.need = 4;
    labels.push(filters.depth.join("–") + " m");
  }
  const dem = c.id === "Q02" && q.match(demLimitPattern);
  if (dem) {
    filters.maxDem = +dem[1];
    labels.push("DEM ≤ " + filters.maxDem + " m");
  }
  const focus = q.match(/(?:只看|仅看|只需|仅需|只要|限定为|只找)\s*(.+)/)?.[1];
  const roles = focus ? matchRoles(c, focus) : [];
  if (roles.length === 1) filters.need = roles[0];
  if (roles.length) labels.push(roles.map((i) => c.needs[i].name).join("、"));
  const place = getModel(c.id).places?.find(
    ([label, term]) =>
      q.toLowerCase().includes(term.toLowerCase()) ||
      q.includes(label.replace(/(?:南部)?窗口$/, "")),
  );
  if (place) {
    filters.place = place[1];
    labels.push(place[0]);
  }
  return { filters, roles, labels };
}

export function discover(
  query: string,
  context: DiscoveryContext,
): DiscoveryResponse {
  const q = query.trim();
  const gap = capabilityGap(q);
  if (gap) return gap;
  const key = identifyCase(q);
  if (!key && !context.citation) {
    const optical = findOpticalData(q);
    if (optical) return optical;
  }
  const c = caseById(context.caseId);
  const filters = structuredClone(context.filters);
  const explicitCase =
    cases.some((item) => item.question === q || item.title === q) ||
    /(?:^|\b)Q\s*\d{1,2}(?!\d)/i.test(q);
  const activeRoles = c ? matchRoles(c, q) : [];
  const scopedQuestion =
    activeRoles.length > 0 &&
    !explicitCase &&
    /只看|这项|这份|其中|能下载|该怎么|如何获取|哪里下载|覆盖如何/.test(q);
  if (
    key &&
    key !== "wind" &&
    (!c || (key !== c.id && !scopedQuestion) || explicitCase)
  ) {
    const found = caseById(key)!;
    const scope = queryScope(found, q, emptyFilters());
    if ("error" in scope && scope.error) return { message: scope.error };
    const fresh = scope.filters!;
    const camera = fitCamera(key, fresh, "all") || {
      center: [105, 25] as [number, number],
      zoom: 1,
      reason: "当前条件无已核空间样本，显示全球目录视图。",
    };
    const answer = researchAnswer(
      found,
      {
        ...context,
        caseId: key,
        filters: fresh,
        selection: null,
        layer: "all",
      },
      scope.roles?.length ? "role" : "overview",
      scope.roles?.length ? scope.roles : undefined,
    );
    return {
      ...answer,
      caseId: key,
      filters: fresh,
      layer: "all",
      clearSelection: true,
      camera,
      message:
        found.spatial === "station"
          ? found.needs[0].detail + "\n" + found.gap
          : answer.message +
            (scope.labels?.length
              ? " 当前限定为" + scope.labels.join("、") + "。"
              : "") +
            (found.verified
              ? " 地球显示已核查的空间依据。"
              : " 各发布方的覆盖说明见资料速览，样区实测覆盖仍待核对。"),
    };
  }
  if (
    /^(?:打开|查看|回到|返回|浏览|进入|切换到?)?(?:全部)?(?:研究问题库|问题库|研究案例|案例库|案例列表)[。！？?]?$/.test(
      q,
    )
  )
    return {
      view: "cases",
      message: "已打开研究案例，可选择问题并继续查找资料。",
    };
  if (
    /^(?:打开|查看|回到|返回|浏览|进入|切换到?)?(?:全部|完整)?(?:数据目录|候选目录|数据触达|资料目录)[。！？?]?$/.test(
      q,
    )
  )
    return {
      view: "discover",
      catalogQuery: "",
      message: "已打开完整数据目录。",
    };
  if (
    /^(?:打开|查看|回到|返回|进入|切换到?)?(?:数据地球|地球视图|地图)[。！？?]?$/.test(
      q,
    )
  )
    return { view: "earth", message: "已回到当前研究范围的数据地球。" };
  const windAnswer = discoverWind(q, context);
  if (windAnswer) return windAnswer;
  if (context.citation && /依据|这张表|这份|引用|这段|这页/.test(q))
    return { message: context.citation.title + "\n" + context.citation.body };
  if (/返回全景|退出研究|回到全球/.test(q))
    return {
      caseId: null,
      filters: emptyFilters(),
      clearSelection: true,
      camera: { center: [105, 25], zoom: 1, reason: "全球空间分布总览" },
      message: "已回到全球数据分布。",
    };
  const grid = q.match(/S2\s*L(5|6|8|9|11|12)\b|H3\s*R([2-7])\b|\bR([2-7])\b/i);
  if (grid) {
    const system = grid[1] ? "s2" : "h3";
    const band = grid[1]
      ? s2Levels.indexOf(+grid[1]) + 2
      : +(grid[2] || grid[3]);
    return {
      gridSystem: system,
      clearSelection: false,
      camera: {
        ...context.camera,
        zoom: zoomBands[band - 2],
        reason: "用户指定 " + (system === "h3" ? "R" + band : "L" + grid[1]),
      },
      message: "已按指定网格层级更新视野，已选网格保留原始范围。",
    };
  }
  if (/S2|H3/i.test(q) && !/为什么|是否/.test(q))
    return {
      gridSystem: /S2/i.test(q) ? "s2" : "h3",
      clearSelection: true,
      message: "已切换网格体系，并按原始位置重新聚合。",
    };
  if (/放大|拉近|缩小|拉远/.test(q))
    return {
      camera: {
        ...context.camera,
        zoom: Math.min(
          2200,
          Math.max(
            1,
            context.camera.zoom * (/缩小|拉远/.test(q) ? 1 / 2.65 : 2.65),
          ),
        ),
        reason: "按对话调整视野",
      },
      message: "已调整球面视野。查询选区保留。",
    };
  if (/中心网格/.test(q))
    return {
      selectCenter: true,
      message: "已选中当前视野中心网格。可以预览此格定位依据或继续追问。",
    };
  if (/为什么.*(?:级|网格)|选级规则/.test(q))
    return {
      message:
        context.camera.reason +
        "\n初始层级取能容纳全部已定位结果并留出边距的最细显示档。缩放改变显示层级，选区保留其原始范围。",
    };
  if (
    !c &&
    context.selection &&
    !context.selection.simulated &&
    /这里|此格|选中/.test(q)
  ) {
    const found = candidates(null, filters, "all", context.selection);
    return {
      message: found.length
        ? found
            .map((a) => (a.caseId === "wind" ? "全球覆盖 · " : "") + a.title)
            .join("\n")
        : "所选网格当前没有匹配的候选资料。",
    };
  }
  const search = q.match(
    /^(?:在(?:全部|数据)?目录(?:中|里)?\s*)?(?:搜索|搜一下|查找|检索|找一下|找)\s*(.+?)(?:的数据集|的资料)?[。？！?]?$/,
  );
  if (search && (!c || /目录/.test(q))) {
    const term = search[1].trim();
    return {
      view: "discover",
      catalogQuery: term,
      message: "已在数据目录中搜索“" + term + "”。",
    };
  }
  if (!/[\u3400-\u9fff]/.test(q) && asksForResearchMaterial(q)) {
    const terms = q.match(/\b[A-Z][A-Z0-9_-]{1,}\b/g) || [];
    const term = terms.find((t) =>
      assets.some((a) => a.title.toUpperCase().includes(t)),
    );
    if (term)
      return {
        view: "discover",
        catalogQuery: term,
        message: "Opened the catalog search for " + term + ".",
      };
    return {
      message:
        "Which study region, observation, or product should I look for in the research catalog?",
    };
  }
  if (!c)
    return {
      message:
        "当前研究问题库还没有匹配到这个主题。你要研究哪个区域、时段和观测变量？也可以直接输入“搜索”加上产品名，在资料目录中查找。",
    };
  const active = context.dataView;
  if (active?.kind === "ctd") {
    if (
      /(?:切换|改为|显示|查看|只看).*(?:温度|盐度)/.test(q) &&
      !/\d\s*(?:米|m)?\s*[至到–—~-]\s*\d/i.test(q)
    ) {
      const next = {
        ...active,
        variable: /盐度/.test(q)
          ? ("salinity" as const)
          : ("temperature" as const),
      };
      const depth = q.match(/(\d+(?:\.\d+)?)\s*(?:米|m)/i);
      if (depth && +depth[1] <= 600) next.depth = +depth[1];
      return {
        dataView: next,
        clearSelection: true,
        message: "已切换数据变量与采样层，球面色标和剖面图同步更新。",
      };
    }
    const level = q.match(
      /(?:采样层|采样深度|目标深度|水深)(?:设为|设置为|改为|到|为)?\s*(\d+(?:\.\d+)?)\s*(?:米|m)/i,
    );
    if (level) {
      const depth = +level[1];
      if (depth > 600)
        return {
          message:
            "这批历史剖面的最深观测约 598 米，可选择 0–600 米并核对有无实测层。",
        };
      return {
        dataView: { ...active, depth },
        clearSelection: true,
        message:
          "已把球面目标采样层设为 " +
          depth +
          " m，使用 ±5 m 内最近实测层。缺测网格留空。",
      };
    }
    const day = q.match(
      /(?:采样日|日期|切到|查看).*?((?:19|20)\d{2}-\d{2}-\d{2})/,
    );
    if (day) {
      const station = eligibleStations(filters).find((s) =>
        s.date.startsWith(day[1]),
      );
      if (!station)
        return { message: "当前资料和筛选条件下没有这个采样日的观测。" };
      const next = { ...active, stationId: station.name };
      return {
        dataView: next,
        camera: dataCamera(next),
        clearSelection: true,
        message: "已切换到 " + day[1] + " 的真实采样站次。",
      };
    }
  }
  if (active?.kind === "front" && /首期|末期|对照|Mendenhall|Alsek/i.test(q)) {
    const next = { ...active };
    if (/首期/.test(q)) next.epoch = "first";
    else if (/末期/.test(q)) next.epoch = "last";
    else if (/对照/.test(q)) next.epoch = "compare";
    if (/Mendenhall/i.test(q)) next.glacier = "Mendenhall";
    if (/Alsek/i.test(q)) next.glacier = "Alsek";
    return {
      dataView: next,
      camera: dataCamera(next),
      clearSelection: true,
      message:
        "已更新 " + next.glacier + " 的实际前缘显示，日期与球面图层同步。",
    };
  }
  if (asksAboutFit(q) && !/同地|同一处|选级规则/.test(q)) {
    const bound = q.match(demLimitPattern);
    if (c.id === "Q02" && bound) {
      const metres = +bound[1];
      return {
        message:
          "GLO-30 的标称网距为 30 米，" +
          (metres < 30
            ? "未满足 " + metres + " 米以内的要求。"
            : "满足该名义网距上限，仍需核对研究区质量与时相。"),
      };
    }
    return assessFit(c, context, q);
  }
  if (["dongting", "manaus"].includes(c.id)) {
    if (/趋势|十年|入枯|提前/.test(q)) return { message: c.gap };
    if (/水位|低了|相差|变化/.test(q)) return { message: c.needs[0].detail };
  }
  if (/共同可用|联合可用|共同覆盖|一起用/.test(q))
    return { layer: "joint", message: c.gap };
  if (/同地|同一处/.test(q) && c.id === "Q02")
    return {
      layer: "paired",
      message:
        "两处实读 DEM 像元均位于对应 RGI 轮廓内。已在球面高亮这两处空间核验结果。气象序列与研究期的配对仍待核查。",
    };
  if (/缺口|缺项|还缺|还差|够不够|缺少|不足|缺什么|还要补|还需要补/.test(q))
    return researchAnswer(
      c,
      context,
      "gap",
      activeRoles.length ? activeRoles : undefined,
    );
  if (/清除筛选|全部需求/.test(q))
    return {
      filters: emptyFilters(),
      layer: "all",
      clearSelection: true,
      message: "已恢复此问题的全部需求和空间证据。",
    };
  if (/清除选区|取消选中/.test(q))
    return {
      clearSelection: true,
      message: "已清除网格选区，保留当前任务和筛选。",
    };
  if (
    /覆盖范围|覆盖如何|覆盖哪些|时空覆盖|什么地方|能用在哪|空间范围|时间范围|什么区域|哪些年份|怎么看覆盖|查看覆盖|覆盖情况/.test(
      q,
    )
  ) {
    return researchAnswer(
      c,
      context,
      "coverage",
      activeRoles.length ? activeRoles : undefined,
    );
  }
  if (
    /获取|下载|申请|哪里找|哪里有|怎么拿|从哪|开放吗|访问方式|数据源|什么来源|发布方/.test(
      q,
    )
  ) {
    return researchAnswer(
      c,
      context,
      "access",
      activeRoles.length ? activeRoles : undefined,
    );
  }
  if (
    /按.{0,3}(?:需求|角色)|需要什么数据|需要哪些|有哪些资料|哪些数据|候选资料|列出.*数据|推荐.*资料/.test(
      q,
    )
  )
    return researchAnswer(
      c,
      context,
      activeRoles.length ? "role" : "overview",
      activeRoles.length ? activeRoles : undefined,
    );
  if (/PDF|预览|查看材料|查看证据|表格/i.test(q) && !/多少|在哪/.test(q)) {
    const kind = /PDF/i.test(q)
      ? "pdf"
      : /表格|原表/.test(q)
        ? "table"
        : undefined;
    const scoped = activeRoles.length
      ? activeRoles
      : filters.need >= 0
        ? [filters.need]
        : c.needs.map((_, i) => i);
    const indices =
      c.id === "Q07" && !kind && !activeRoles.length && filters.need < 0
        ? [2, ...scoped]
        : scoped;
    for (const index of indices) {
      const doc = evidenceFor(
        c.id,
        index,
        filters,
        undefined,
        undefined,
        context.selection,
      );
      const tab = doc.tabs.find(
        (t) =>
          t.kind !== "web" &&
          (t.kind !== "table" || !!t.rows?.length) &&
          (!kind || t.kind === kind),
      );
      if (tab)
        return {
          previewNeed: index,
          previewKind: tab.kind,
          message: "已打开“" + tab.label + "”。",
        };
    }
    const asset = candidates(
      c.id,
      { ...filters, need: scoped.length === 1 ? scoped[0] : filters.need },
      context.layer,
      context.selection,
    )[0];
    return {
      ...(asset ? { inspectId: asset.id } : {}),
      message:
        "当前资料没有可预览的" +
        (kind === "pdf"
          ? " PDF 原页"
          : kind === "table"
            ? "原始表格"
            : "本地材料") +
        (asset
          ? "。已打开“" + asset.title + "”的速览，可核对发布方和获取方式。"
          : "。可调整需求或筛选范围后再试。"),
    };
  }
  if (
    /打开|预览|看一下/.test(q) &&
    activeRoles.length === 1 &&
    !/PDF|表格|可视化|剖面/i.test(q)
  ) {
    const index = activeRoles[0];
    const scoped = { ...filters, need: index, type: "" };
    const asset = candidates(
      c.id,
      scoped,
      context.layer,
      context.selection,
    ).find((a) => a.needIndex === index);
    if (asset)
      return {
        inspectId: asset.id,
        message:
          "已打开“" + asset.title + "”的数据速览，可查看内容和获取途径。",
      };
  }
  if (/可视化|打开数据|查看数据|画.*剖面|显示.*剖面/.test(q)) {
    if (c.id === "Q19")
      return {
        visualizeNeed: 4,
        message:
          "已打开真实温盐数据。球面按同一采样日、目标深度附近的实测值着色，底部显示所选站次的温盐剖面。可切换变量、站次和深度。",
      };
    if (c.id === "Q20")
      return {
        visualizeNeed: 1,
        message:
          "已打开作者提供的冰川首末前缘线。可以切换冰川与实际时相，在地球上查看地理形状和变化。",
      };
    return {
      message:
        "当前这份资料的数据内容可视化仍待接入。现有材料可以核查来源、规格和已读样本。",
    };
  }
  if (
    /高程|海拔|像元|DEM/i.test(q) &&
    /多少|多高|数值|几米/.test(q) &&
    c.id === "Q02"
  ) {
    const rows = context.selection
      ? localEntries(c.id, filters, context.layer, context.selection)
      : spatialEntries(c.id, filters, context.layer);
    const found = rows.filter((e) => e.need === 0);
    return {
      message: found.length
        ? found.map((e) => e.label + " · " + e.origin).join("\n") +
          "\n样本像元中心在对应冰川轮廓内。"
        : "当前选区或筛选下尚无实读高程像元。",
    };
  }
  if (/这里|此格|这格|选中的网格/.test(q)) {
    if (!context.selection)
      return { message: "请先点选一个网格，或说“查看中心网格”。" };
    const entries = localEntries(
      c.id,
      filters,
      context.layer,
      context.selection,
    );
    return {
      message: entries.length
        ? "此格有 " +
          entries.length +
          " 条定位依据。\n" +
          entries
            .slice(0, 5)
            .map((e) => e.label + " · " + e.origin)
            .join("\n")
        : "当前选区内暂无符合条件的已核定位依据。",
    };
  }
  const limit = q.match(demLimitPattern);
  if (limit && c.id === "Q02") {
    filters.maxDem = +limit[1];
    return {
      filters,
      clearSelection: true,
      message:
        filters.maxDem < 30
          ? "已限定 DEM ≤ " +
            filters.maxDem +
            " m。本次核查的 GLO-30 为 30 米级，当前候选未满足该上限。"
          : "已更新分辨率上限，局部质量和时间条件仍需核查。",
    };
  }
  const depth = q.match(depthPattern);
  if (depth && c.id === "Q19") {
    const lo = +depth[1],
      hi = +depth[2];
    if (hi < lo) return { message: "结束深度应大于或等于起始深度。" };
    const scope = queryScope(c, q, filters);
    if ("error" in scope && scope.error) return { message: scope.error };
    Object.assign(filters, scope.filters);
    filters.depth = [lo, hi];
    filters.need = 4;
    filters.type = "";
    const entries = spatialEntries(c.id, filters, "all");
    const archive = tables.ctd as Record<string, (number | null)[][]>;
    const total = entries.reduce(
      (n, e) =>
        n +
        (archive[e.label] || []).filter(
          (r) => r[0] !== null && r[0] >= lo && r[0] <= hi,
        ).length,
      0,
    );
    return {
      filters,
      layer: "all",
      clearSelection: true,
      message:
        "深度范围与 " +
        lo +
        "–" +
        hi +
        " m 相交的站次有 " +
        entries.length +
        " 个。原始表内符合深度条件的观测为 " +
        total.toLocaleString() +
        " 行，可在预览中核对温度、盐度与缺测。",
    };
  }
  const years = queryYears(q);
  if (years) {
    const scope = queryScope(c, q, filters);
    if ("error" in scope && scope.error) return { message: scope.error };
    return {
      filters: scope.filters,
      clearSelection: true,
      message:
        "已限定 " +
        scope.labels!.join("、") +
        "。球面仅计入具有明确年份的记录，未定年的资料仍保留在需求清单。",
    };
  }
  const place = getModel(c.id).places?.find(
    ([label, term]) =>
      q
        .toLowerCase()
        .includes(label.replace(/(?:南部)?窗口$/, "").toLowerCase()) ||
      q.toLowerCase().includes(term.toLowerCase()),
  );
  if (place) {
    filters.place = place[1];
    const camera = fitCamera(c.id, filters, context.layer);
    return {
      filters,
      clearSelection: true,
      ...(camera ? { camera } : {}),
      message: "已聚焦 " + place[0] + "，其余需求和筛选条件保留。",
    };
  }
  const source = !combinesSources(q) && q.match(/海纳|专家|科学家|论文线索|公开发布/);
  if (source) {
    filters.source = {
      海纳: "haina",
      专家: "expert",
      科学家: "expert",
      论文线索: "paper",
      公开发布: "public",
    }[source[0]]!;
    return {
      filters,
      clearSelection: true,
      message:
        filters.source === "haina" || filters.source === "expert"
          ? "本题尚无这个来源已核实的身份关系。可切回全部来源继续查看公开材料。"
          : "已更新发现来源筛选。",
    };
  }
  if (
    activeRoles.length &&
    /只看|聚焦|查看|找|推荐|能用|有什么|有哪些|呢|资料|数据|方案/.test(q)
  ) {
    const next =
      activeRoles.length === 1
        ? { ...filters, need: activeRoles[0], type: "" }
        : filters;
    const answer = researchAnswer(
      c,
      { ...context, filters: next },
      "role",
      activeRoles,
    );
    return { ...answer, filters: next };
  }
  if (/只看|聚焦|查看/.test(q)) {
    const i = c.needs.findIndex(
      (n) =>
        q.includes(n.name) ||
        (/气象/.test(n.name) && /气象/.test(q)) ||
        (/DEM/.test(n.name) && /DEM/i.test(q)),
    );
    if (i >= 0) {
      filters.need = i;
      filters.type = "";
      return { filters, clearSelection: true, message: c.needs[i].detail };
    }
    const type = [
      "栅格",
      "矢量",
      "观测表",
      "垂直剖面",
      "时间序列",
      "统计表",
    ].find((t) => q.includes(t));
    if (type) {
      filters.type = type;
      filters.need = -1;
      return {
        filters,
        clearSelection: true,
        message: "已按 " + type + " 筛选数据，地球与需求清单同步更新。",
      };
    }
  }
  return {
    message:
      "当前任务为“" +
      c.title +
      "”。可以继续限定区域、年份、采样深度或数据类型，也可以查看资料，追问“共同使用还缺什么”。这条追问尚无对应的已核材料回答。",
  };
}
