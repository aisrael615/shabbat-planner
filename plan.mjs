export const slots = [
  ['dinner','Friday dinner','ac',0,0], ['overnight','Overnight','ac',0,1],
  ['kiddush','Kiddush','ac',1,1], ['lunch','Lunch','ac',1,1],
  ['bedroomOpen','Bedroom blinds open','device',1], ['bedroomClose','Bedroom blinds close','device',0],
  ['mainOpen','Main blinds open','device',1], ['mainClose','Main blinds close','device',0],
  ['couchOn','Couch on','device',1], ['couchOff','Couch off','device',0],
];
export const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const clock = value => `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
export const israelZone='Asia/Jerusalem';
const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:israelZone,year:'numeric',month:'2-digit',day:'2-digit'});
export function shabbatDates(now,next=false) {
  const parts=Object.fromEntries(localDate.formatToParts(now).map(part=>[part.type,part.value]));
  const friday=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),12));
  const day=friday.getUTCDay();
  friday.setUTCDate(friday.getUTCDate()+(day===6?-1:(5-day+7)%7)+(next?7:0));
  const saturday=new Date(friday);
  saturday.setUTCDate(saturday.getUTCDate()+1);
  return [friday,saturday];
}

export function reviewChanges(draft,current,defaults) {
  return draft.flatMap(event=>{
    const previous=current.find(row=>row.key===event.key);
    if(!event.enabled && !previous?.enabled) return [];
    if(event.enabled && previous?.enabled && previous.name==='Shabbat Planner - '+event.key &&
      previous.days.join(',')===(event.day===0?'FR':'SA') && previous.time===event.time &&
      previous.timezone===israelZone && previous.weekly===true &&
      (event.temp===undefined || (previous.temp===event.temp && previous.fan===event.fan))) return [];
    const previousTime=!event.enabled && previous?.time;
    return [{...event,disabled:!event.enabled,position:defaults[event.key]?.position,
      ...(previousTime?{time:previous.time,day:previous.days.includes('SA')?1:0}:{})}];
  });
}

export function conflictChanges(draft,routines) {
  const enabled=draft.filter(event=>event.enabled);
  const days=['FR','SA'];
  const point=(day,time)=>day*1440+minutes(time);
  return routines.flatMap(routine=>{
    const relevant=enabled.filter(event=>routine.actions.some(action=>{
      if(action.group==='ac') return event.temp!==undefined;
      return event.key.startsWith(action.group);
    }));
    if(!relevant.length) return [];
    if(!routine.editable) return [{...routine,change:'review'}];
    const remove=routine.days.filter(day=>{
      const index=days.indexOf(day);
      if(index<0) return false;
      return relevant.some(event=>{
        if(routine.actions.some(action=>action.group==='ac')) {
          const end=draft.find(end=>end.key===event.key.replace(/On$/,'Off'));
          const at=point(index,routine.time);
          return at>=point(event.day,event.time) && at<=point(end.day,end.time);
        }
        const verb=event.key.match(/(Open|Close|On|Off)$/)?.[0].toLowerCase();
        return event.day===index && (routine.actions.some(action=>action.verb===verb) || event.time<=routine.time);
      });
    });
    if(!remove.length) return [];
    const keep=routine.days.filter(day=>!remove.includes(day));
    if(keep.length && routine.canTrim===false) return [{...routine,change:'review'}];
    return [{...routine,change:keep.length?'trim':'delete',remove,keep}];
  }).sort((a,b)=>a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function events(settings) {
  if(!settings || typeof settings!=='object' || Array.isArray(settings) ||
    Object.keys(settings).some(key=>!slots.some(slot=>slot[0]===key))) throw Error('Schedule contains an unsupported device or period');
  const output = [];
  const periods = [];
  for (const [key,label,kind,first,last] of slots) {
    const row = settings?.[key];
    if (!row || typeof row.enabled !== 'boolean') throw Error(`Missing setting for ${label}`);
    const ac = kind === 'ac';
    const fields=ac?['enabled','start','end','temp','fan',...(key==='dinner'?['startOffset','endOffset']:[])]:['enabled','start','day'];
    if(Object.keys(row).some(field=>!fields.includes(field))) throw Error(`Unsupported setting for ${label}`);
    const day = ac ? first : row.day;
    if (!ac && day !== 0 && day !== 1) throw Error(`Choose a day for ${label}`);
    if (typeof row.start!=='string' || !timePattern.test(row.start) ||
      (ac && (typeof row.end!=='string' || !timePattern.test(row.end)))) throw Error(`Enter valid times for ${label}`);
    if (ac && (typeof row.temp !== 'number' || !Number.isInteger(row.temp*2) || row.temp < 16 || row.temp > 30 ||
        !Number.isInteger(row.fan) || row.fan < 0 || row.fan > 100)) throw Error(`Check the temperature and fan for ${label}`);
    output.push({key: ac ? key+'On' : key,label: ac ? label+' AC on' : label,day,time:row.start,enabled:row.enabled,...(ac ? {temp:row.temp,fan:row.fan} : {})});
    if (ac) {
      output.push({key:key+'Off',label:label+' AC off',day:last,time:row.end,enabled:row.enabled});
      if (row.enabled) {
        const start = day * 1440 + minutes(row.start);
        const end = last * 1440 + minutes(row.end);
        if (end <= start) throw Error(`${label} must end after it starts`);
        periods.push({start,end,label});
      }
    }
  }
  periods.sort((a,b) => a.start-b.start);
  for (let i=1; i<periods.length; i++) {
    if (periods[i].start <= periods[i-1].end) throw Error(`${periods[i-1].label} and ${periods[i].label} overlap or touch. Leave at least one minute between periods.`);
  }
  return output.sort((a,b) => a.day-b.day || a.time.localeCompare(b.time));
}
