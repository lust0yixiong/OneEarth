import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  decodeWind,
  defaultWindState,
  installWindData,
  windDocument,
  windFrame,
  windManifest,
  windVector,
} from "./wind";
import { discover } from "./discovery";
import { visualizationsFor } from "./visualization-catalog";
import { emptyFilters } from "./spatial";
import { validContext } from "../../server/validation";
import type { DiscoveryContext } from "./types";
const raw = readFileSync(
  new URL("../../public/visualizations/gfs/wind.bin", import.meta.url),
);
const data = decodeWind(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
);
installWindData(data);
const view = defaultWindState();
const context = (): DiscoveryContext => ({
  caseId: "wind",
  visualization: view,
  filters: emptyFilters(),
  gridSystem: "h3",
  layer: "all",
  selection: null,
  camera: { center: [105, 20], zoom: 1, reason: "风场" },
  citation: null,
  dataView: null,
});
test("pinned NOAA files and browser fields match their SHA-256 provenance", () => {
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    windManifest.sha256,
  );
  for (const file of windManifest.originals) {
    const original = readFileSync(
      new URL("../../public" + file.file, import.meta.url),
    );
    assert.equal(original.subarray(0, 4).toString(), "GRIB");
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      file.sha256,
    );
  }
  assert.equal(data.fields.size, 6);
  assert.throws(() => decodeWind(new ArrayBuffer(12)));
});
test("wind decoding reproduces independently inspected NOAA GRIB values within 0.005 m/s", () => {
  const value = windVector(data, windFrame(view), 105, 20)!;
  assert(Math.abs(value.u - 6.612194824218751) <= 0.0051);
  assert(Math.abs(value.v - -2.23980712890625) <= 0.0051);
  const jet = windVector(data, windFrame(view), 105, 30)!;
  assert(Math.abs(jet.u - 45.51219482421875) <= 0.0051);
  assert(Math.abs(jet.v - 8.960192871093751) <= 0.0051);
});
test("bilinear sampling is continuous across the dateline and rejects invalid latitude or missing components", () => {
  const frame = windFrame(view);
  assert.deepEqual(
    windVector(data, frame, -180, 30),
    windVector(data, frame, 180, 30),
  );
  assert.deepEqual(
    windVector(data, frame, 0, 30),
    windVector(data, frame, 360, 30),
  );
  const corners = [
    [105, 20],
    [106, 20],
    [105, 19],
    [106, 19],
  ].map(([x, y]) => windVector(data, frame, x, y)!);
  const middle = windVector(data, frame, 105.5, 19.5)!;
  assert(Math.abs(middle.u - corners.reduce((n, v) => n + v.u, 0) / 4) < 1e-10);
  assert(Math.abs(middle.v - corners.reduce((n, v) => n + v.v, 0) / 4) < 1e-10);
  assert.equal(windVector(data, frame, 0, 91), null);
  const field = data.fields.get(frame.id)!.slice();
  field[(70 * 360 + 105) * 2] = 32767;
  assert.equal(
    windVector({ fields: new Map([[frame.id, field]]) }, frame, 105, 20),
    null,
  );
});
test("content preview uses the selected level/time and exposes its exact original GRIB", () => {
  const selected = {
    ...view,
    level: "10m" as const,
    forecastHour: 12 as const,
  };
  const doc = windDocument(selected);
  assert.equal(doc.tabs[0].rows!.length, 360 * 181);
  assert.match(doc.scope, /10 m.*12:00 UTC.*F012/);
  assert.equal(doc.attachments![0].url, "/visualizations/gfs/f012.grib2");
  const local = windDocument(selected, [105.5, 20.5]);
  assert.equal(local.tabs[0].rows!.length, 4);
  assert.equal(visualizationsFor("gfs-wind").length, 1);
  assert.equal(visualizationsFor("pangaea:891386").length, 0);
});
test("Chat changes actual wind states and content viewing remains an independent action", () => {
  const result = discover("切换到近地面10米风场，查看12小时预报", context());
  assert.equal(result.visualization!.level, "10m");
  assert.equal(result.visualization!.forecastHour, 12);
  assert.equal(
    discover("暂停风场流线", context()).visualization!.playing,
    false,
  );
  assert.equal(discover("查看风场原网格内容", context()).previewKind, "table");
  const unsupported = discover("切换到850 hPa风场", context());
  assert.equal(unsupported.visualization, undefined);
  assert.match(unsupported.message, /已接入/);
  const invalidTime = discover("查看24小时风场预报", context());
  assert.equal(invalidTime.visualization, undefined);
});
test("API context rejects unimplemented visualization levels and mixed content modes", () => {
  assert(validContext(context()));
  assert(
    !validContext({
      ...context(),
      visualization: { ...view, level: "850hPa" },
    }),
  );
  assert(
    !validContext({
      ...context(),
      visualization: { ...view, forecastHour: 24 },
    }),
  );
  assert(
    !validContext({
      ...context(),
      dataView: { kind: "front", glacier: "Alsek", epoch: "compare" },
    }),
  );
});
