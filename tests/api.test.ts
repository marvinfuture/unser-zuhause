import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { createApp } from '../server/app.js';
import type { Session, Photo } from '../shared/types.js';

const PASSWORD = 'Ein sehr gutes Testkennwort!';
class Client {
  cookie = '';
  csrf = '';
  profileVersion = 0;
  constructor(readonly base: string) {}
  async send(method: string, path: string, body?: unknown, extra: {csrf?:boolean;origin?:string;headers?:Record<string,string>} = {}) {
    const response = await fetch(this.base+path,{method,headers:{...(body !== undefined ? {'Content-Type':'application/json'} : {}),...(this.cookie ? {Cookie:this.cookie} : {}),...(extra.csrf !== false && this.csrf ? {'X-CSRF-Token':this.csrf} : {}),Origin:extra.origin ?? this.base,...extra.headers},body:body === undefined ? undefined : JSON.stringify(body)});
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = await response.json() as any;
    if (typeof result.authenticated === 'boolean') {
      const session = result as Session;
      this.csrf = session.csrfToken ?? '';
      this.profileVersion = session.profileVersion;
    }
    return {status:response.status,body:result,headers:response.headers};
  }
  create(collection: string, fields: Record<string,unknown>, requestId=randomUUID()) {return this.send('POST',`/api/${collection}`,{...fields,requestId,profileVersion:this.profileVersion});}
  patch(collection: string, record: {id:string;version:number}, fields: Record<string,unknown>) {return this.send('PATCH',`/api/${collection}/${record.id}`,{...fields,version:record.version,profileVersion:this.profileVersion});}
  choose(profileId: 'karla'|'marvin') {return this.send('POST','/api/profile',{profileId,profileVersion:this.profileVersion});}
}
async function fixture(t: TestContext, setup=true) {
  const dir = await mkdtemp(join(tmpdir(),'unser-zuhause-api-'));
  const ctx = createApp({dataDir:dir,secureCookies:false});
  const server = ctx.app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new Client(`http://127.0.0.1:${address.port}`);
  t.after(async () => {server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));ctx.db.close();await rm(dir,{recursive:true,force:true});});
  if (setup) {assert.equal((await client.send('POST','/api/setup',{password:PASSWORD})).status,201);assert.equal((await client.choose('karla')).status,200);}
  return {ctx,client,dir,newClient:() => new Client(client.base)};
}

test('shared access has no default password; local setup, CSRF, origin and session protection work',async t => {
  const {client,newClient} = await fixture(t,false);
  const empty = await client.send('GET','/api/session');
  assert.equal(empty.body.configured,false);
  assert.equal(empty.body.authenticated,false);
  const privateState = await client.send('GET','/api/state');
  assert.equal(privateState.status,401);
  assert.equal(privateState.headers.get('cache-control'),'no-store');
  const rebind = await new Promise<{status:number;body:any}>((done,fail) => {
    const outgoing=request(client.base+'/api/session',{headers:{Host:'rebinding.example'}},response => {
      let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>done({status:response.statusCode!,body:JSON.parse(text)}));
    });outgoing.on('error',fail);outgoing.end();
  });
  assert.equal(rebind.status,403);assert.equal(rebind.body.code,'HOST_NOT_ALLOWED');
  assert.equal((await client.send('POST','/api/setup',{password:'short'})).status,400);
  assert.equal((await client.send('POST','/api/setup',{password:PASSWORD},{origin:'https://evil.example'})).status,403);
  assert.equal((await client.send('POST','/api/setup',{password:PASSWORD},{headers:{'X-Forwarded-For':'192.168.1.20'}})).status,403);
  const setup = await client.send('POST','/api/setup',{password:PASSWORD});
  assert.equal(setup.status,201);
  assert.match(setup.headers.get('set-cookie') ?? '',/HttpOnly/);
  assert.match(setup.headers.get('set-cookie') ?? '',/SameSite=Strict/);
  assert.equal((await client.send('POST','/api/setup',{password:PASSWORD})).status,409);
  assert.equal((await client.create('rooms',{title:'Küche'})).body.code,'PROFILE_REQUIRED');
  assert.equal((await client.send('POST','/api/profile',{profileId:'karla',profileVersion:0},{csrf:false})).status,403);
  assert.equal((await client.choose('karla')).status,200);
  assert.equal((await client.send('POST','/api/rooms',{title:'Küche',requestId:randomUUID(),profileVersion:1},{origin:'https://evil.example'})).status,403);
  assert.equal((await newClient().send('POST','/api/login',{password:'wrong'})).status,401);
  const loginClient = newClient();
  assert.equal((await loginClient.send('POST','/api/login',{password:PASSWORD})).status,200);
  assert.equal((await loginClient.send('POST','/api/logout')).status,200);
  assert.equal((await loginClient.send('GET','/api/state')).status,401);
});

