import { assetById } from "./datasets";
import type { Citation, EvidenceDocument, EvidenceTab } from "./types";

export const tablePageSize = 12;

export function materialUrl(
  doc: EvidenceDocument,
  part: EvidenceTab,
  page: number,
) {
  const url = part.url || doc.url;
  return part.kind === "pdf" && url && part.pages?.[page]
    ? url.split("#")[0] + "#page=" + part.pages[page].number
    : url;
}

export function citeMaterial(
  doc: EvidenceDocument,
  part: EvidenceTab,
  page: number,
): Citation {
  // Early excerpts stored their row offset only in the material label.
  const legacy = !doc.locator && !part.savedWebExcerpt && doc.id.includes("-excerpt-");
  const legacyRange = legacy && part.label.match(/ · 第 (\d+)–(\d+) 行$/);
  const material =
    doc.locator?.material ||
    (legacyRange ? part.label.slice(0, legacyRange.index) : part.label);
  const documentId =
    doc.locator?.documentId || doc.assetId || doc.id.split("-excerpt-")[0];
  const documentTitle =
    doc.locator?.documentTitle ||
    doc.sourceTitle ||
    (legacy
      ? doc.title.split(
          " · " + (part.kind === "pdf" ? "PDF 第 " : part.label),
        )[0]
      : doc.title);
  const asset =
    assetById.get(documentId.replace(/-source$/, "")) ||
    (legacy ? assetById.get(documentId.replace(/\/\d+$/, "")) : undefined);
  const locator: NonNullable<Citation["locator"]> = {
    documentId,
    documentTitle,
    source: doc.source,
    version:
      doc.locator?.version ??
      part.version ??
      doc.version ??
      asset?.tabs.find((t) => t.kind === part.kind && t.url === part.url)
        ?.version ??
      asset?.version ??
      null,
    material,
    kind: part.kind,
  };
  let location = material;
  let body = (part.kind === "text" ? part.quote || part.body : part.body) || "";
  let excerptTab = part;
  if (part.kind === "table") {
    const start = page * tablePageSize;
    const rows = part.rows?.slice(start, start + tablePageSize) || [];
    const rowNumbers =
      part.rowNumbers?.slice(start, start + tablePageSize) ||
      rows.map(
        (_, i) => start + i + (legacyRange ? Number(legacyRange[1]) : 1),
      );
    locator.rows = rowNumbers;
    const contiguous = rowNumbers.every((n, i) => n === rowNumbers[0] + i);
    location +=
      " · 第 " +
      (contiguous
        ? rowNumbers[0] + "–" + rowNumbers.at(-1)
        : rowNumbers.join("、")) +
      " 行";
    body = rows
      .map((row) =>
        part.columns?.map((c, i) => c + " " + (row[i] ?? "缺测")).join("，"),
      )
      .join("。");
    excerptTab = { ...part, label: material, rows, rowNumbers };
  } else if (part.kind === "pdf" && part.pages?.[page]) {
    const pdfPage = part.pages![page];
    locator.page = pdfPage.number;
    location = "PDF 第 " + locator.page + " 页";
    body = pdfPage.label + "。来源 " + doc.source;
    excerptTab = { ...part, pages: [pdfPage] };
  } else if (part.kind === "trace") {
    body =
      part.steps?.map((step) => step.title + "：" + step.detail).join("\n") ||
      "";
  } else if (part.kind === "code" || part.kind === "text") {
    if(part.sourcePage && Number.isInteger(part.sourcePage) && part.sourcePage>0){
      locator.kind="pdf";locator.page=part.sourcePage;location="PDF 第 "+part.sourcePage+" 页文字摘录";
    }else{
      locator.lines = [1, body.split(/\r?\n/).length];
      location += " · 片段第 1–" + locator.lines[1] + " 行";
    }
  }
  const url = materialUrl(doc, part, page);
  const title = documentTitle + " · " + location;
  return {
    title,
    scope: doc.scope,
    url,
    body,
    locator,
    excerpt: {
      id: documentId + "-excerpt-" + location,
      title,
      scope: doc.scope,
      source: doc.source,
      url,
      tabs: [excerptTab],
      locator,
      ...(doc.sourceBatch ? { sourceBatch: doc.sourceBatch } : {}),
      assetId: doc.assetId || asset?.id,
      version: doc.version ?? asset?.version ?? null,
    },
  };
}
