import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer, type FrameInfo, type Scene } from "../globe/renderer";
import { emptyFilters } from "./spatial";

test("the globe paints before catalogue coverage, and simulation data/picking still load on demand", async () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  };
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0, fetches = 0, coverageFetches=0;
  const ctx = new Proxy({globalAlpha: 1}, {get(target, key) {
    if (key in target) return Reflect.get(target, key);
    if (key === "measureText") return () => ({width: 30});
    if (key === "getImageData") return (_x:number,_y:number,w:number,h:number) => ({data:new Uint8ClampedArray(w*h*4)});
    if (key === "createImageData") return (w:number,h:number) => ({data:new Uint8ClampedArray(w*h*4)});
    return () => {};
  }});
  const canvas = {
    clientWidth: 1000, clientHeight: 800, width: 0, height: 0, dataset: {},
    getContext: () => ctx, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({left: 0, top: 0}), setPointerCapture() {},
  } as unknown as HTMLCanvasElement;
  const controls = {querySelector: () => ({})} as unknown as HTMLElement;
  const info: FrameInfo[] = [], errors: Error[] = [], selections: unknown[] = [];
  const scene: Scene = {
    camera: {center: [105,25], zoom: 1, reason: "test"}, gridSystem: "h3",
    filters: emptyFilters(), caseId: null, dataView: null, selection: null,
    layer: "all", mesh: true, source: -1, windTheme: "light", overview: "catalog",
  };
  let renderer: ReturnType<typeof createRenderer> | undefined;
  try {
    install("devicePixelRatio", 1);
    install("document", {createElement: () => ({getContext: () => ctx})});
    install("ResizeObserver", class { observe() {} disconnect() {} });
    install("requestAnimationFrame", (callback: FrameRequestCallback) => {frames.set(++serial, callback); return serial;});
    install("cancelAnimationFrame", (id: number) => frames.delete(id));
    install("fetch", (url:string,options:RequestInit) => {
      if(url.startsWith("/api/coverage/")) {
        coverageFetches++;
        const body=JSON.parse(String(options.body));
        return Promise.resolve(Response.json(url.endsWith("scopes")?{id:"test-scope"}:
          {cells:[[body.cells[0],1]],ready:body.cells,pending:0}));
      }
      fetches++;return Promise.reject(Error("Unexpected data fetch"));
    });
    const tick = () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    };
    renderer = createRenderer(canvas, controls, () => scene, () => {}, selection => {selections.push(selection); scene.selection = selection;}, f => info.push(f), undefined, error => {if(error)errors.push(error);});
    tick();
    assert.equal(canvas.dataset.painted, "true");
    assert.equal(canvas.dataset.gridVisible,"true","the base grid is visible before catalogue counts arrive");
    assert.equal(info.at(-1)?.visibleCells, 0);
    assert.ok(frames.size, "coverage is scheduled for a later animation frame");
    tick();
    for(let retry=0;retry<100 && !info.at(-1)?.visibleCells;retry++) {
      await new Promise(resolve=>setTimeout(resolve,10));tick();
    }
    assert.ok(info.at(-1)!.visibleCells > 0, "the next frame restores catalogue coverage");
    assert.ok(coverageFetches>0,"catalogue coverage is read from the precomputed server index");
    assert.equal(fetches, 0, "H3 catalogue startup does not fetch the S2 manifest");
    scene.overview = "simulation";
    renderer.render();
    tick();
    for (let retry = 0; retry < 100 && !info.at(-1)?.visibleCells; retry++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      tick();
    }
    assert.ok(info.at(-1)!.visibleCells > 0, "simulation counts arrive from the deferred data module");
    const event = {button: 0, pointerId: 1, clientX: 500, clientY: 400, pointerType: "mouse"};
    canvas.onpointerdown!(event as PointerEvent);
    canvas.onpointerup!(event as PointerEvent);
    await new Promise(resolve => setImmediate(resolve));
    tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(selections.some(value => Array.isArray((value as {counts?: unknown}).counts)), "picking still returns simulation counts");
    assert.deepEqual(errors, []);
  } finally {
    renderer?.dispose();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