test('concurrent local setup has exactly one winner',async t => {
  const {client,newClient}=await fixture(t,false);
  const other=newClient();
  const outcomes=await Promise.all([client.send('POST','/api/setup',{password:PASSWORD}),other.send('POST','/api/setup',{password:'Anderes gültiges Startkennwort!'})]);
  assert.deepEqual(outcomes.map(result=>result.status).sort(),[201,409]);
  assert.equal(outcomes.find(result=>result.status===409)?.body.code,'ALREADY_CONFIGURED');
  const winner=outcomes[0].status===201 ? client : other;
  assert.equal((await winner.send('GET','/api/state')).status,200);
});

test('two devices retain attribution; profile and record conflicts never silently overwrite',async t => {
  const {client:karla,newClient} = await fixture(t);
  const marvin = newClient();
  await marvin.send('POST','/api/login',{password:PASSWORD});await marvin.choose('marvin');
  const room = (await karla.create('rooms',{title:'Wohnzimmer'})).body;
  const project = (await karla.create('projects',{title:'Wände streichen',roomId:room.id,priority:'high'})).body;
  const task = (await karla.create('tasks',{title:'Abkleben',projectId:project.id,roomId:room.id,assignees:['marvin'],priority:'urgent',dueDate:'2026-12-12'})).body;
  assert.equal(task.createdBy,'karla');
  const completed = await marvin.patch('tasks',task,{status:'done'});
  assert.equal(completed.status,200);
  assert.equal(completed.body.createdBy,'karla');
  assert.equal(completed.body.updatedBy,'marvin');
  assert.equal(completed.body.completedBy,'marvin');
  assert.equal(completed.body.projectId,project.id);
  assert.equal(completed.body.priority,'urgent');
  assert.equal(completed.body.dueDate,'2026-12-12');
  assert.deepEqual(completed.body.assignees,['marvin']);
  const stale = await karla.patch('tasks',task,{title:'Alter Entwurf'});
  assert.equal(stale.status,409);assert.equal(stale.body.code,'VERSION_CONFLICT');assert.equal(stale.body.record.status,'done');
  const oldVersion = karla.profileVersion;
  await karla.choose('marvin');
  const switched = await karla.send('POST','/api/rooms',{title:'Falsche Zuordnung',requestId:randomUUID(),profileVersion:oldVersion});
  assert.equal(switched.status,409);assert.equal(switched.body.code,'PROFILE_CHANGED');
  assert.equal((await marvin.send('GET','/api/session')).body.profileId,'marvin');
  const state = (await marvin.send('GET','/api/state')).body;
  assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].title,'Abkleben');
  assert.ok(state.notes.some((note:any) => note.body.includes('erledigt') && note.createdBy === 'marvin'));
});

test('validation rejects forged authors, invalid references, quantities and impossible dates',async t => {
  const {client} = await fixture(t);
  assert.equal((await client.create('rooms',{title:'Bad',createdBy:'marvin'})).status,400);
  assert.equal((await client.create('tasks',{title:'A',priority:'super'})).status,400);
  assert.equal((await client.create('tasks',{title:'A',projectId:randomUUID()})).body.code,'INVALID_REFERENCE');
  assert.equal((await client.create('tasks',{title:'A',dueDate:'2026-02-30'})).status,400);
  assert.equal((await client.create('tasks',{title:'A',startDate:'2026-12-12',dueDate:'2026-12-10'})).status,400);
  assert.equal((await client.create('shopping',{title:'Farbe',quantity:-1})).status,400);
  assert.equal((await client.create('shopping',{title:'Farbe',unitPriceCents:1.5})).status,400);
  const item = (await client.create('shopping',{title:'Farbe',quantity:2,unit:'Liter'})).body;
  assert.equal(item.unitPriceCents,null);
  const purchased = (await client.patch('shopping',item,{purchased:true})).body;
  assert.equal(purchased.quantity,2);assert.equal(purchased.unit,'Liter');assert.equal(purchased.purchasedBy,'karla');
  const undone = (await client.patch('shopping',purchased,{purchased:false})).body;
  assert.equal(undone.purchasedBy,null);
  const archived = (await client.patch('shopping',undone,{archivedAt:new Date().toISOString()})).body;
  assert.ok(archived.archivedAt);
  const restored = (await client.patch('shopping',archived,{archivedAt:null})).body;
  assert.equal(restored.archivedAt,null);
});

