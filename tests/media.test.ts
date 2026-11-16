import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { registerMedia, mediaUsage } from '../server/media.js';

async function fixture(t:TestContext, limitBytes?:number) {
  const dir=await mkdtemp(join(tmpdir(),'uz-media-test-'));
  const ctx=createApp({dataDir:dir,registerExtras:ctx=>registerMedia(ctx,{minFreeBytes:0,limitBytes})});
  const server=ctx.app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  let cookie='',csrf='',version=0;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));ctx.db.close();await rm(dir,{recursive:true,force:true});});
  const json=async(method:string,path:string,body?:Record<string,unknown>)=>{
    const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(path==='/setup'?body:{profileVersion:version,...body})}:{})});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];
    const data=await response.json() as any;
    if(data.csrfToken)csrf=data.csrfToken;if(data.profileVersion!==undefined)version=data.profileVersion;
    return{status:response.status,data};
  };
  assert.equal((await json('POST','/setup',{password:'Nur ein Kennwort für Tests!'})).status,201);
  await json('POST','/profile',{profileId:'karla'});
  const project=(await json('POST','/projects',{title:'Foto-Test',requestId:randomUUID()})).data;
  const upload=async(buffer:Buffer,fields:Record<string,string>={},authorized=true)=>{
    const form=new FormData();
    for(const[k,v]of Object.entries({projectId:project.id,profileVersion:String(version),title:'Unser Bild',category:'before',requestId:randomUUID(),...fields}))form.append(k,String(v));
    form.append('file',new Blob([new Uint8Array(buffer)]),'beliebiger-name.jpg');
    const response=await fetch(base+'/api/photos',{method:'POST',headers:{Origin:base,...(authorized?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},body:form});
    return{status:response.status,data:await response.json() as any};
  };
  return{ctx,dir,base,json,project,upload,headers:()=>({Cookie:cookie})};
}

test('photos validate content, preserve originals, orient previews and protect every file',async t=>{
  const f=await fixture(t);
  const input=await sharp({create:{width:400,height:200,channels:3,background:'#aabbcc'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  assert.equal((await f.upload(input,{},false)).status,401);
  const created=await f.upload(input);assert.equal(created.status,201);
  assert.equal(created.data.createdBy,'karla');assert.equal(created.data.width,200);assert.equal(created.data.height,400);
  assert.ok(mediaUsage(f.ctx)>input.length);
  for(const variant of ['display','thumb','original']){
    assert.equal((await fetch(`${f.base}/api/photos/${created.data.id}/file?variant=${variant}`)).status,401);
    const response=await fetch(`${f.base}/api/photos/${created.data.id}/file?variant=${variant}`,{headers:f.headers()});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const data=Buffer.from(await response.arrayBuffer());
    if(variant==='original')assert.deepEqual(data,input);
    else{const meta=await sharp(data).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.equal(meta.orientation,undefined);}
  }
  assert.equal((await f.upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).status,422);
  assert.equal((await f.upload(Buffer.from('not an image'))).status,422);
  assert.equal(f.ctx.db.list('photos').length,1);
});

test('photo retries are idempotent and referenced images cannot disappear from comparisons',async t=>{
  const f=await fixture(t);
  const input=await sharp({create:{width:30,height:20,channels:3,background:'#abcdef'}}).png().toBuffer();
  const requestId=randomUUID();const a=await f.upload(input,{requestId});
  const again=await f.upload(input,{requestId});assert.equal(again.data.id,a.data.id);assert.equal(f.ctx.db.list('photos').length,1);
  assert.equal((await f.upload(input,{requestId,title:'Andere Bedeutung'})).status,409);
  const b=await f.upload(input,{category:'after'});
  const pair=await f.json('POST','/comparisons',{projectId:f.project.id,title:'Vorher und Nachher',beforeId:a.data.id,afterId:b.data.id,requestId:randomUUID()});assert.equal(pair.status,201);
  const rejected=await f.json('PATCH',`/photos/${a.data.id}`,{version:a.data.version,deletedAt:new Date().toISOString()});assert.equal(rejected.status,409);
  await f.json('PATCH',`/comparisons/${pair.data.id}`,{version:pair.data.version,archivedAt:new Date().toISOString()});
  const trashed=await f.json('PATCH',`/photos/${a.data.id}`,{version:a.data.version,deletedAt:new Date().toISOString()});assert.equal(trashed.status,200);
  assert.equal((await fetch(`${f.base}/api/photos/${a.data.id}/file`,{headers:f.headers()})).status,404);
  assert.equal((await f.json('PATCH',`/photos/${a.data.id}`,{version:a.data.version,title:'veralteter Stand'})).status,409);
  const restored=await f.json('PATCH',`/photos/${a.data.id}`,{version:trashed.data.version,deletedAt:null});assert.equal(restored.status,200);
  assert.equal((await fetch(`${f.base}/api/photos/${a.data.id}/file`,{headers:f.headers()})).status,200);
});

test('media budget is enforced before writing a valid image record',async t=>{
  const f=await fixture(t,100);
  const input=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
  assert.equal((await f.upload(input)).status,507);assert.equal(f.ctx.db.list('photos').length,0);
});

test('HEIC sample decodes through the isolated worker when the optional local QA fixture is present',async t=>{
  let input:Buffer;
  try{input=await readFile(join(process.cwd(),'.qa','example.heic'));}catch{t.skip('Optional public libheif sample not downloaded; no network access during tests.');return;}
  const f=await fixture(t);const result=await f.upload(input);
  assert.equal(result.status,201);assert.equal(result.data.mime,'image/heic');assert.ok(result.data.width>0);
});
