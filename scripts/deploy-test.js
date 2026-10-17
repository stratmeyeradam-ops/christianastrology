// Exercise installer functions in a temporary directory; no system services or real credentials.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'ca-deploy-'));
try {
  const source = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
  const sync = source.slice(source.indexOf('sync_code() {'), source.indexOf('\nsnapshot() {'));
  const merge = source.slice(source.indexOf('env_get() {'), source.indexOf('\nenv_set() {'));
  const run = (body) => spawnSync('bash', ['-c', `set -euo pipefail\nAPP_DIR="$1"\nSRC="$1"\nAPP_USER=test\nRSYNC_EXCLUDES=()\nok() { :; }\nchown() { :; }\nnpm() { return 0; }\n${sync}\n${merge}\n${body}`, '--', dir], { encoding: 'utf8' });
  assert.equal(run('sync_code').status, 0, 'fresh install must succeed before .env exists');
  assert.equal(run('npm() { return 23; }; sync_code').status, 1, 'dependency failure must propagate');
  mkdirSync(join(dir, 'deploy'));
  writeFileSync(join(dir, '.env'), 'STRIPE_SECRET_KEY=fake-preserved\nPRINTIFY_AUTO_SEND=false\n');
  writeFileSync(join(dir, 'deploy/env.add'), 'PRINTIFY_SHOP_ID=42\nPRINTIFY_AUTO_SEND=true\n');
  const merged = run('env_merge');
  assert.equal(merged.status, 0, merged.stderr);
  const env = readFileSync(join(dir, '.env'), 'utf8');
  assert.match(env, /STRIPE_SECRET_KEY=fake-preserved/);
  assert.match(env, /PRINTIFY_AUTO_SEND=true/);
  assert.match(env, /PRINTIFY_SHOP_ID=42/);
  assert.equal(run('env_merge').status, 0, 'repeat deployment must succeed');
  const configCheck = spawnSync(process.execPath, ['--input-type=module', '-e', "const {config}=await import('./src/config.js'); if(config.resend.apiKey!=='re_offline_example') process.exit(1)"], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, RESEND_API_KEY: '', SMTP_HOST: 'smtp.resend.com', SMTP_PASS: 're_offline_example' }
  });
  assert.equal(configCheck.status, 0, 'Resend SMTP credentials should work automatically over HTTPS');
  const failedCheck = spawnSync(process.execPath, ['scripts/check.js'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, ADMIN_EMAILS: '', STRIPE_SECRET_KEY: '', PRINTIFY_API_TOKEN: '', PRINTIFY_SHOP_ID: '', SMTP_HOST: '', SMTP_PASS: '', RESEND_API_KEY: '' }
  });
  assert.equal(failedCheck.status, 1, 'integration failures must return a failing exit status');
  console.log('✓ deployment: fresh install, dependency failure, automatic Printify settings, repeat update, Resend HTTPS, integration failure status');
} finally { rmSync(dir, { recursive: true, force: true }); }
