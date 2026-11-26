import { slots, events, minutes, clock, timePattern } from './plan.mjs';

const $ = id => document.getElementById(id);
const zone='Asia/Jerusalem';
const formatDate=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const formatTime=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const days=['Friday','Saturday'];
const codes=['FR','SA'];
const key='shabbat-planner-v1';
let saved={};
try { saved=JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Start with a clean editor. */ }
let snapshot=saved.snapshot;
let settings=saved.settings;
let view='draft';
let markers=[null,null];
let forecast=null;
let week;
const workflowPattern=/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/workflows\/[\w.-]+\.ya?ml$/;

function element(tag,text,className) {
  const node=document.createElement(tag);
  if(text !== undefined) node.textContent=text;
  if(className) node.className=className;
  return node;
}
function persist() {
  try { localStorage.setItem(key,JSON.stringify({snapshot,settings,workflow:$('workflow').value})); } catch { /* The editor works without storage. */ }
}
function displayDay(date) {
  return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}).format(date);
}
function dateKey(date){return date.toISOString().slice(0,10);}
function setWeek(next=false) {
  const today=new Date(formatDate.format(new Date())+'T12:00:00Z');
  const friday=new Date(today);
  const weekday=today.getUTCDay();
  const distance=weekday===6 ? -1 : (5-weekday+7)%7;
  friday.setUTCDate(friday.getUTCDate()+distance+(next ? 7 : 0));
  const saturday=new Date(friday);
  saturday.setUTCDate(saturday.getUTCDate()+1);
  week=[friday,saturday];
}
function defaults() {
  const current = name => snapshot?.current.find(row=>row.key===name);
  const seed=snapshot?.defaults ?? {};
  const base={dinner:['18:30','20:00'],overnight:['21:30','08:30'],kiddush:['10:20','11:30'],lunch:['12:00','12:30']};
  const fallback={bedroomOpen:'07:45',bedroomClose:'21:30',mainOpen:'07:45',mainClose:'22:00',couchOn:'07:30',couchOff:'22:00'};
  return Object.fromEntries(slots.map(([id,,kind,day])=>{
    const ac=kind==='ac';
    const first=current(ac?id+'On':id);
    const last=current(id+'Off');
    const source=seed[id] ?? {};
    const start=first?.time ?? (id==='dinner' ? base[id][0] : source.time) ?? (ac ? base[id][0] : fallback[id]);
    if (!ac) return [id,{start,day: first ? (first.days.includes('SA')?1:0) : day,enabled:first?.enabled ?? false}];
    return [id,{start,end:last?.time ?? seed[id+'Off']?.time ?? base[id][1],
      enabled:first?.enabled ?? false,temp:first?.temp ?? source.temp ?? 23,fan:first?.fan ?? source.fan ?? 60,
      ...(id==='dinner' ? {startOffset:60,endOffset:150} : {})}];
  }));
}
function field(label,node) {
  const wrap=element('label',label);
  wrap.append(node);
  return wrap;
}
function input(id,name,label,type,options={}) {
  const control=element('input');
  Object.assign(control,{type,...options});
  if(type==='checkbox') control.checked=settings[id][name];
  else control.value=settings[id][name];
  control.addEventListener('input',()=>{
    settings[id][name]=type==='checkbox'?control.checked:type==='number'?control.valueAsNumber:control.value;
    updated();
  });
  return field(label,control);
}
function suggestDinner() {
  const row=settings.dinner;
  if (!markers[0] || !Number.isInteger(row.startOffset) || !Number.isInteger(row.endOffset)) return null;
  const sunset=minutes(markers[0]);
  const start=sunset+row.startOffset;
  const end=sunset+row.endOffset;
  return start>=0 && start<1440 && end>=0 && end<1440 && end>start ? [clock(start),clock(end)] : null;
}
function renderEditor(open) {
  $('ac').replaceChildren();
  $('devices').replaceChildren();
  for (const [id,label,kind] of slots) {
    const ac=kind==='ac';
    const details=element('details',undefined,'row');
    details.open=id===open;
    details.append(element('summary',label));
    const fields=element('div',undefined,'fields');
    const toggle=input(id,'enabled','Enabled ','checkbox');
    toggle.className='wide';
    fields.append(toggle);
    if (!ac) {
      const select=element('select');
      for (const [day,label] of days.entries()) { const option=element('option',label);option.value=day;select.append(option); }
      select.value=settings[id].day;
      select.addEventListener('change',()=>{settings[id].day=Number(select.value);updated();});
      fields.append(field('Day',select));
    }
    fields.append(input(id,'start',ac?'Starts':'Time','time'));
    if(ac) fields.append(input(id,'end','Ends','time'),input(id,'temp','Temperature °C','number',{min:16,max:30}),
      input(id,'fan','Fan % (0 is auto if supported)','number',{min:0,max:100}));
    if(id==='dinner') {
      fields.append(input(id,'startOffset','Start offset from candle lighting (min)','number'),
        input(id,'endOffset','End offset from candle lighting (min)','number'));
      const hint=element('p','','hint wide');hint.id='dinnerSuggestion';
      const button=element('button','Use suggested times');button.type='button';button.id='useDinnerSuggestion';
      button.addEventListener('click',()=>{const suggestion=suggestDinner();if(!suggestion)return;
        [settings.dinner.start,settings.dinner.end]=suggestion;renderEditor('dinner');updated();});
      fields.append(hint,button);
    }
    details.append(fields);
    $(ac?'ac':'devices').append(details);
  }
}
function stat(label,value) {
  const node=element('div',undefined,'stat');
  node.append(element('span',label),element('strong',value));
  return node;
}
function renderContext() {
  $('weekend').replaceChildren(stat('Outdoor now',forecast?.current ? `${Math.round(forecast.current.temperature_2m)}°C`:'Unavailable'));
  week.forEach((date,i)=>{
    const index=forecast?.daily?.time?.indexOf(dateKey(date)) ?? -1;
    const high=forecast?.daily?.temperature_2m_max?.[index];
    const low=forecast?.daily?.temperature_2m_min?.[index];
    $('weekend').append(stat(displayDay(date),Number.isFinite(high)&&Number.isFinite(low)?`${Math.round(high)}° / ${Math.round(low)}°C`:'Forecast unavailable'),
      stat(i?'Havdalah':'Candle lighting',markers[i] ?? 'Unavailable'));
  });
}
function timeline(target,rows,{context=false}={}) {
  target.replaceChildren();
  for (const [day,date] of week.entries()) {
    const relevant=rows.filter(row=>row.day===day).slice();
    if(context && markers[day]) relevant.push({time:markers[day],label:day?'Havdalah':'Candle lighting',marker:true});
    relevant.sort((a,b)=>a.time.localeCompare(b.time));
    target.append(element('h3',displayDay(date)));
    if(!relevant.length){target.append(element('p','No scheduled actions.'));continue;}
    const list=element('ul',undefined,'day');
    for(const row of relevant){
      const item=element('li',undefined,`item ${row.marker?'marker':row.existing?'existing':''}`);
      const label=element('span',row.label);
      if(row.temp!==undefined) label.append(element('small',`${row.temp}°C · fan ${row.fan}%`));
      if(row.existing) label.append(element('small','Existing routine'));
      if(row.disabled) label.append(element('small','Will be disabled'));
      item.append(element('time',row.time),label);list.append(item);
    }
    target.append(list);
  }
}
const scheduled = (rows,existing=false) => rows.flatMap(row=>row.enabled && timePattern.test(row.time)
  ? codes.flatMap((day,i)=>row.days?.includes(day) ? [{...row,day:i,label:slots.flatMap(([id,label,kind])=>
      kind==='ac'?[[id+'On',label+' AC on'],[id+'Off',label+' AC off']]:[[id,label]]).find(([id])=>id===row.key)?.[1] ?? row.name,existing}] : [])
  : []);
