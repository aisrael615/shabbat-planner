const repo='aisrael615/shabbat-dashboard';
const api='https://api.github.com/repos/'+repo+'/actions/';
const file='shabbat-result.json';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const workflowUrl='https://github.com/'+repo+'/actions/workflows/shabbat.yml';
export const runUrl=id=>'https://github.com/'+repo+'/actions/runs/'+id;

export function validateSnapshot(data) {
  const row=item=>item && typeof item.name==='string' && typeof item.enabled==='boolean' &&
    Array.isArray(item.days) && item.days.every(day=>/^(SU|MO|TU|WE|TH|FR|SA)$/.test(day)) &&
    (item.time===undefined || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time));
  if(!data || (data.version!==undefined && data.version!==1) || !/^[a-f\d]{64}$/.test(data.revision) ||
    !Number.isFinite(Date.parse(data.fetchedAt)) || !Array.isArray(data.current) || !Array.isArray(data.shared) ||
    !data.current.every(item=>row(item) && typeof item.key==='string') || !data.shared.every(row) ||
    !data.defaults || typeof data.defaults!=='object' || Array.isArray(data.defaults) ||
    !Object.values(data.defaults).every(row)) throw Error('The snapshot has an unsupported or invalid format. Refresh Alexa.');
  return data;
}

function validateResult(result) {
  if(!result || (result.version!==undefined && result.version!==1) ||
    !Array.isArray(result.verified) || (result.error!==undefined && typeof result.error!=='string') ||
    (result.operations!==undefined && (!Array.isArray(result.operations) || result.operations.some(item=>
      typeof item?.label!=='string' || !['confirmed','failed','unconfirmed','not_attempted'].includes(item.status) ||
      (item.message!==undefined && typeof item.message!=='string'))))) throw Error('The workflow returned an unsupported result. Check the GitHub run.');
  if(result.snapshot) validateSnapshot(result.snapshot);
  if(!result.snapshot && !result.error) throw Error('The workflow result is missing its Alexa snapshot.');
  return result;
}

async function request(token,path,{body,missing=false,archive=false}={}) {
  let response;
  for(let i=0; ;i++){
    try {
      response=await fetch(api+path,{
        method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
          'X-GitHub-Api-Version':'2026-03-10',...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,
      });
    } catch {
      if(!body && i<2) {await wait(500*2**i);continue;}
      throw Error(body?'Could not confirm that GitHub accepted the request. Check the workflow before submitting again.'
        :'Could not contact GitHub. Check your connection, then retry.');
    }
    if(body || i===2 || (response.status!==429 && response.status<500)) break;
    await response.body?.cancel();
    await wait(Math.min(10000,Math.max(500*2**i,Number(response.headers.get('retry-after'))*1000||0)));
  }
  if(response.status===404 && missing) return null;
  if(response.status===401) throw Error('GitHub rejected this token. Reconnect with an unexpired fine-grained token.');
  if([403,404].includes(response.status)) throw Error('GitHub denied access. Select the private aisrael615/shabbat-dashboard repository and Actions: Read and write in your token settings.');
  if(!response.ok) throw Error(`GitHub returned HTTP ${response.status}. Open the workflow to check its status.`);
  if(archive) return response.arrayBuffer();
  try{return await response.json();}
  catch {throw Error('GitHub returned an unexpected response. Check the workflow before trying again.');}
}

