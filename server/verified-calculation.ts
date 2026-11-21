/** Bounded arithmetic only: no eval, imports, I/O, network or executable input. */
export type CalculationOperation="arithmetic"|"normalizeCompare"|"classify"|"rankReversalExample";
export type CalculationRequest={operation:CalculationOperation;arguments:string;scope:"example"|"source";sourceRefs:string[]};
export type CalculationReport={operation:CalculationOperation;scope:"example"|"source";sourceRefs:string[];arguments?:string;status:"completed"|"rejected";result?:unknown;error?:string};
const finite=(n:number)=>{if(!Number.isFinite(n)||Math.abs(n)>1e100)throw Error('non-finite-or-out-of-bounds');return n;};
const number=(x:unknown)=>{if(typeof x!=="number")throw Error('numeric-input-required');return finite(x);};
function object(x:unknown):Record<string,unknown>{if(!x||typeof x!=="object"||Array.isArray(x))throw Error('object-required');return x as Record<string,unknown>;}
function keys(x:Record<string,unknown>,allowed:string[]){if(Object.keys(x).some(k=>!allowed.includes(k)))throw Error('unknown-argument');}
/** Recursive descent, max 800 characters / 160 tokens / 20 nesting levels. */
export function arithmetic(expression:string):number {
 if(typeof expression!=="string"||!expression.trim()||expression.length>800)throw Error('expression-length');
 const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z][A-Za-z0-9]*|[^\s]/gi)||[];
 if(tokens.length>160)throw Error('expression-token-limit');let at=0,depth=0;
 const enter=()=>{if(++depth>20)throw Error('expression-depth');};
 const primary=():number=>{enter();try{const t=tokens[at++];if(!t)throw Error('expression-syntax');
  if(t==='('){const n=sum();if(tokens[at++]!==')')throw Error('expression-syntax');return n;}
  if(/^(?:sqrt|abs|log10|ln|exp)$/.test(t)){if(tokens[at++]!=='(')throw Error('expression-syntax');const n=sum();if(tokens[at++]!==')')throw Error('expression-syntax');return finite(t==='sqrt'?Math.sqrt(n):t==='abs'?Math.abs(n):t==='log10'?Math.log10(n):t==='ln'?Math.log(n):Math.exp(n));}
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t))throw Error('expression-token-not-allowed');return number(Number(t));
 }finally{depth--;}};
 const power=():number=>{const a=primary();return tokens[at]==='^'?(at++,finite(a**unary())):a;};
 const unary=():number=>{enter();try{if(tokens[at]==='+'){at++;return unary();}if(tokens[at]==='-'){at++;return finite(-unary());}return power();}finally{depth--;}};
 const product=():number=>{let n=unary();while(tokens[at]==='*'||tokens[at]==='/'){const op=tokens[at++],b=unary();n=finite(op==='*'?n*b:n/b);}return n;};
 const sum=():number=>{let n=product();while(tokens[at]==='+'||tokens[at]==='-'){const op=tokens[at++],b=product();n=finite(op==='+'?n+b:n-b);}return n;};
 const result=sum();if(at!==tokens.length)throw Error('expression-syntax');return finite(result);
}
function normalizeCompare(input:unknown) {
 const a=object(input);keys(a,['rows','weights','directions']);
 if(!Array.isArray(a.rows)||a.rows.length<2||a.rows.length>20)throw Error('rows-required-2-to-20');
 const rows=a.rows.map((row:unknown)=>{const r=object(row);keys(r,['name','values']);if(typeof r.name!=="string"||!r.name.trim()||r.name.length>80||!Array.isArray(r.values)||!r.values.length||r.values.length>10)throw Error('invalid-row');return {name:r.name,values:r.values.map(number)};});
 const dimensions=rows[0].values.length;if(new Set(rows.map(r=>r.name)).size!==rows.length||rows.some(r=>r.values.length!==dimensions))throw Error('inconsistent-rows');
 const weights=a.weights===undefined?Array(dimensions).fill(1):Array.isArray(a.weights)?a.weights.map(number):[];
 if(weights.length!==dimensions||weights.some(w=>w<=0))throw Error('positive-weights-required');const total=finite(weights.reduce((s,w)=>s+w,0)),w=weights.map(x=>x/total);
 const directions=a.directions===undefined?Array(dimensions).fill('positive'):a.directions;
 if(!Array.isArray(directions)||directions.length!==dimensions||directions.some(d=>!['positive','negative'].includes(String(d))))throw Error('invalid-directions');
 const stats=Array.from({length:dimensions},(_,j)=>{const values=rows.map(r=>r.values[j]),mean=finite(values.reduce((s,v)=>s+v,0)/rows.length),min=Math.min(...values),max=Math.max(...values),sd=finite(Math.sqrt(values.reduce((s,v)=>finite(s+finite((v-mean)**2)),0)/(rows.length-1)));if(max===min||sd===0)throw Error('zero-variance-column');return {min,max,mean,sampleStandardDeviation:sd};});
 const result=(method:'minmax'|'sample-z')=>rows.map(r=>{const transformed=r.values.map((v,j)=>{const s=stats[j],value=method==='minmax'?(v-s.min)/(s.max-s.min):(v-s.mean)/s.sampleStandardDeviation;return finite(directions[j]==='negative'?(method==='minmax'?1-value:-value):value);});return {name:r.name,transformed,score:finite(transformed.reduce((s,v,j)=>s+w[j]*v,0))};}).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((r,index,all)=>({...r,rank:1+all.filter(v=>v.score>r.score+1e-12).length,order:index+1}));
 const minmax=result('minmax'),sampleZ=result('sample-z');
 const reversals: string[][]=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const x=rows[i].name,y=rows[j].name,d1=minmax.find(r=>r.name===x)!.score-minmax.find(r=>r.name===y)!.score,d2=sampleZ.find(r=>r.name===x)!.score-sampleZ.find(r=>r.name===y)!.score;if(Math.abs(d1)>1e-12&&Math.abs(d2)>1e-12&&d1*d2<0)reversals.push([x,y]);}
 return {rows,weights:w,directions,statistics:stats,minmax,sampleZ,reversals,sampleZDefinition:'(x - mean) / sample standard deviation, denominator n-1'};
}
function classify(input:unknown) {
 const a=object(input);keys(a,['value','intervals']);const value=number(a.value);
 if(!Array.isArray(a.intervals)||a.intervals.length<1||a.intervals.length>30)throw Error('intervals-required');
 const intervals=a.intervals.map((raw:unknown)=>{const r=object(raw);keys(r,['label','min','max','minInclusive','maxInclusive']);if(typeof r.label!=="string"||!r.label||r.label.length>80||!['boolean','undefined'].includes(typeof r.minInclusive)||!['boolean','undefined'].includes(typeof r.maxInclusive))throw Error('invalid-interval');const min=r.min===null?-Infinity:number(r.min),max=r.max===null?Infinity:number(r.max);if(min>=max)throw Error('invalid-interval');return {label:r.label,min,max,minInclusive:r.minInclusive!==false,maxInclusive:r.maxInclusive===true};});
 if(new Set(intervals.map(x=>x.label)).size!==intervals.length)throw Error('duplicate-label');
 const sorted=[...intervals].sort((a,b)=>a.min-b.min);for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i];if(a.max>b.min||a.max===b.min&&a.maxInclusive&&b.minInclusive)throw Error('overlapping-intervals');}
 const matches=intervals.filter(r=>(value>r.min||value===r.min&&r.minInclusive)&&(value<r.max||value===r.max&&r.maxInclusive));
 return {value,label:matches[0]?.label??null,matchedIntervals:matches.map(r=>r.label),intervals:a.intervals};
}
export function calculate(operation:CalculationOperation,args:unknown):unknown {
 if(operation==='arithmetic'){const a=object(args);keys(a,['expression']);if(typeof a.expression!=="string")throw Error('expression-required');return {expression:a.expression,value:arithmetic(a.expression)};}
 if(operation==='normalizeCompare')return normalizeCompare(args);
 if(operation==='classify')return classify(args);
 if(operation==='rankReversalExample'){keys(object(args),[]);const result=normalizeCompare({rows:[{name:'A',values:[1,1]},{name:'B',values:[1,61]},{name:'C',values:[11,52]},{name:'D',values:[101,101]}]});if(!result.reversals.length)throw Error('no-strict-reversal');return {...result,synthetic:true,allIndicatorsHigherIsBetter:true,description:'Four synthetic regions, two positive indicators, equal weights; not observations.'};}
 throw Error('unknown-operation');
}
export function verifyCalculationRequests(requests:unknown,available:number):CalculationReport[] {
 if(!Array.isArray(requests)||requests.length>2)throw Error('maximum-two-calculation-requests');
 return requests.map(raw=>{
  const r=object(raw);const report={operation:r.operation,scope:r.scope,sourceRefs:r.sourceRefs,...(typeof r.arguments==="string"&&r.arguments.length<=4000?{arguments:r.arguments}:{})} as CalculationReport;
  try{keys(r,['operation','arguments','scope','sourceRefs']);if(!['arithmetic','normalizeCompare','classify','rankReversalExample'].includes(String(r.operation)))throw Error('unknown-operation');if(r.scope!=='source'&&r.scope!=='example')throw Error('invalid-scope');
   if(!Array.isArray(r.sourceRefs)||r.sourceRefs.length>10||r.sourceRefs.some(ref=>typeof ref!=="string"||!/^S[1-9]\d*$/.test(ref)||Number(ref.slice(1))>available))throw Error('unknown-source-reference');
   if(r.scope==='source'&&!r.sourceRefs.length)throw Error('source-reference-required');if(r.operation==='rankReversalExample'&&r.scope!=='example')throw Error('synthetic-example-only');
   if(typeof r.arguments!=="string"||r.arguments.length>4000)throw Error('arguments-length');const result=calculate(r.operation as CalculationOperation,JSON.parse(r.arguments));return {...report,status:'completed',result};
  }catch(error){return {...report,status:'rejected',error:error instanceof SyntaxError?'invalid-arguments-json':error instanceof Error?error.message:'invalid-request'};}
 });
}
