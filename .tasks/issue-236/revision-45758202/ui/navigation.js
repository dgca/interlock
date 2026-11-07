async page => {
 const context={"dir": "/var/folders/c9/6p3b_52j3tjg1flszl2g97440000gn/T/interlock-236-ui-fjFcPm", "workflowId": "d572590c-a053-4e54-8a42-63bd9c6f9ca3", "draftWorkflowId": "704f8b2f-a09e-4f5b-b671-2baa74037855", "triggerId": "916e21f8-c9f6-4b9e-b646-666f9a07c7b3", "url": "http://127.0.0.1:5197/workflows/d572590c-a053-4e54-8a42-63bd9c6f9ca3?view=schedules&schedule=916e21f8-c9f6-4b9e-b646-666f9a07c7b3", "source": "production UI build + actual runtime; seeded isolated schedule due slot; no user database", "failureWorkflowId": "440eca10-61bd-4a91-9e94-0cb6a2ef3878", "failureTriggerId": "7350587d-b44c-4d49-8b13-31f9b7122bb7", "lagWorkflowId": "d1cd7301-fe6a-460d-8181-3e118a15d350", "lagTriggerId": "d1ae7d25-9027-4873-946b-0de42e0a54c2", "alertCount": 24};
 await page.goto(context.url);
 await page.getByRole('tab',{name:'Runs',exact:true}).click();
 await page.getByRole('tab',{name:'Schedules',exact:true}).click();
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();
 let editor=page.getByRole('dialog');
 await editor.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Guarded route draft');
 await editor.getByRole('textbox',{name:'Schedule name',exact:true}).press('Tab');
 await page.goBack({timeout:1500}).catch(()=>{});
 let guard=page.getByRole('dialog',{name:'Discard unsaved changes?',exact:true});await guard.waitFor();
 await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
 await guard.waitFor({state:'hidden'});
 if(await editor.getByRole('textbox',{name:'Schedule name',exact:true}).inputValue()!=='Guarded route draft')throw new Error('Keep editing lost draft');
 await page.goBack({timeout:1500}).catch(()=>{});await guard.waitFor();
 await guard.getByRole('button',{name:'Discard changes',exact:true}).click();
 await page.getByRole('tab',{name:'Runs',exact:true}).waitFor();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.screenshot({path:'.tasks/issue-236/revision-45758202/ui/discard-runs-no-modal-900.png'});
 await page.getByRole('tab',{name:'Schedules',exact:true}).click();
 if(await page.getByRole('dialog').count())throw new Error('Discarded portal reopened');
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();editor=page.getByRole('dialog');
 if(await editor.getByRole('textbox',{name:'Schedule name',exact:true}).inputValue()==='Guarded route draft')throw new Error('Discarded draft retained');
 await editor.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Pending save guard revision');
 let release;const captured=new Promise(resolve=>{release=resolve});let held;
 await page.route('**/trpc/triggers.manage*',async route=>{if(route.request().method()==='POST'){held=route;release();}else await route.continue()});
 try {
  await editor.getByRole('button',{name:'Save schedule',exact:true}).click();await captured;
  await page.goBack({timeout:1500}).catch(()=>{});await guard.waitFor();
  if(!await guard.getByRole('button',{name:'Discard changes',exact:true}).isDisabled())throw new Error('Pending save allows discard');
  await page.screenshot({path:'.tasks/issue-236/revision-45758202/ui/pending-discard-disabled-900.png'});
  await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await guard.waitFor({state:'hidden'});
  await held.continue();held=undefined;await page.getByRole('dialog').waitFor({state:'hidden'});
 } finally {if(held)await held.continue();await page.unroute('**/trpc/triggers.manage*')}
 const verify=await page.request.get('http://127.0.0.1:5197/trpc/triggers.inspect',{params:{input:JSON.stringify({id:context.triggerId})}});
 if((await verify.json()).result.data.trigger.name!=='Pending save guard revision')throw new Error('Pending save not acknowledged');
 return {finding:'UI236-R4',passed:true,keepEditingPreservesDraft:true,discardDismissesPortal:true,reopenReadsPersisted:true,pendingDiscardDisabled:true,saveAcknowledged:true};
}