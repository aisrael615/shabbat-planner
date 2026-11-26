const repo='aisrael615/shabbat-dashboard';
const api='https://api.github.com/repos/'+repo+'/actions/';
const file='shabbat-result.json';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const workflowUrl='https://github.com/'+repo+'/actions/workflows/shabbat.yml';

async function request(token,path,{body,missing=false,archive=false}={}) {
  let response;
  try {
    response=await fetch(api+path,{
      method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2026-03-10',...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,
    });
  } catch {
    throw Error('Could not contact GitHub. Check your connection and try again.');
  }
  if(response.status===404 && missing) return null;
  if([401,403,404].includes(response.status)) throw Error('GitHub denied access. Check that your token is unexpired and grants Actions read and write on shabbat-dashboard.');
  if(!response.ok) throw Error(`GitHub returned HTTP ${response.status}. Open the workflow to check its status.`);
  return archive?response.arrayBuffer():response.json();
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
  const utf8=new TextDecoder();
  if(utf8.decode(new Uint8Array(buffer,header+30,u16(header+26)))!==file) throw Error('GitHub returned an unexpected result file.');
  const bytes=new Uint8Array(buffer,start,length);
  if(u16(central+10)===0) return JSON.parse(utf8.decode(bytes));
  if(u16(central+10)!==8) throw Error('GitHub returned an unsupported result archive.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).json();
}
const artifactResult=(token,id)=>request(token,`artifacts/${id}/zip`,{archive:true}).then(decode);

export async function latest(token) {
  const {artifacts}=await request(token,'artifacts?name=shabbat-result&per_page=10');
  const sorted=artifacts.filter(item=>!item.expired).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  for(const item of sorted) {
    const result=await artifactResult(token,item.id);
    if(result.snapshot) return result.snapshot;
  }
  return null;
}

export async function runWorkflow(token,mode,plan,started) {
  const {workflow_run_id:id}=await request(token,'workflows/shabbat.yml/dispatches',{body:{
    ref:'main',inputs:{mode,...(plan?{plan}: {})},
  }});
  if (!Number.isSafeInteger(id)) throw Error('GitHub did not return a run ID. Check the workflow before trying again.');
  const url='https://github.com/'+repo+'/actions/runs/'+id;
  started(url);
  const deadline=Date.now()+12*60*1000;
  while(Date.now()<deadline) {
    await wait(3500);
    const run=await request(token,`runs/${id}`,{missing:true});
    if(run?.status!=='completed') continue;
    const {artifacts}=await request(token,`runs/${id}/artifacts?name=shabbat-result`);
    const artifact=artifacts.find(item=>!item.expired);
    if(artifact) {
      const result=await artifactResult(token,artifact.id);
      if(run.conclusion!=='success' && !result.error) result.error='The workflow did not finish successfully.';
      return result;
    }
    if(run.conclusion!=='success') throw Error(`The GitHub run ended with status ${run.conclusion}. Open the run for details.`);
    throw Error('The GitHub run finished but its result was unavailable. Open the run for details.');
  }
  throw Error('GitHub is still processing this run. Open it to check the result before retrying.');
}
