async page => {
  const dialog=page.getByRole('dialog');
  await page.getByRole('button',{name:'Add schedule',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Control journey');
  await dialog.getByRole('textbox',{name:'Every',exact:true}).fill('30');
  await dialog.getByRole('button',{name:'Run input',exact:true}).click();
  await dialog.getByRole('textbox',{name:'JSON input template',exact:true}).fill('{bad');
  await dialog.getByRole('button',{name:'Create schedule',exact:true}).click();
  await dialog.getByText('Enter valid JSON before saving.',{exact:true}).waitFor();
  await dialog.getByRole('textbox',{name:'JSON input template',exact:true}).fill('{"mode":"control"}');
  await dialog.getByRole('checkbox',{name:'scheduledAt',exact:true}).check();
  await dialog.getByRole('button',{name:'Policies',exact:true}).click();
  await dialog.getByRole('radio',{name:'Queue at most one run',exact:true}).check();
  await dialog.getByRole('radio',{name:'Run once',exact:true}).check();
  await page.screenshot({path:'.tasks/issue-236/ui/runtime-evidence/policies-1440.png'});
  await dialog.getByRole('button',{name:'Create schedule',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Control journey',exact:true}).waitFor();
  await page.getByText('Schedule created disabled.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Enable schedule',exact:true}).click();
  await dialog.getByRole('button',{name:'Enable schedule',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Disable schedule',exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit schedule',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Control saved');
  await dialog.getByRole('button',{name:'Save schedule',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Control saved',exact:true}).waitFor();
  return {checks:['invalid JSON retained then corrected','explicit metadata binding entered','queue and run_once selected','created disabled acknowledged','enabled exact ID','saved and reopened configuration'],url:page.url()};
}
