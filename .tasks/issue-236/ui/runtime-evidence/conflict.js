async page => {
  const url='http://127.0.0.1:5197/workflows/a3c717bf-3fc8-425b-adc2-b349a2198e55?view=schedules&schedule=af078f20-39bc-4c38-80c8-0f400d493526';
  await page.setViewportSize({width:900,height:1000});await page.goto(url);
  await page.getByRole('button',{name:'Edit schedule',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Local conflict edit');
  const peer=await page.context().newPage();
  try {
    await peer.goto(url);await peer.getByRole('button',{name:'Edit schedule',exact:true}).click();
    await peer.getByRole('dialog').getByRole('textbox',{name:'Schedule name',exact:true}).fill('Remote saved heartbeat');
    await peer.getByRole('dialog').getByRole('button',{name:'Save schedule',exact:true}).click();await peer.getByRole('dialog').waitFor({state:'hidden'});
  } finally {await peer.close();}
  await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();
  await dialog.getByRole('button',{name:'Reload current schedule and discard edits',exact:true}).waitFor();
  if(await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).inputValue()!=='Local conflict edit')throw new Error('Conflict lost edits');
  await page.screenshot({path:'.tasks/issue-236/ui/runtime-evidence/revision-conflict-900.png'});
  await dialog.getByRole('button',{name:'Reload current schedule and discard edits',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(el=>el.value==='Remote saved heartbeat'));
  await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).evaluate(el=>{if(el.value!=='Remote saved heartbeat')throw new Error('Explicit reload did not read current config');});
  await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();await dialog.waitFor({state:'hidden'});
  return {checks:['Real second-page update produced revision conflict','Local edit retained on conflict','Explicit reload discarded edit and loaded current revision','Save after reload acknowledged'],url:page.url()};
}
