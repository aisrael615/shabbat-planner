import test from 'node:test';
import assert from 'node:assert/strict';
import { latest, runWorkflow, validateSnapshot, waitForRun } from '../github.mjs';
import { artifact, dinnerRows, saved, snapshot } from './fixtures.mjs';

function api(t,handler) {
  const oldFetch=globalThis.fetch;
  const oldTimeout=globalThis.setTimeout;
  globalThis.fetch=async (url,options)=>handler(new URL(url),options);
  globalThis.setTimeout=(callback,_ms,...args)=>oldTimeout(callback,0,...args);
  t.after(()=>{globalThis.fetch=oldFetch;globalThis.setTimeout=oldTimeout;});
}
const listing=(...artifacts)=>Response.json({artifacts});
const result=(data,compression)=>new Response(artifact(data,compression));

test('snapshot contract rejects unsupported versions and malformed rows while accepting legacy snapshots',()=>{
  assert.equal(validateSnapshot({...snapshot,version:undefined}).revision,snapshot.revision);
  assert.throws(()=>validateSnapshot({...snapshot,version:999}),/unsupported/);
  assert.throws(()=>validateSnapshot({...snapshot,current:[null]}),/invalid/);
  assert.throws(()=>validateSnapshot({...snapshot,defaults:[]}),/invalid/);
});

test('latest result skips malformed entries and selects by Alexa fetch time, decoding UTF-8',async t=>{
  api(t,url=>{
    if(url.pathname.endsWith('/artifacts'))return listing(
      {id:9,created_at:'2026-11-27T10:04:00Z'},{id:8,created_at:'2026-11-27T10:03:00Z'},
      {id:7,created_at:'2026-11-27T10:02:00Z'},{id:6,expired:true});
    if(url.pathname.endsWith('/9/zip'))return new Response('invalid ZIP');
    if(url.pathname.endsWith('/8/zip'))return result({version:1,verified:[],snapshot},0);
    return result({version:1,verified:[],snapshot:{...saved,current:[{...dinnerRows[1],name:'Shabbat Planner Â· dinnerOff'}]}});
  });
  const current=await latest('mock');
  assert.equal(current.revision,saved.revision);
  assert.equal(current.current[0].name,'Shabbat Planner Â· dinnerOff');
});

test('dispatch polls only the returned run and reads only its own artifact',async t=>{
  let polls=0;
  let lists=0;
  api(t,(url,request)=>{
    if(url.pathname.endsWith('/dispatches')) {
      assert.equal(request.method,'POST');
      assert.deepEqual(JSON.parse(request.body),{ref:'main',inputs:{mode:'apply',plan:'{}'}});
      return Response.json({workflow_run_id:42});
    }
    if(url.pathname.endsWith('/runs/42')) {
      if(++polls===1)return Response.json({}, {status:404});
      return Response.json(polls===2?{status:'in_progress'}:{status:'completed',conclusion:'success'});
    }
    if(url.pathname.endsWith('/runs/42/artifacts')) return ++lists===1?listing():listing(
      {id:3,workflow_run:{id:41}},{id:4,workflow_run:{id:42}});
    assert.match(url.pathname,/artifacts\/4\/zip$/);
    return result({version:1,snapshot:saved,verified:dinnerRows,operations:[]});
  });
  const output=await runWorkflow('mock','apply','{}',id=>assert.equal(id,42));
  assert.deepEqual(output.snapshot,saved);
});

test('cancelled executions return an actionable outcome without reading unrelated results',async t=>{
  api(t,url=>url.pathname.endsWith('/artifacts')?listing():Response.json({status:'completed',conclusion:'cancelled'}));
  assert.match((await waitForRun('mock',42)).error,/cancelled.*Refresh Alexa/);
});

test('permission errors are distinct and transient reads are retried',async t=>{
  const statuses=[401,403,404,429,503,200];
  api(t,()=>{
    const status=statuses.shift();
    return status===200?listing():Response.json({}, {status});
  });
  await assert.rejects(latest('mock'),/rejected this token/);
  await assert.rejects(latest('mock'),/denied access/);
  await assert.rejects(latest('mock'),/denied access/);
  assert.equal(await latest('mock'),null);
  assert.equal(statuses.length,0);
});

test('an ambiguous workflow dispatch is never automatically repeated',async t=>{
  let count=0;
  api(t,()=>{count++;throw Error('timeout');});
  await assert.rejects(runWorkflow('mock','apply','{}',()=>assert.fail()),/confirm that GitHub accepted/);
  assert.equal(count,1);
});

test('version mismatches and malformed job results surface as errors',async t=>{
  api(t,url=>{
    if(url.pathname.endsWith('/runs/42'))return Response.json({status:'completed',conclusion:'success'});
    if(url.pathname.endsWith('/artifacts'))return listing({id:4});
    return result({version:2,snapshot:saved,verified:[]});
  });
  await assert.rejects(waitForRun('mock',42),/unsupported result/);
});
