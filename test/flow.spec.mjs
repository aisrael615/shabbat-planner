import { expect, test } from '@playwright/test';
import { artifact, dinnerRows, saved, snapshot } from './fixtures.mjs';

const fakeToken='github_pat_example_for_test';
const api='https://api.github.com/repos/aisrael615/shabbat-dashboard/actions/**';
async function mock(context,{partial=false,firstStatus=200,withConflict=false}={}) {
  const state={dispatches:0,hold:false,interrupt:false,firstStatus};
  const initial=withConflict?{...snapshot,conflictRoutines:[
    {id:'daily-ac',name:'Daily AC off',time:'19:00',days:['SU','MO','TU','WE','TH','FR','SA'],actions:[{group:'ac',verb:'off'}],editable:true},
  ]}:snapshot;
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'};
  await context.route('https://www.hebcal.com/**',route=>route.fulfill({json:{items:[]},headers:cors}));
  await context.route('https://api.open-meteo.com/**',route=>route.fulfill({json:{current:{temperature_2m:23}},headers:cors}));
  await context.route(api,async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const send=(json,status=200)=>route.fulfill({status,json,headers:cors});
    const zip=data=>route.fulfill({body:artifact(data,0),contentType:'application/zip',headers:cors});
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    expect(route.request().headers().authorization).toBe('Bearer '+fakeToken);
    if(path.endsWith('/dispatches')) {
      state.dispatches++;
      const request=route.request().postDataJSON();
      if(request.inputs.mode==='apply') {
        const plan=JSON.parse(request.inputs.plan);
        expect(plan.settings.dinner).toMatchObject({enabled:true,start:'18:30',end:'20:00',temp:23,fan:60});
        expect(plan.revision).toBe(snapshot.revision);
        expect(plan.conflictIds).toEqual(withConflict?['daily-ac']:[]);
      }
      return send({workflow_run_id:request.inputs.mode==='snapshot'?43:42});
    }
    if(path.endsWith('/runs/42')) return state.interrupt ? route.abort('internetdisconnected') :
      send(state.hold?{status:'in_progress'}:{status:'completed',conclusion:partial?'failure':'success'});
    if(path.endsWith('/runs/43')) return send({status:'completed',conclusion:'success'});
    if(path.endsWith('/runs/42/artifacts')) return send({artifacts:[{id:2,workflow_run:{id:42}}]});
    if(path.endsWith('/runs/43/artifacts')) return send({artifacts:[{id:1,workflow_run:{id:43}}]});
    if(path.endsWith('/artifacts/1/zip')) return zip({version:1,verified:[],snapshot:initial});
    if(path.endsWith('/artifacts/2/zip')) return zip(partial?{
      version:1,snapshot:{...saved,current:[dinnerRows[1]]},verified:[dinnerRows[1]],
      operations:[{label:'Friday dinner AC off',status:'confirmed'},{label:'Friday dinner AC on',status:'not_attempted'}],
      error:'The schedule was only partially applied. Review the Alexa snapshot.',
    }:{version:1,verified:dinnerRows,snapshot:saved,operations:[]});
    if(path.endsWith('/artifacts')) return send({artifacts:[{id:1,created_at:'2026-11-27T10:00:01Z'}]},state.firstStatus);
    return send({},404);
  });
  return state;
}

async function connect(page) {
  await page.goto('/');
  await page.getByRole('button',{name:'Connect GitHub',exact:true}).click();
  await page.getByLabel('GitHub token').fill(fakeToken);
  await page.getByRole('button',{name:'Connect',exact:true}).click();
}
async function review(page) {
  const dinner=page.locator('#ac details').first();
  await dinner.locator('summary').click();
  await dinner.getByRole('checkbox',{name:'Enabled'}).check();
  await page.getByRole('button',{name:'Review changes'}).click();
  await expect(page.locator('#reviewList')).toContainText('18:30');
  await expect(page.locator('#reviewList')).toContainText('20:00');
}

