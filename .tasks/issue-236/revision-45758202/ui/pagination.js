async page => {
 const context={"dir": "/var/folders/c9/6p3b_52j3tjg1flszl2g97440000gn/T/interlock-236-ui-fjFcPm", "workflowId": "d572590c-a053-4e54-8a42-63bd9c6f9ca3", "draftWorkflowId": "704f8b2f-a09e-4f5b-b671-2baa74037855", "triggerId": "916e21f8-c9f6-4b9e-b646-666f9a07c7b3", "url": "http://127.0.0.1:5197/workflows/d572590c-a053-4e54-8a42-63bd9c6f9ca3?view=schedules&schedule=916e21f8-c9f6-4b9e-b646-666f9a07c7b3", "source": "production UI build + actual runtime; seeded isolated schedule due slot; no user database", "failureWorkflowId": "440eca10-61bd-4a91-9e94-0cb6a2ef3878", "failureTriggerId": "7350587d-b44c-4d49-8b13-31f9b7122bb7", "lagWorkflowId": "d1cd7301-fe6a-460d-8181-3e118a15d350", "lagTriggerId": "d1ae7d25-9027-4873-946b-0de42e0a54c2", "alertCount": 24};
 await page.getByRole('button',{name:'More schedule alerts',exact:true}).click();
 await page.getByRole('alert',{name:'Revision alert 22',exact:true}).waitFor();
 const before=await page.getByRole('region',{name:'Schedule alerts',exact:true}).innerText();
 const refreshed=page.waitForResponse(response=>response.url().includes('triggers.attention')&&decodeURIComponent(response.url()).includes('"offset":20')&&response.status()===200);
 const started=await page.request.post('http://127.0.0.1:5197/trpc/runs.start',{data:{workflowId:context.workflowId,input:{regression:'unrelated SSE refresh'}}});if(!started.ok())throw new Error('Unrelated run failed');
 await refreshed;
 await page.getByRole('alert',{name:'Revision alert 22',exact:true}).waitFor();
 const after=await page.getByRole('region',{name:'Schedule alerts',exact:true}).innerText();
 if(before!==after||await page.getByRole('button',{name:'Previous schedule alerts',exact:true}).count()!==1)throw new Error('UI236-R1 offset reset after live event');
 await page.screenshot({path:'.tasks/issue-236/revision-45758202/ui/attention-page2-after-event-900.png'});
 return {finding:'UI236-R1',passed:true,actualAlertCount:24,page:'second',samePageAfterUnrelatedRun:true};
}