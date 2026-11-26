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

export function events(settings) {
  const output = [];
  const periods = [];
  for (const [key,label,kind,first,last] of slots) {
    const row = settings?.[key];
    if (!row || typeof row.enabled !== 'boolean') throw Error(`Missing setting for ${label}`);
    const ac = kind === 'ac';
    const day = ac ? first : row.day;
    if (!ac && day !== 0 && day !== 1) throw Error(`Choose a day for ${label}`);
    if (!timePattern.test(row.start) || (ac && !timePattern.test(row.end))) throw Error(`Enter valid times for ${label}`);
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