test('connect, review, apply, resume after reload, and keep the newer Alexa snapshot',async ({page,context})=>{
  const state=await mock(context);
  state.hold=true;
  await connect(page);
  await expect(page.locator('#githubStatus')).toHaveText('GitHub connected.');
  await review(page);
  await page.getByRole('button',{name:'Apply to Alexa',exact:true}).click();
  await expect(page.getByRole('link',{name:'View GitHub run'})).toHaveAttribute('href',/runs\/42$/);
  const other=await context.newPage();
  await other.addInitScript(value=>sessionStorage.setItem('shabbat-github-token-v1',value),fakeToken);
  await other.goto('/');
  await expect(other.getByRole('button',{name:'Apply to Alexa',exact:true})).toBeDisabled();
  await other.close();
  await page.reload();
  await expect(page.locator('#applyStatus')).toContainText('existing GitHub run');
  state.hold=false;
  await expect(page.locator('#applyStatus')).toHaveText('Alexa confirmed 2 changes.');
  await expect(page.locator('#timeline')).toContainText('Friday dinner AC on');
  await expect(page.locator('#timeline')).toContainText('23°C');
  await page.reload();
  await expect(page.locator('#githubStatus')).toHaveText('GitHub connected.');
  await page.getByRole('button',{name:'In Alexa'}).click();
  await expect(page.locator('#timeline')).toContainText('Friday dinner AC on');
  expect(state.dispatches).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(await page.evaluate(()=>document.documentElement.clientWidth));
});

test('loads after a permission error and reports a partial result from the actual run',async ({page,context})=>{
  const state=await mock(context,{partial:true,firstStatus:403});
  await connect(page);
  await expect(page.locator('#githubStatus')).toContainText('private aisrael615/shabbat-dashboard');
  state.firstStatus=200;
  await page.getByRole('button',{name:'Refresh Alexa'}).click();
  await expect(page.locator('#githubStatus')).toHaveText('GitHub connected.');
  await review(page);
  await page.getByRole('button',{name:'Apply to Alexa',exact:true}).click();
  await expect(page.locator('#applyStatus')).toContainText('1 confirmed');
  await expect(page.locator('#outcomes')).toContainText('Not attempted · Friday dinner AC on');
  await expect(page.locator('#timeline')).toContainText('Friday dinner AC off');
  await expect(page.locator('#timeline')).not.toContainText('Friday dinner AC on');
});

test('resumes after losing the connection and prevents an older refresh from replacing live state',async ({page,context})=>{
  const state=await mock(context);
  await connect(page);
  await expect(page.locator('#githubStatus')).toHaveText('GitHub connected.');
  await review(page);
  state.interrupt=true;
  await page.getByRole('button',{name:'Apply to Alexa',exact:true}).click();
  await expect(page.locator('#applyStatus')).toContainText('Could not contact GitHub');
  state.interrupt=false;
  await page.getByRole('button',{name:'Check Apply status'}).click();
  await expect(page.locator('#applyStatus')).toHaveText('Alexa confirmed 2 changes.');
  await page.getByRole('button',{name:'Refresh Alexa'}).click();
  await expect(page.locator('#githubStatus')).toHaveText('GitHub connected.');
  await expect(page.locator('#timeline')).toContainText('Friday dinner AC on');
  expect(state.dispatches).toBe(2);
});

test('shows reviewed conflict removals before permitting Apply, without exposing JSON',async ({page,context})=>{
  const state=await mock(context,{withConflict:true});
  await connect(page);
  await expect(page.locator('#githubStatus')).toHaveText('GitHub connected.');
  await review(page);
  await expect(page.locator('#conflictList')).toHaveText('Remove Friday only · Daily AC off');
  await expect(page.locator('textarea')).toHaveCount(0);
  const apply=page.getByRole('button',{name:'Apply to Alexa',exact:true});
  await expect(apply).toBeDisabled();
  expect(state.dispatches).toBe(0);
  await page.getByRole('checkbox',{name:'I approve the listed routine removals'}).check();
  await apply.click();
  await expect(page.locator('#applyStatus')).toHaveText('Alexa confirmed 2 changes.');
  expect(state.dispatches).toBe(1);
});
