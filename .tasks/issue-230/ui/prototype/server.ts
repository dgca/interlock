import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../../../packages/storage/src/index.ts';
import { Engine } from '../../../../packages/runtime/src/index.ts';
import { startServer } from '../../../../packages/server/src/start.ts';
const temporary=mkdtempSync(join(tmpdir(),'interlock-230-ui-'));
const database=join(temporary,'fixture.db');
const store=new Store(database); const engine=new Engine(store,process.cwd());
const definition={inputSchema:{},outputSchema:{},nodes:[{id:'start',kind:'entry',label:'Start',position:{x:0,y:100},inputSchema:{},outputSchema:{}},{id:'build',kind:'agent',label:'Build',prompt:'Fixture only. Do not execute.',position:{x:300,y:100},inputSchema:{},outputSchema:{},context:{mode:'current',tools:[],skills:[]}},{id:'finish',kind:'exit',label:'Complete',position:{x:600,y:100},inputSchema:{},outputSchema:{}}],edges:[{id:'a',source:'start',target:'build',port:'default'},{id:'b',source:'build',target:'finish',port:'default'}],maxSteps:100};
for(const [name,desc] of [['Release pipeline','Build, review, and deploy an approved change.'],['Issue triage','Review incoming work and assign the next action.'],['Documentation check','Check documentation changes against the current product.']]) {const wf=engine.create(name,desc,definition);engine.publish(wf.id);}
engine.stop();store.close();
console.log('Task-owned fixture database:',database);
await startServer({database,workdir:process.cwd(),ui:resolve(import.meta.dirname),port:4413,connection:{command:'interlock',args:['mcp'],engineUrl:'http://127.0.0.1:4413',development:true}});

