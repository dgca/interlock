// Adds deterministic boundary fixtures to the isolated runtime server DB only.
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../../packages/storage/src/index';
import { Engine } from '../../../packages/runtime/src/index';
import { blankDefinition, type ScheduleConfig } from '../../../packages/core/src/index';
const context=JSON.parse(readFileSync('/tmp/issue236-ui-context.json','utf8'));
if(!context.dir.includes('interlock-236-ui-'))throw new Error('Expected isolated fixture');
const store=new Store(join(context.dir,'state.db')),e=new Engine(store,process.cwd());
const c:ScheduleConfig={kind:'schedule',name:'Admission failure fixture',timing:{type:'interval',intervalMs:120000},input:{},bindings:{},overlapPolicy:'skip',missedFirePolicy:'run_once',pauseAfterConsecutiveFailures:1};
const d=blankDefinition();d.inputSchema={type:'object',required:['missing']};const w=e.create('Failure attention fixture','',d);e.publish(w.id);
const t=e.triggers.mutate({action:'create',workflowId:w.id,config:c}).trigger!;t.enabled=true;t.nextFireAt=new Date().toISOString();store.put('workflowTriggers',t);e.pump();
const lagDefinition={...blankDefinition(),maxActiveRuns:1};const lagWorkflow=e.create('Queue lag fixture','',lagDefinition);e.publish(lagWorkflow.id);e.start(lagWorkflow.id,{});
const lag=e.triggers.mutate({action:'create',workflowId:lagWorkflow.id,config:{...c,name:'Queue lag fixture',overlapPolicy:'queue',pauseAfterConsecutiveFailures:null}}).trigger!;
lag.enabled=true;lag.anchorAt=new Date(Date.now()-210000).toISOString();lag.nextFireAt=new Date(Date.now()-90000).toISOString();store.put('workflowTriggers',lag);e.pump();e.pump();
writeFileSync('/tmp/issue236-ui-states.json',JSON.stringify({failureWorkflowId:w.id,failureTriggerId:t.id,lagWorkflowId:lagWorkflow.id,lagTriggerId:lag.id},null,2));
e.stop();store.close();console.log('Created isolated actual-runtime failure and late-queue fixtures');