async function decode(buffer) {
  const view=new DataView(buffer);
  const u16=offset=>view.getUint16(offset,true);
  const u32=offset=>view.getUint32(offset,true);
  let end=view.byteLength-22;
  while(end>=0 && u32(end)!==0x06054b50) end--;
  if(end<0 || u16(end+10)!==1) throw Error('GitHub returned an invalid result archive.');
  const central=u32(end+16);
  if(u32(central)!==0x02014b50) throw Error('GitHub returned an invalid result archive.');
  const length=u32(central+20);
  const header=u32(central+42);
  if(u32(header)!==0x04034b50 || u32(central+24)>200000) throw Error('GitHub returned an invalid result archive.');
  const start=header+30+u16(header+26)+u16(header+28);
  const utf8=new TextDecoder('utf-8',{fatal:true});
  if(utf8.decode(new Uint8Array(buffer,header+30,u16(header+26)))!==file) throw Error('GitHub returned an unexpected result file.');
  const bytes=new Uint8Array(buffer,start,length);
  if(u16(central+10)===0) return JSON.parse(utf8.decode(bytes));
  if(u16(central+10)!==8) throw Error('GitHub returned an unsupported result archive.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader();
  const output=new Uint8Array(u32(central+24));
  let offset=0;
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    if(offset+value.length>output.length) {
      await reader.cancel();
      throw Error('The workflow result exceeded its archive size.');
    }
    output.set(value,offset);
    offset+=value.length;
  }
  if(offset!==output.length) throw Error('The workflow result size did not match its archive.');
  return JSON.parse(utf8.decode(output));
}
async function artifactResult(token,id) {
  if(!Number.isSafeInteger(id) || id<=0) throw Error('GitHub returned an invalid artifact ID.');
  const archive=await request(token,`artifacts/${id}/zip`,{archive:true});
  try{return validateResult(await decode(archive));}
  catch(error) {
    if(error instanceof RangeError || error instanceof SyntaxError) throw Error('GitHub returned a malformed result archive.');
    throw error;
  }
}

export async function latest(token) {
  const {artifacts}=await request(token,'artifacts?name=shabbat-result&per_page=10');
  if(!Array.isArray(artifacts)) throw Error('GitHub returned an invalid artifact list.');
  const sorted=artifacts.filter(item=>!item.expired).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  let newest;
  let failure;
  for(const item of sorted) {
    if(newest && Date.parse(item.created_at)<Date.parse(newest.fetchedAt)) break;
    try {
      const {snapshot}=await artifactResult(token,item.id);
      if(snapshot && (!newest || Date.parse(snapshot.fetchedAt)>Date.parse(newest.fetchedAt))) newest=snapshot;
    } catch(error) { failure=error; }
  }
  if(failure && !newest) throw failure;
  return newest ?? null;
}

export async function runWorkflow(token,mode,plan,started) {
  const {workflow_run_id:id}=await request(token,'workflows/shabbat.yml/dispatches',{body:{
    ref:'main',inputs:{mode,...(plan?{plan}: {})},
  }});
  if (!Number.isSafeInteger(id)) throw Error('GitHub did not return a run ID. Check the workflow before trying again.');
  started(id);
  return waitForRun(token,id);
}

export async function waitForRun(token,id) {
  if(!Number.isSafeInteger(id) || id<=0) throw Error('Invalid GitHub run ID.');
  const deadline=Date.now()+12*60*1000;
  let missingArtifact=0;
  while(Date.now()<deadline) {
    await wait(3500);
    const run=await request(token,`runs/${id}`,{missing:true});
    if(run?.status!=='completed') continue;
    const {artifacts}=await request(token,`runs/${id}/artifacts?name=shabbat-result`);
    if(!Array.isArray(artifacts)) throw Error('GitHub returned an invalid artifact list.');
    const artifact=artifacts.find(item=>!item.expired && (!item.workflow_run || item.workflow_run.id===id));
    if(artifact) {
      const result=await artifactResult(token,artifact.id);
      if(run.conclusion!=='success' && !result.error) result.error='The workflow did not finish successfully.';
      return result;
    }
    if(++missingArtifact<4 && run.conclusion!=='cancelled') continue;
    return {verified:[],error:`GitHub run ${run.conclusion}. No Alexa result was available. Refresh Alexa before submitting again.`};
  }
  throw Error('GitHub is still processing this run. Open it to check the result before retrying.');
}
