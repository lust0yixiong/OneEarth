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
