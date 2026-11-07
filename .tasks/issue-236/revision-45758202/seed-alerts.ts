import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../../../packages/storage/src/index';
import {Engine} from '../../../packages/runtime/src/index';
const context=JSON.parse(readFileSync('/tmp/issue236-ui-context.json','utf8'));
if(!context.dir.includes('/interlock-236-ui-'))throw new Error('Expected isolated fixture');
const ids=JSON.parse(readFileSync('/tmp/issue236-ui-states.json','utf8'));
const store=new Store(join(context.dir,'state.db')),e=new Engine(store,process.cwd());
try{for(let i=1;i<=22;i++){const t=e.triggers.mutate({action:'create',workflowId:ids.failureWorkflowId,config:{name:`Revision alert ${String(i).padStart(2,'0')}`,timing:{type:'interval',intervalMs:120000},pauseAfterConsecutiveFailures:1}}).trigger!;t.enabled=true;t.nextFireAt=new Date().toISOString();store.put('workflowTriggers',t);}e.pump();writeFileSync('/tmp/issue236-revision-context.json',JSON.stringify({...context,...ids,alertCount:e.triggers.attention().total},null,2));}finally{e.stop();store.close();}
