// Runner: spawns `node scripts/source-audit.mjs` and captures stdout/stderr/exitCode
// into a UTF-8 log file, because this shell environment mangles node's stdout.
const { spawnSync } = require('node:child_process');
const { writeFileSync, existsSync } = require('node:fs');

const child = spawnSync(process.execPath, ['scripts/source-audit.mjs', ...process.argv.slice(2)], {
  encoding: 'utf-8',
  maxBuffer: 20 * 1024 * 1024,
});

const log = [];
log.push(`exit=${child.status} signal=${child.signal} err=${child.error ? child.error.message : 'none'}`);
log.push(`stdoutLen=${child.stdout ? child.stdout.length : 'null'} stderrLen=${child.stderr ? child.stderr.length : 'null'}`);
if (child.stdout) { log.push('===STDOUT==='); log.push(child.stdout); }
if (child.stderr) { log.push('===STDERR==='); log.push(child.stderr); }
log.push(`reportExists=${existsSync('scripts/source-audit-report.json')}`);

writeFileSync('scripts/_audit-runner.log', log.join('\n'), 'utf-8');
console.log(`runner done, exit=${child.status}, stdout=${child.stdout?child.stdout.length:0}, report=${existsSync('scripts/source-audit-report.json')}`);
