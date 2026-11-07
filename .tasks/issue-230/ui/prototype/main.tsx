import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { BrowserRouter } from 'react-router';
import { MantineProvider, Button, Group, Text, TextInput, Textarea, Select, Badge, Alert, Stack } from '@mantine/core';
import { Pause, Play, Plus, ArrowLeft, Check, AlertCircle } from 'lucide-react';
import '@mantine/core/styles.css';
import '@xyflow/react/dist/style.css';
import '../../../../packages/ui/src/styles.css';
import { theme } from '../../../../packages/ui/src/theme/theme';
import { Sidebar } from '../../../../packages/ui/src/components/Sidebar/Sidebar';
import { WorkflowLibrary } from '../../../../packages/ui/src/features/workflows/WorkflowLibrary';
import { WorkflowEditor } from '../../../../packages/ui/src/features/workflows/WorkflowEditor';
import { Modal } from '../../../../packages/ui/src/components/Modal/Modal';
import { ModalBody, ModalFooter } from '../../../../packages/ui/src/components/Modal/ModalLayout';
import { api } from '../../../../packages/ui/src/lib/api';
import './prototype.css';

type Hold={id:string;scope:'library'|'workflow';workflowId?:string;actor:string;reason:string;createdAt:string};
const params=new URLSearchParams(location.search);
const baseline=params.get('baseline')==='1';
const view=params.get('view')??'library';
const initial:Hold[]=[
{id:'hold-deploy-01',scope:'library',actor:'deploy-bot',reason:'Deployment verification is in progress.',createdAt:'2026-11-07T07:10:00Z'},
{id:'hold-rate-limit-02',scope:'library',actor:'incident-handler',reason:'Provider rate limit. Investigating before retrying.',createdAt:'2026-11-07T07:12:00Z'},
{id:'hold-review-03',scope:'workflow',actor:'Dan',reason:'Review the release configuration before continuing.',createdAt:'2026-11-07T07:15:00Z'}];
function App(){
 const [workflows,setWorkflows]=useState<any[]>([]);
 const [holds,setHolds]=useState<Hold[]>(params.get('state')==='clear'?[]:initial);
 const [opened,setOpened]=useState(false),[add,setAdd]=useState(false);
 const [scope,setScope]=useState<'library'|'workflow'>('library');
 const [actor,setActor]=useState('Dan'),[reason,setReason]=useState('');
 const [confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [notice,setNotice]=useState(''),[failOnce,setFailOnce]=useState(params.get('failure')==='1');
 const [headerTarget,setHeaderTarget]=useState<HTMLElement|null>(null);
 const wf=workflows.find(w=>w.name==='Release pipeline');
 const workflowContext=view!=='library';
 const library=holds.filter(h=>h.scope==='library');
 const applicable=holds.filter(h=>h.scope==='library'||workflowContext);
 const local=holds.filter(h=>h.scope==='workflow');
 useEffect(()=>{api.workflows.list.query().then(setWorkflows);},[]);
 useEffect(()=>{if(view==='workflow'&&wf) {const t=setTimeout(()=>setHeaderTarget(document.querySelector('main header > div:last-child') as HTMLElement),300);return()=>clearTimeout(t);}},[wf]);
 const open=(s:'library'|'workflow',adding=false)=>{setScope(s);setAdd(adding);setOpened(true);setConfirm('');setError('');};
 const act=async(fn:()=>any)=>{await fn();};
 const create=()=>{if(!reason.trim()||!actor.trim())return;setBusy(true);setTimeout(()=>{const next={id:'hold-'+crypto.randomUUID(),scope,workflowId:scope==='workflow'?wf?.id:undefined,actor:actor.trim(),reason:reason.trim(),createdAt:new Date().toISOString()};setHolds(h=>[...h,next]);setBusy(false);setReason('');setAdd(false);setNotice('Pause added. Existing steps can finish.');},200);};
 const release=(id:string)=>{setBusy(true);setError('');setTimeout(()=>{setBusy(false);if(failOnce){setFailOnce(false);setError('Could not release this hold. Check the connection and try again.');return;}setHolds(all=>all.filter(h=>h.id!==id));setConfirm('');requestAnimationFrame(()=>{(document.querySelector('.hold-row button:not([disabled])') as HTMLButtonElement ?? document.querySelector('[data-add-pause]') as HTMLButtonElement)?.focus();});setNotice(applicable.filter(h=>h.id!==id).length?'Hold released. Remaining holds still apply.':'Hold released. No applicable holds remain.');},200);};
 const go=(v:string)=>{location.href='/?view='+v+(baseline?'&baseline=1':'');};
 useEffect(()=>{if(confirm)document.querySelector<HTMLButtonElement>('.release-confirm button')?.focus();},[confirm]);
 useEffect(()=>{if(add)document.querySelector<HTMLInputElement>('.add-form input')?.focus();},[add]);
 if(!wf)return <Text p="xl">Loading fixture…</Text>;
 const remaining=applicable.filter(h=>h.id!==confirm);
 return <div className="app">
  <Sidebar page={view==='run'?'runs':'workflows'} connected connectionError={false} engineHost="127.0.0.1:4413"/>
  <main className="main fixture-main">
   {!baseline&&<div className={'execution-header '+(library.length?'paused':'')} role={library.length?'status':undefined}>
    <Group gap="xs"><Pause size={16}/><Text size="sm" fw={500}>{library.length?'Library paused · '+library.length+(library.length===1?' hold':' holds'):'Library execution'}</Text>{library.length>0&&<Text size="xs" className="header-reason">{library[0].reason}</Text>}</Group>
    <Button variant="default" onClick={()=>open('library',!library.length)}>{library.length?'Review holds':'Pause library'}</Button>
   </div>}
   {!baseline&&workflowContext&&local.length>0&&<div className="workflow-banner">
    <Group gap="xs"><Pause size={15}/><Text size="sm" fw={500}>Workflow paused · {local.length} {local.length===1?'hold':'holds'}</Text><Text size="xs">{local[0].reason}</Text></Group>
    <Button variant="subtle" color="yellow" onClick={()=>open('workflow')}>Review holds</Button>
   </div>}
   {view==='library'?<div className="library-slot"><WorkflowLibrary workflows={workflows} onOpen={()=>go('workflow')} act={act}/></div>:
    view==='workflow'?<div className="editor-slot"><WorkflowEditor workflow={wf} workflows={workflows} onBack={()=>go('library')} onRun={()=>go('run')} onSaved={()=>{}} act={act} onDirty={()=>{}}/></div>:
    <div className="run-fixture">
     <header className="run-header"><Button variant="subtle" color="gray" onClick={()=>go('workflow')} aria-label="Back to workflow"><ArrowLeft size={17}/></Button><div><h2>Release pipeline</h2><Text size="xs" c="dimmed">Version 1 · 7e8fc3b2</Text></div><Badge color="yellow" variant="light">Waiting</Badge><Button variant="default" color="red" onClick={()=>setNotice('Fixture run cancelled. Holds remain active.')}>Cancel run</Button></header>
     <div className="run-summary"><strong>{!baseline&&applicable.length?'Build · Paused · Person':'Build · Waiting for an agent · Agent'}</strong>
     {!baseline&&applicable.length>0&&<><Text size="sm">Execution is waiting for {applicable.length} active pause holds. In-flight work can finish.</Text><Button variant="subtle" onClick={()=>open('workflow')}>Review pause holds</Button></>}
     </div>
     <div className="run-body"><section className="run-detail"><h2>Build</h2><Badge color="yellow" variant="light">Waiting</Badge><h3>Assignment</h3><Text size="sm" c="dimmed">Fixture only. Do not execute.</Text>{!baseline&&applicable.length>0&&<Alert color="yellow" title="Claim blocked by pause">Release all applicable holds before claiming this assignment.</Alert>}<Button disabled={!baseline&&applicable.length>0} mt="lg">Claim assignment</Button></section><section className="run-timeline"><h2>Execution timeline</h2><div className="timeline-row"><Check size={18}/><div><strong>Start</strong><Text size="xs" c="dimmed">Completed · 07:09:59</Text></div></div><div className="timeline-row"><Pause size={18}/><div><strong>Build</strong><Text size="xs" c="dimmed">{!baseline&&applicable.length?'Paused at step boundary':'Waiting for an agent'}</Text></div></div><div className="timeline-row muted">Complete</div></section></div>
    </div>}
   {!baseline&&view==='workflow'&&headerTarget&&createPortal(<Button variant="default" className="workflow-pause-button" leftSection={<Pause size={14}/>} onClick={()=>open('workflow',!local.length)}>{local.length?'Pauses · '+local.length:'Pause workflow'}</Button>,headerTarget)}
   {notice&&<div className="fixture-notice" role="status"><Check size={16}/><span>{notice}</span><Button variant="subtle" onClick={()=>setNotice('')}>Dismiss</Button></div>}
   {opened&&<Modal title="Execution pauses" onClose={()=>setOpened(false)} busy={busy} size={700}>
    <ModalBody><Text size="sm" c="dimmed" mb="lg">{workflowContext?applicable.length+' active '+(applicable.length===1?'hold applies':'holds apply')+' to Release pipeline.':library.length+' active library '+(library.length===1?'hold.':'holds.')}{applicable.length>0?' Execution resumes only after all applicable holds are released.':' Add a pause to stop execution at step boundaries.'}</Text>
    {(workflowContext?applicable:library).length===0?<div className="empty-holds"><Text size="sm">No active {workflowContext?'applicable':'library'} holds.</Text></div>:<div className="hold-list">{(workflowContext?applicable:library).map(h=><div className="hold-row" key={h.id}>
     <Group justify="space-between" align="start" wrap="nowrap"><div className="hold-content"><Group gap="xs" mb={8}><Badge variant="light" color={h.scope==='library'?'yellow':'gray'} size="sm">{h.scope==='library'?'Library':'Release pipeline'}</Badge><Text size="xs" c="dimmed">{h.actor} · {new Date(h.createdAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'})} UTC</Text></Group><Text size="sm">{h.reason}</Text><code className="hold-id">{h.id}</code></div><Button variant="default" onClick={()=>{setConfirm(h.id);setAdd(false);setError('');}} disabled={busy||confirm===h.id}>Release…</Button></Group>
     {confirm===h.id&&<div className="release-confirm"><Text size="sm" fw={500}>Release this hold?</Text><Text size="xs" mt={5}>{remaining.length?remaining.length+' other '+(remaining.length===1?'hold remains':'holds remain')+'. Execution stays paused.':'No applicable holds will remain. Execution can resume.'}</Text>{error&&<Alert mt="sm" color="red" icon={<AlertCircle size={16}/>} role="alert">{error}</Alert>}<Group justify="flex-end" mt="md"><Button variant="default" onClick={()=>{setConfirm('');setError('');}} disabled={busy}>Keep hold</Button><Button onClick={()=>release(h.id)} loading={busy}>Release hold</Button></Group></div>}
    </div>)}</div>}
    {add?<div className="add-form"><h3>Add a pause</h3><Stack gap="md">{workflowContext&&<Select label="Scope" data={[{value:'workflow',label:'Workflow: Release pipeline'},{value:'library',label:'Entire library'}]} value={scope} onChange={v=>setScope(v as any)} allowDeselect={false}/>}<TextInput label="Actor" required value={actor} onChange={e=>setActor(e.target.value)} description="A label identifying who or what is adding this pause."/><Textarea label="Reason" required value={reason} onChange={e=>setReason(e.target.value)} minRows={2} placeholder="Why should execution pause?"/><Text size="xs" c="dimmed">New claims and steps stop at their next boundary. In-flight work can finish. Inspection and cancellation stay available.</Text><Group justify="flex-end"><Button variant="default" onClick={()=>setAdd(false)} disabled={busy}>Cancel</Button><Button onClick={create} disabled={!reason.trim()||!actor.trim()} loading={busy}>{scope==='library'?'Pause library':'Pause workflow'}</Button></Group></Stack></div>:<Button data-add-pause mt="lg" variant="default" leftSection={<Plus size={15}/>} onClick={()=>{setAdd(true);setConfirm('');}}>Add another pause</Button>}
    </ModalBody><ModalFooter><Button variant="default" onClick={()=>setOpened(false)} disabled={busy}>Done</Button></ModalFooter>
   </Modal>}
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<MantineProvider theme={theme} forceColorScheme="dark"><BrowserRouter><App/></BrowserRouter></MantineProvider>);

