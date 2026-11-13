/** Self-contained CommonJS source also used by the packed CLI. No checkout or TS loader is required. */
export const scriptSupervisorSource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const config = JSON.parse(input);
  input = '';
  const key = Buffer.from(config.key, 'base64');
  const aad = file => Buffer.from(JSON.stringify([config.runId, config.id, config.token, file]));
  const write = (file, value) => {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(file));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const target = path.join(config.directory, file);
    const temporary = target + '.' + crypto.randomUUID();
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')}));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
    const directoryFd = fs.openSync(config.directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  };
  const stopped = () => {
    const target = path.join(config.directory, 'stop');
    if (!fs.existsSync(target)) return false;
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64'));
    decipher.setAAD(aad('stop'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString()).stop === true;
  };
  const identity = {pid: process.pid, start: execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], {encoding:'utf8',env:{...process.env,LC_ALL:'C'}}).trim()};
  write('identity', identity);
  let child, stdout = '', stderr = '', failure, timer, interval, settled = false;
  const kill = () => {
    if (child && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  };
  const finish = outcome => {
    if (settled) return;
    settled = true;
    clearTimeout(timer); clearInterval(interval);
    if (config.provenanceFile) { try { fs.rmSync(config.provenanceFile, {force:true}); } catch {} }
    write('result', {...identity, progress: stderr, outcome});
  };
  try {
    if (stopped()) { finish({error:'Script stopped'}); return; }
    const remaining = config.deadline - Date.now();
    if (remaining <= 0) { finish({error:'Script exceeded its deadline'}); return; }
    child = spawn(config.executable, config.args, {cwd:config.cwd, env:config.env, detached:true, stdio:['pipe','pipe','pipe']});
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 1024*1024) { stdout = ''; failure = 'Script output exceeded 1 MiB'; kill(); }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (config.hasSecrets) {
        if (Buffer.byteLength(stderr) > 1024*1024) { stderr = ''; failure = 'Script error output exceeded 1 MiB'; kill(); }
      } else stderr = stderr.slice(-8192);
    });
    child.on('error', () => finish({error:'Script process could not start'}));
    child.on('close', code => {
      if (failure || code !== 0) { finish({error:failure || ('Script exited '+code)}); return; }
      try { finish({output:JSON.parse(stdout)}); }
      catch { finish({error:'Script stdout must contain one JSON value'}); }
    });
    timer = setTimeout(() => { failure = 'Script exceeded its deadline'; kill(); }, remaining);
    interval = setInterval(() => {
      try {
        if (stopped()) { failure = 'Script stopped'; kill(); }
        write('progress', {...identity, progress:config.hasSecrets && stderr ? '[REDACTED]' : stderr});
      } catch {
        failure = 'Background supervisor persistence failed'; kill();
      }
    }, 100);
    child.stdin.end(JSON.stringify(config.input));
  } catch {
    kill(); finish({error:'Background supervisor could not launch Script'});
  }
});
`;
