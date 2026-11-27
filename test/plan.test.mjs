import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictChanges, events, israelZone, reviewChanges, shabbatDates, slots } from '../plan.mjs';

const draft=()=>Object.fromEntries(slots.map(([key,,kind,day])=>[key,kind==='ac'
  ? {enabled:false,start:'18:30',end:'20:00',temp:23.5,fan:60} : {enabled:false,start:'00:00',day}]));
test('Friday to Saturday overnight crosses midnight using distinct local schedule days',()=>{
  const settings=draft();
  settings.overnight={enabled:true,start:'23:40',end:'00:00',temp:23.5,fan:60};
  assert.deepEqual(events(settings).filter(x=>x.enabled).map(x=>[x.day,x.time]),[[0,'23:40'],[1,'00:00']]);
});
test('overlaps, malformed times, values, and unsupported device options are rejected',()=>{
  const settings=draft();
  settings.dinner.enabled=true;
  settings.overnight={...settings.overnight,enabled:true,start:'19:00'};
  assert.throws(()=>events(settings),/overlap/);
  for(const patch of [{start:1830},{start:'24:00'},{temp:23.1},{fan:101},{end:'18:00'},{mode:'heat'}]){
    const variant=draft();
    variant.dinner={...variant.dinner,enabled:true,...patch};
    assert.throws(()=>events(variant));
  }
  assert.throws(()=>events({...draft(),lights:{enabled:true}}),/unsupported/);
});
test('Israel calendar dates and wall-clock times remain correct around daylight-saving changes',()=>{
  const local=new Intl.DateTimeFormat('en-GB',{timeZone:israelZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  assert.equal(local.format(new Date('2026-03-26T16:30:00Z')),'18:30');
  assert.equal(local.format(new Date('2026-03-27T15:30:00Z')),'18:30');
  assert.equal(local.format(new Date('2026-10-25T16:30:00Z')),'18:30');
  const dates=shabbatDates(new Date('2026-03-27T22:30:00Z')).map(d=>d.toISOString().slice(0,10));
  assert.deepEqual(dates,['2026-03-27','2026-03-28']);
  assert.deepEqual(shabbatDates(new Date('2026-03-28T19:00:00Z'),true).map(d=>d.getUTCDate()),[3,4]);
});
test('review includes creation, legacy repair and disable but omits an unchanged weekly routine',()=>{
  const settings=draft();
  settings.dinner.enabled=true;
  const current=[
    {key:'dinnerOn',name:'Shabbat Planner - dinnerOn',enabled:true,days:['FR'],time:'18:30',temp:23.5,fan:60,timezone:israelZone,weekly:true},
    {key:'dinnerOff',name:'Shabbat Planner Â· dinnerOff',enabled:true,days:['FR'],time:'20:00',timezone:israelZone,weekly:true},
    {key:'mainOpen',name:'Shabbat Planner - mainOpen',enabled:true,days:['SA'],time:'09:00',timezone:israelZone,weekly:true},
  ];
  settings.mainClose.enabled=true;
  assert.deepEqual(reviewChanges(events(settings),current,{mainClose:{position:0}}).map(e=>[e.key,e.disabled,e.position]),
    [['mainClose',false,0],['dinnerOff',false,undefined],['mainOpen',true,undefined]]);
});
test('conflict review preserves weekdays, checks AC windows, and flags complex routines',()=>{
  const settings=draft();
  settings.dinner.enabled=true;
  settings.mainClose={enabled:true,start:'20:30',day:0};
  const routine=(id,time,days,group,verb,editable=true)=>({id,name:id,time,days,actions:[{group,verb}],editable});
  const changes=conflictChanges(events(settings),[
    routine('a','19:00',['FR','SA','MO'],'ac','off'),
    routine('b','20:00',['FR'],'ac','off'),
    routine('c','20:01',['FR'],'ac','off'),
    routine('d','08:00',['FR'],'main','open'),
    routine('e','23:00',['FR'],'main','open'),
    routine('f',undefined,[],'main','close',false),
    routine('g','19:00',['FR'],'bedroom','close'),
  ]);
  assert.deepEqual(changes.map(row=>[row.id,row.change,row.keep]),[
    ['a','trim',['SA','MO']],['b','delete',[]],['e','delete',[]],['f','review',undefined],
  ]);
});
