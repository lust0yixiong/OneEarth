import type { Asset } from "../domain/datasets";
import type { Filters } from "../domain/types";
import { ChartNoAxesCombined } from "lucide-react";
import { resources } from "../domain/catalog";
import { useWorkspace } from "../domain/store";
export function DatasetActions({
  caseId,
  index,
  asset,
  scope,
}: {
  caseId: string;
  index: number;
  asset?: Asset;
  scope?: Filters;
}) {
  const { inspectAsset } = useWorkspace();
  const entry =
    asset ||
    resources.find((r) => r.caseId === caseId && r.needIndex === index);
  if (!entry) return null;
  return (
    <button
      className="data-view-button"
      aria-label={"数据速览：" + entry.title}
      onClick={() => inspectAsset(entry.id, scope)}
    >
      <ChartNoAxesCombined size={13} /> 数据速览
    </button>
  );
}