test('retries create one entity and one activity; reused request IDs cannot change content',async t => {
  const {client} = await fixture(t);
  const requestId = randomUUID();
  const [first,second] = await Promise.all([client.create('projects',{title:'Küche'},requestId),client.create('projects',{title:'Küche'},requestId)]);
  assert.deepEqual([first.status,second.status].sort(),[200,201]);
  assert.equal(first.body.id,second.body.id);
  const state = (await client.send('GET','/api/state')).body;
  assert.equal(state.projects.length,1);assert.equal(state.notes.length,1);
  const reused = await client.create('projects',{title:'Badezimmer'},requestId);
  assert.equal(reused.status,409);assert.equal(reused.body.code,'IDEMPOTENCY_CONFLICT');
  const event = state.notes[0];
  assert.equal((await client.patch('notes',event,{body:'Erfunden'})).body.code,'READ_ONLY');
});

test('comparisons accept only available different photos from the same project',async t => {
  const {ctx,client} = await fixture(t);
  const project = (await client.create('projects',{title:'Boden'})).body;
  const otherProject = (await client.create('projects',{title:'Bad'})).body;
  const photo = (projectId:string,deletedAt:string|null=null):Photo => ({id:randomUUID(),projectId,defectId:null,title:'Bild',category:'before',width:100,height:100,bytes:100,mime:'image/jpeg',deletedAt,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:'karla',updatedBy:'karla',version:1,archivedAt:null});
  const before=photo(project.id),after=photo(project.id),wrong=photo(otherProject.id),trashed=photo(project.id,new Date().toISOString());
  for (const p of [before,after,wrong,trashed]) ctx.db.put('photos',p);
  const fields={projectId:project.id,title:'Vorher / Nachher',beforeId:before.id,afterId:after.id};
  assert.equal((await client.create('comparisons',{...fields,afterId:wrong.id})).status,400);
  assert.equal((await client.create('comparisons',{...fields,afterId:trashed.id})).status,400);
  assert.equal((await client.create('comparisons',{...fields,afterId:before.id})).status,400);
  assert.equal((await client.create('comparisons',{...fields,beforeZoom:10})).status,400);
  const valid=await client.create('comparisons',fields);
  assert.equal(valid.status,201);assert.equal(valid.body.beforeX,50);assert.equal(valid.body.afterZoom,1);
});

test('password changes revoke other devices and sessions remain server controlled',async t => {
  const {client,newClient} = await fixture(t);
  const other=newClient();await other.send('POST','/api/login',{password:PASSWORD});
  const oldCookie=client.cookie;
  const changed=await client.send('POST','/api/password',{currentPassword:PASSWORD,newPassword:'Ein anderes langes Kennwort!'});
  assert.equal(changed.status,200);assert.notEqual(client.cookie,oldCookie);assert.equal(changed.body.profileId,null);
  assert.equal((await other.send('GET','/api/state')).status,401);
  assert.equal((await other.send('POST','/api/login',{password:PASSWORD})).status,401);
  assert.equal((await other.send('POST','/api/login',{password:'Ein anderes langes Kennwort!'})).status,200);
});

test('database and migration survive reopening without seed data or resets',async t => {
  const {ctx,client,dir}=await fixture(t);
  const room=(await client.create('rooms',{title:'Garten'})).body;
  const second=createApp({dataDir:dir});
  try {
    assert.equal(second.db.get('rooms',room.id)?.id,room.id);
    assert.equal(second.db.list('rooms').length,1);
    assert.ok(second.db.getSetting('passwordHash'));
    assert.equal((ctx.db.raw.prepare('SELECT count(*) n FROM migrations').get() as {n:number}).n,1);
  } finally {second.db.close();}
});
