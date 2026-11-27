import { deflateRawSync } from 'node:zlib';

export const snapshot = {
  version:1,revision:'a'.repeat(64),fetchedAt:'2026-11-27T10:00:00Z',
  current:[],shared:[],defaults:{},conflictRoutines:[],
};
export const dinnerRows = [
  {key:'dinnerOn',name:'Shabbat Planner - dinnerOn',time:'18:30',days:['FR'],enabled:true,temp:23,fan:60},
  {key:'dinnerOff',name:'Shabbat Planner - dinnerOff',time:'20:00',days:['FR'],enabled:true},
];
export const saved={...snapshot,revision:'b'.repeat(64),fetchedAt:'2026-11-27T10:01:00Z',current:dinnerRows};

export function artifact(result,compression=8) {
  const name=Buffer.from('shabbat-result.json');
  const json=Buffer.from(JSON.stringify(result),'utf8');
  const data=compression===8 ? deflateRawSync(json) : json;
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(compression,8);
  local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(compression,10);
  central.writeUInt32LE(data.length,20);
  central.writeUInt32LE(json.length,24);
  central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1,10);
  end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
