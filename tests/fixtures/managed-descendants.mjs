import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  [
    '-e',
    "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)",
  ],
  { stdio: ['ignore', 'pipe', 'ignore'] },
);
child.stdout.once('data', () => {
  console.log(
    JSON.stringify({
      method: 'fixture/child',
      params: { pid: child.pid, leader: process.pid },
    }),
  );
  if (process.argv.includes('exit')) process.exit(17);
});
setInterval(() => {}, 1000);
