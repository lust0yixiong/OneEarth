import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {createModelExecutor} from "./executor";
import {assertModelContextSafe} from "./model-context-safety";
import {complementPlan, complementSchema, type WebComplementInput} from "./web-complement";

test("the actual executor passes only checked prompt and schema to the CLI", async () => {
  const bin = await mkdtemp(path.join(tmpdir(), "oneearth-model-test-"));
  try {
    const fixture = path.join(bin, "codex");
    await writeFile(fixture, `#!${process.execPath}
const fs=require("node:fs");
const args=process.argv.slice(2);
const schema=args[args.indexOf("--output-schema")+1];
console.log(JSON.stringify({prompt:fs.readFileSync(0,"utf8"),schema:JSON.parse(fs.readFileSync(schema,"utf8"))}));
`, {mode:0o700});
    const execute = createModelExecutor((_config,_args,env) => {env.PATH = bin + path.delimiter + (env.PATH || "");});
    const url = "https://example.invalid/catalog?dataset=42&amp;amp;sign=SYNTHETIC_ONLY&expireTime=100";
    const raw = JSON.stringify({url, note: "Authorization Bearer SYNTHETIC_TOKEN", file: "/Users/test/private/report.pdf"});
    assert.throws(() => assertModelContextSafe(raw), /unsafe/);
    const result = JSON.parse(await execute({executor:"codex",model:"fixture"}, raw, AbortSignal.timeout(5000), {
      outputSchema:{type:"string",enum:[url]},
    }));
    assertModelContextSafe(result.prompt);
    assertModelContextSafe(JSON.stringify(result.schema));
    assert.deepEqual(JSON.parse(result.prompt), {
      url:"https://example.invalid/catalog?dataset=42", note:"Authorization Bearer [redacted]", file:"[private file]",
    });
    assert.deepEqual(result.schema.enum, ["https://example.invalid/catalog?dataset=42"]);
  } finally {
    await rm(bin, {recursive:true,force:true});
  }
});

test("a redacted discovery lookup can only select one known original target", () => {
  const url = "https://example.invalid/catalog?dataset=42&sign=SYNTHETIC_ONLY";
  const cleanKey = "web:https://example.invalid/catalog?dataset=42";
  const input: WebComplementInput = {question:"Read the documentation",initialQueries:[],webFindings:[],notice:"",
    entities:[{id:"web:"+url,url,kind:"source",title:"Documentation",sourceIds:[],pinned:false,origin:"fixture"}]};
  const answer = JSON.stringify({checks:[{entityId:cleanKey,goal:"coverage",terms:"coverage",reason:"Read the coverage documentation"}]});
  assert(!JSON.stringify(complementSchema(input)).includes("SYNTHETIC_ONLY"));
  assert.deepEqual(complementPlan(answer,input).targets?.map(target=>target.url), [url]);
  const second = url.replace("SYNTHETIC_ONLY","ANOTHER_FIXTURE");
  const ambiguous = {...input,entities:[...input.entities,{...input.entities[0],id:"web:"+second,url:second}]};
  assert.throws(()=>complementPlan(answer,ambiguous), /对象或方向无效/);
  assert.equal(complementSchema(ambiguous).properties.checks.maxItems,0);
});
