import assert from "node:assert/strict";
import test from "node:test";
import {modelSafeText,modelSafeValue,modelUrlLocator,originalModelKey,assertModelContextSafe} from "./model-context-safety";

for(const separator of ["&","&amp;","&amp;amp;","&#38;","&amp;#38;","&#x26;","&amp;#x26;","&amp;amp;#x26;"]){
  test("signed URL locator removes bounded HTML separators: "+separator,()=>{
    const raw="https://example.org/paper?id=42"+separator+"sign=controlled-secret"+separator+"expireTime=1795483000";
    const clean=modelSafeText(JSON.stringify({url:raw,reference:"S1"}));assert.ok(!clean.includes("controlled-secret"));assert.ok(!clean.includes("1795483000"));
    assert.equal(JSON.parse(clean).url,"https://example.org/paper?id=42");assert.doesNotThrow(()=>assertModelContextSafe(clean));
    assert.throws(()=>assertModelContextSafe(JSON.stringify({url:raw})),/unsafe private or signed/);
  });
}

test("Azure locator keeps public identity and removes signing permissions only with sig",()=>{
  const signed="https://example.org/object?id=42&sig=controlled-signature&se=expired&sv=version&sp=r&sr=b";
  assert.equal(modelUrlLocator(signed),"https://example.org/object?id=42");
  assert.equal(modelUrlLocator("https://example.org/query?sp=species&se=season"),"https://example.org/query?sp=species&se=season");
});

test("auth text and private files are redacted without modifying the archived object",()=>{
  const original={Authorization:"Bearer controlled-token",note:"Authorization Bearer controlled-token\nfile:///Users/local/private.nc",
    path:"/Users/local/Library/Application Support/private.nc",reference:{token:"S1"}};
  const clean=modelSafeValue(original),wire=JSON.stringify(clean);assert.ok(!wire.includes("controlled-token"));assert.ok(!wire.includes("/Users/"));
  assert.equal(original.Authorization,"Bearer controlled-token");assert.equal(clean.reference.token,"S1");assert.doesNotThrow(()=>assertModelContextSafe(wire));
  for(const raw of ["Authorization: Bearer controlled-token","Authorization Bearer controlled-token",'{"Authorization":"Bearer controlled-token"}',"Bearer controlled-token"]){
    const safe=modelSafeText(raw);assert.ok(!safe.includes("controlled-token"));assert.doesNotThrow(()=>assertModelContextSafe(safe));assert.throws(()=>assertModelContextSafe(raw));
  }
});

test("covered credential forms are redacted or rejected with no value in the error",()=>{
  for(const raw of ["sk-controlled123456789", "AKIA0123456789ABCDEF", "secret=controlled-private",'"token":"controlled-token"',
    "-----BEGIN PRIVATE KEY-----\ncontrolled-private\n-----END PRIVATE KEY-----"]){
    const safe=modelSafeText(raw);assert.ok(!safe.includes("controlled-private"));assert.ok(!safe.includes("controlled-token"));assert.ok(!safe.includes("AKIA"));
    assert.equal(modelSafeText(safe),safe);assert.doesNotThrow(()=>assertModelContextSafe(safe));
    assert.throws(()=>assertModelContextSafe(raw),error=>error instanceof Error&&error.message==="Model context contains unsafe private or signed data.");
  }
  assert.throws(()=>assertModelContextSafe("-----BEGIN PRIVATE KEY----- incomplete"));
});

test("only one authorized original key can be recovered; cleaned aliases do not grant new sources",()=>{
  const a="web:https://example.org/paper?id=42&sign=first",b="web:https://example.org/paper?id=42&sign=second",clean=modelSafeText(a);
  assert.equal(originalModelKey(clean,[a]),a);assert.equal(originalModelKey(clean,[a,b]),undefined);
  assert.equal(originalModelKey("web:https://other.org/private",[a]),undefined);
  assert.equal(a,"web:https://example.org/paper?id=42&sign=first");
});

test("the archived Haina Markdown fragment preserves its public URL and following Chinese bytes",()=>{
  const text="可在[海纳数据集详情页](https://haina-datahub.zero2x.org/a?id=1846764)查看。";
  assert.equal(modelSafeText(text),text);assert.equal(modelSafeText(JSON.stringify({message:text})),JSON.stringify({message:text}));
  assert.doesNotThrow(()=>assertModelContextSafe(text));
  // c2034-original/turn-2-record.json already contains the encoded tail. Preserve
  // those archived bytes; decoding this short public fragment is only a replay
  // of the pre-sanitizer input, not a claim to have the raw model stdout.
  const archived="可从[海纳数据集详情页](https://cn.zero2x.org/data-hub/portal/dataset?id=1846764&lang=zh)%E6%9F%A5%E7%9C%8B%E3%80%82";
  assert.equal(modelSafeText(archived),archived);
  const reconstructed=decodeURIComponent(archived);assert.equal(modelSafeText(reconstructed),reconstructed);
});

test("public locators are inspected without changing case, escapes, query encoding or public fragments",()=>{
  for(const url of ["HTTP://Example.ORG:80/a%2fb?q=a%20b&x=%2f#section", "https://example.org/中文?q=a+b&amp;category=wind#图表", "https://[::1]:8080/a_(b)"]){
    assert.equal(modelUrlLocator(url),url);assert.equal(modelSafeText(url),url);assert.doesNotThrow(()=>assertModelContextSafe(url));
  }
});

test("Markdown and bare URLs respect balanced paths, closing brackets and ordinary sentence boundaries",()=>{
  for(const text of [
    "[source](https://example.org/A_(part_(b)))查看，随后继续。",
    "<https://example.org/a_(b)>查看。",
    "见 https://example.org/path，接着看 https://example.org/other。",
    "See (https://example.org/a_(b)), then https://example.org/next; done.",
    "[source](https://example.org/path \"label\")查看。",
    "[one](https://example.org/first)[two](https://example.org/second)结束。",
  ])assert.equal(modelSafeText(text),text);
});

test("signed Markdown and neighboring links still strip credentials without consuming following prose",()=>{
  const cases=[
    ["[source](https://example.org/a_(b)?id=42&sign=controlled-secret)查看。", "[source](https://example.org/a_(b)?id=42)查看。"],
    ["见 https://example.org/file?id=42&sig=controlled-secret，继续。", "见 https://example.org/file?id=42，继续。"],
    ["[one](https://example.org/first?sig=controlled-secret)[two](https://example.org/second?token=controlled-secret)结束。", "[one](https://example.org/first)[two](https://example.org/second)结束。"],
    ["See (https://example.org/a_(b)?sign=controlled-secret), then continue.", "See (https://example.org/a_(b)), then continue."],
    ["https://user:controlled-secret@example.org/page#access_token=controlled-secret", "https://example.org/page"],
  ];
  for(const [raw,expected] of cases){
    assert.equal(modelSafeText(raw),expected);assert.equal(modelSafeText(expected),expected);assert.doesNotThrow(()=>assertModelContextSafe(expected));
    assert.throws(()=>assertModelContextSafe(raw));
  }
});
