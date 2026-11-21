import { useMemo } from "react";
import { assetById, type Asset } from "../domain/datasets";
import {
  spatialGroups,
  spatialCategoryLabels,
  type SpatialCategory,
  type SpatialScope,
} from "../domain/results";
import type { CandidateSet } from "../domain/types";
import "../styles/dataset-lineage.css";

type Props = ({ batch: CandidateSet } | ({ items: Asset[] } & SpatialScope)) & {
  compact?: boolean;
};

export function BatchSpatialSummary(props: Props) {
  const batch = "batch" in props ? props.batch : null;
  const items = "items" in props ? props.items : undefined;
  const { filters, selection, layer, caseId, lookups } =
    "batch" in props ? props.batch : props;
  const groups = useMemo(
    () =>
      spatialGroups(
        items || batch!.ids.flatMap((id) => assetById.get(id) || []),
        { filters, selection, layer, caseId, lookups },
      ),
    [items, batch, filters, selection, layer, caseId, lookups],
  );
  const categories = Object.keys(spatialCategoryLabels) as SpatialCategory[];
  const total = categories.reduce((sum, key) => sum + groups[key].length, 0);
  return (
    <details className="batch-spatial-summary" open={!props.compact}>
      <summary>
        整批空间分布 <strong>{total} 项</strong>
      </summary>
      <ul>
        {categories.filter(key=>groups[key].length>0).map((key) => (
          <li key={key}>
            <span>{spatialCategoryLabels[key]}</span>
            <strong>{groups[key].length}</strong>
          </li>
        ))}
      </ul>
    </details>
  );
}