function render() {
  const shared=scheduled(snapshot?.shared ?? [],true);
  let draft=[];
  try{draft=events(settings);$('validation').textContent='';}catch(error){$('validation').textContent=error.message;}
  const current=scheduled(snapshot?.current ?? []);
  timeline($('timeline'),[...(view==='draft'?draft.filter(r=>r.enabled):current),...shared],{context:true});
  if(shared.length && view==='draft') $('timeline').append(element('p','Existing routines can still run during the proposed schedule. Review any conflicts in Alexa.','hint'));
  const suggestion=suggestDinner();
  $('dinnerSuggestion').textContent=suggestion?`This week’s suggestion · ${suggestion.join('–')}`:'Dinner suggestion unavailable. Check candle lighting and the offsets.';
  $('useDinnerSuggestion').disabled=!suggestion;
}
function updated() { $('review').hidden=true;persist();render(); }
function links(){
  const url=$('workflow').value.trim();
  for(const link of document.querySelectorAll('.workflowLink')){
    if(workflowPattern.test(url)) link.href=url;
    else link.removeAttribute('href');
  }
}
function toggleImport(show) {
  $('importPanel').hidden=!show;
  $('importToggle').setAttribute('aria-expanded',String(show));
  if(show) $('workflow').focus();
}
function connection(message) {
  $('connection').textContent=message ?? (snapshot ? 'Alexa snapshot · '+new Date(snapshot.fetchedAt).toLocaleString('en-IL',{timeZone:zone}) : 'Import a snapshot to see what Alexa is scheduled to run.');
}
$('workflow').value=saved.workflow ?? new URLSearchParams(location.search).get('workflow') ?? '';
$('workflow').addEventListener('input',()=>{links();persist();});
$('importToggle').addEventListener('click',()=>toggleImport($('importPanel').hidden));
$('import').addEventListener('click',()=>{
  try{
    const data=JSON.parse($('snapshot').value);
    if(!/^[a-f\d]{64}$/.test(data.revision)||!Number.isFinite(Date.parse(data.fetchedAt))||
      !Array.isArray(data.current)||!Array.isArray(data.shared)||!data.defaults) throw Error();
    const initial=!snapshot;
    snapshot=data;
    if(initial) { settings=defaults();renderEditor(); }
    $('snapshot').value='';connection();toggleImport(false);updated();
  }catch{connection('Could not read that snapshot. Copy the complete JSON from the private workflow’s Summary.');}
});
for(const button of document.querySelectorAll('[data-view]')) button.addEventListener('click',()=>{
  view=button.dataset.view;
  for(const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed',String(other===button));
  render();
});
$('editor').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    const draft=events(settings);
    if(!snapshot){toggleImport(true);throw Error('Import an Alexa snapshot before preparing Apply.');}
    if(!workflowPattern.test($('workflow').value.trim())){toggleImport(true);throw Error('Enter your private GitHub workflow URL first.');}
    const existing=new Set(snapshot.current.filter(row=>row.enabled).map(row=>row.key));
    timeline($('reviewList'),draft.filter(item=>item.enabled||existing.has(item.key)).map(item=>({...item,disabled:!item.enabled})));
    $('payload').value=JSON.stringify({revision:snapshot.revision,settings});
    $('copyStatus').textContent='';
    $('review').hidden=false;
    $('reviewTitle').focus();
  }catch(error){$('validation').textContent=error.message;}
});
$('copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('payload').value);$('copyStatus').textContent='Apply JSON copied.';}
  catch{$('payload').focus();$('payload').select();$('copyStatus').textContent='Select and copy the JSON manually.';}
});

