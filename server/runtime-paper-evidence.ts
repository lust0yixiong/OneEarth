import { registerPapers, replacePublishedPapers } from "../src/domain/datasets";
import type { PaperRecord } from "../src/domain/paper-record";
import type { paperCache } from "./earthnano";

export function runtimePaperEvidence(cache: Pick<ReturnType<typeof paperCache>, "get" | "saveBatch" | "list" | "dataVersion">) {
  let version: number | undefined;
  function refresh() {
    const publishedVersion = cache.dataVersion();
    if (publishedVersion === version) return;
    replacePublishedPapers(cache.list());
    version = publishedVersion;
  }
  return {
    get: cache.get,
    refresh,
    remember(records: PaperRecord[]) {
      cache.saveBatch(records,false);
      registerPapers(records,false);
      refresh();
    },
  };
}
