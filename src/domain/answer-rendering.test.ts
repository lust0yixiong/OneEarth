import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
import {AnswerContent} from '../components/AnswerContent';
import {answerBlocks} from './answer-blocks';
import {answerTokens,normalizeAnswerNewlines,revealAnswerText,renderAnswerMath} from './answer-math';
import fixtures from './answer-rendering.fixtures.json';
import type {AnswerReference} from './types';

const references:AnswerReference[]=[{kind:'web',title:'Official source',url:'https://example.org/source'}];
const render=(text:string)=>renderToStaticMarkup(createElement(AnswerContent,{text,references,inspect(){}}));

test('real SN306/384/414 expressions retain TeX identity in MathML, including complete multi-line display math',()=>{
  for(const id of ['SN-0306','SN-0384','SN-0414'] as const){
    const text=fixtures[id].text,expressions=answerTokens(text).filter(t=>t.kind==='math');
    assert.ok(expressions.length>0);
    const html=render(text),$=load(html);
    assert.equal($('.answer-math-fallback').length,0,id);
    assert.equal($('.katex').length,expressions.length,id);
    assert.deepEqual($('annotation[encoding="application/x-tex"]').map((_,e)=>$(e).text()).get(),expressions.map(e=>e.tex));
  }
  const $=load(render(fixtures['SN-0414'].text));
  assert.equal($('.answer-math.display').length,1);
  assert.match($('.answer-math.display annotation').text(),/u\(y\).*0\.14/s);
  assert.equal($('.answer-math.display').closest('p').length,1,'the whole formula remains a single prose unit');
});

test('real SN329 escaped list separators become six numbered steps and three separate cases',()=>{
  const blocks=answerBlocks(fixtures['SN-0329'].text),lists=blocks.filter(b=>b.kind==='list');
  assert.equal(lists[0].items.length,6);
  assert.equal(lists[0].start,1);
  assert.equal(lists[1].items.length,3);
  assert.equal(lists[1].start,undefined);
  const $=load(render(fixtures['SN-0329'].text));
  assert.equal($('ol > li').length,6);assert.equal($('ul > li').length,3);
  assert.equal($('.answer-prose').text().includes('\\n2.'),false);
});

test('typewriter reveal emits each math expression as one complete unit at every character budget',()=>{
  const text=String.raw`开始 \(\nu+\nabla x\) 接着 \[\frac{a}{b}\] 完成`;
  const math=answerTokens(text).filter(t=>t.kind==='math');
  for(let n=0;n<=text.length;n++){
    const shown=revealAnswerText(text,n);
    for(const token of math){
      const start=shown.indexOf(token.raw.slice(0,2));
      if(start>=0)assert.ok(shown.includes(token.raw),'no partial delimiters or commands during animation');
    }
  }
  assert.equal(revealAnswerText(text,Infinity),text);
});

test('ordinary dollars, math commands, code and text paths are never broadly unescaped',()=>{
  const paths=String.raw`C:\notes\n2. txt C:\n2. txt /tmp/notes\n- file data\notes\n3. csv folder\n4. txt https://example.org/notes\n5. csv`;
  assert.equal(normalizeAnswerNewlines(paths),paths);
  const code='```js\nconst sample = "\\n2. unchanged"; // \\(x\\)\n```';
  const inline=String.raw`代码 \n2. 内容`; // enclosed in a code span below
  const text=code+'\n\n`'+inline+'`\n\n价格 $5、$10；'+String.raw`\(\nu+\nabla x\)`;
  const $=load(render(text));
  assert.equal($('pre code').text(),'const sample = "\\n2. unchanged"; // \\(x\\)');
  assert.ok($('code').toArray().some(e=>$(e).text()===inline));
  assert.match($('.answer-prose').text(),/价格 \$5、\$10/);
  assert.equal($('.katex').length,1);
  assert.equal($('annotation').text(),String.raw`\nu+\nabla x`);
  const tilde='~~~text\n\\n2. \\(literal\\)\n~~~';
  assert.equal(normalizeAnswerNewlines(tilde),tilde);assert.equal(load(render(tilde))('pre code').text(),String.raw`\n2. \(literal\)`);
});

test('citations, emphasis and table boundaries remain stable beside math and literal code markers',()=>{
  const text=String.raw`**公式 \(E_s-E_0\)**〔1〕，代码 `+'`〔1〕`'+String.raw`。

| 条件 | 公式 |
| --- | --- |
| 概率 | \(P(A|B)\)〔1〕 |`;
  const $=load(render(text));
  assert.equal($('strong .katex').length,1);
  assert.equal($('.citation-inline-group a').length,2,'code citation is not interactive');
  assert.equal($('td').length,2,'a mathematical conditional bar does not create a third table cell');
  assert.equal($('td .katex').length,1);
});

test('untrusted TeX cannot create links, remote images or user-supplied HTML; malformed math stays literal',()=>{
  for(const source of [String.raw`\href{javascript:alert(1)}{x}`,String.raw`\includegraphics{https://example.org/pixel}`,String.raw`\htmlStyle{background:url(https://example.org/pixel)}{x}`]){
    const $=load(render(String.raw`\(`+source+String.raw`\)`));
    assert.equal($('a,img,script,iframe').length,0);
    assert.equal($('[style*="example.org"]').length,0);
  }
  const $=load(render(String.raw`\(\frac{a}\) <img src=x onerror=alert(1)>`));
  assert.equal($('.answer-math-fallback').length,1);assert.equal($('img').length,0);
  assert.equal(renderAnswerMath('x'.repeat(12001)),null);
  assert.equal(renderAnswerMath(String.raw`\def\a{\a}\a`),null,'macro expansion has a finite bound');
});