async function get(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok) throw Error('Source unavailable');
  return response.json();
}
async function shabbatTimes() {
  const year=week[0].getUTCFullYear();
  const url='https://www.hebcal.com/hebcal?v=1&cfg=json&geo=geoname&geonameid=293842&c=on&b=18&m=50&M=off&i=on';
  const batches=await Promise.all([...new Set([year,week[1].getUTCFullYear()])].map(y=>get(url+'&year='+y)));
  const items=batches.flatMap(data=>data.items ?? []);
  const entries=week.map((date,i)=>items.find(item=>item.category===(i?'havdalah':'candles')&&item.date.startsWith(dateKey(date))));
  if(new Date()>=new Date(entries[1]?.date) && new Date().getTime() < week[1].getTime()+24*3600000) {
    setWeek(true);
    return shabbatTimes();
  }
  markers=entries.map(item=>item ? formatTime.format(new Date(item.date)):null);
}
setWeek();
settings=settings ?? defaults();
links();connection();renderEditor();renderContext();render();
shabbatTimes().then(()=>{renderContext();render();}).catch(()=>{});
get('https://api.open-meteo.com/v1/forecast?latitude=31.61&longitude=34.77&current=temperature_2m&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FJerusalem&forecast_days=9&past_days=1')
  .then(data=>{forecast=data;renderContext();}).catch(()=>{});
