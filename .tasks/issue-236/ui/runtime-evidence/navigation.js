async page => {
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  const dialog=page.getByRole('dialog');
  if(await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).inputValue()!=='Navigation retention')throw new Error('Back guard lost text');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('navigation',{name:'Schedules',exact:true}).getByRole('button').first().click();
  await page.getByRole('heading',{name:'Runtime heartbeat',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Runtime heartbeat',exact:true}).evaluate(element=>{if(document.activeElement!==element)throw new Error('Selection focus missing');});
  await page.screenshot({path:'.tasks/issue-236/ui/runtime-evidence/inspection-390.png'});
  return {checks:['Browser Back after text blur requested discard confirmation','Keep editing retained entered text','Cancel discarded local edit','Narrow schedule selection focused inspection heading']};
}
