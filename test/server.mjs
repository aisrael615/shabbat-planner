import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const types={'/index.html':'text/html','/app.mjs':'text/javascript','/github.mjs':'text/javascript',
  '/plan.mjs':'text/javascript','/style.css':'text/css'};
createServer(async (request,response)=>{
  let path=new URL(request.url,'http://localhost').pathname;
  if(path==='/')path='/index.html';
  if(!Object.hasOwn(types,path)){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':types[path]+'; charset=utf-8'});
  response.end(await readFile(new URL('..'+path,import.meta.url)));
}).listen(4173,'127.0.0.1');
