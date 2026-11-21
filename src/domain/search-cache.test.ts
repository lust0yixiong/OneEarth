import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSnapshotCache} from '../../server/search-cache';
test('source snapshots expire, are isolated copies, and evict within a bounded LRU',()=>{
  let now=1000;const cache=sourceSnapshotCache(2,1000,()=>now),original={results:[{url:'https://example.org',title:'Actual source'}]};
  cache.put('one',original);original.results[0].title='changed';
  const read=cache.get('one',500)!;assert.equal(read.data.results[0].title,'Actual source');assert.equal(read.cacheStoredAt,new Date(1000).toISOString());
  read.data.results.length=0;assert.equal(cache.get('one',500)!.data.results.length,1);
  cache.put('two',{});cache.get('one',500);cache.put('three',{});assert.equal(cache.get('two',500),undefined);
  now=1500;assert.equal(cache.get('one',500),undefined);
});
