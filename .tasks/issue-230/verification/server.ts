import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../../../packages/storage/src/index.ts';
import {Engine} from '../../../packages/runtime/src/index.ts';
import {blankDefinition,nodeSchema} from '../../../packages/core/src/index.ts';
import {startServer} from '../../../packages/server/src/start.ts';
const directory=mkdtempSync(join(tmpdir(),'interlock-230-implementation-'));
const database=join(directory,'fixture.db');const e=new Engine(new Store(database),process.cwd());
const workflows=[];
for(const name of ['Release pipeline','Issue triage','External approval']) {const d=blankDefinition();if(name==='External approval')d.nodes[1]=nodeSchema.parse({id:'agent',kind:'input',label:'Approval'});const w=e.create(name,'',d);e.publish(w.id);const run=e.start(w.id,null).run;workflows.push({id:w.id,name,runId:run.id});}
e.stop();e.store.close();
writeFileSync(join(directory,'resources.json'),JSON.stringify({directory,database,apiPort:4414,uiPort:5184,pid:process.pid,workflows},null,2));console.log(JSON.stringify({directory,database,workflows}));
await startServer({database,workdir:process.cwd(),ui:resolve('packages/ui/dist'),port:4414,connection:{command:'interlock',args:['mcp'],engineUrl:'http://127.0.0.1:4414',development:true}});
