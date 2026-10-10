#!/usr/bin/env node
// Execute the shipped TypeScript batch against the disposable local database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../../', import.meta.url));
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = sql => execFileSync('psql', [DB, '-XqAt', '-v', 'ON_ERROR_STOP=1'], {input: sql, encoding:'utf8', timeout:30000});
const literal = value => typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
function loadTs(file, deps) {
  const m = {exports:{}};
  const js = ts.transpileModule(fs.readFileSync(root + file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js, {module:m,exports:m.exports,require:name=>{
    if (!(name in deps)) throw new Error('Unexpected import: '+name);
    return deps[name];
  }, process:{env:{}},console,Date});
  return m.exports;
}
export async function verifyBatchFairness(query) {
  const tables = loadTs('lib/subscribe/subscriptionsTable.ts',{});
  const {runSubscriptionRenewalBatch} = loadTs('lib/subscribe/subscriptionRenewalBatch.ts', {'server-only':{},'@/lib/subscribe/subscriptionsTable':tables});
  const attempts = [];
  const periods = new Map((await query('select id,current_period_end from public.subscriptions')).map(s=>[s.id,s.current_period_end]));
  class Select {
    constructor(table) {assert.equal(table, 'subscriptions');this.where=[];this.columns='*';}
    select(columns) {this.columns=columns;return this;}
    add(column,op,value) {assert.match(column,/^[a-z_]+$/);this.where.push(`${column} ${op} ${literal(value)}`);return this;}
    eq(c,v) {return this.add(c,'=',v);}
    gt(c,v) {return this.add(c,'>',v);}
    lte(c,v) {return this.add(c,'<=',v);}
    order(c,o) {assert.match(c,/^[a-z_]+$/);this.sort=`order by ${c} ${o.ascending?'asc':'desc'}`;return this;}
    async limit(n) {return {data:await query(`select ${this.columns} from public.subscriptions where ${this.where.join(' and ')} ${this.sort??''} limit ${n}`),error:null};}
  }
  const client={from:table=>new Select(table),rpc:async(name,args)=>{
    assert.ok(['process_subscription_renewal_v2','record_subscription_renewal_notice','finalize_subscription_terminal_transition','claim_subscription_renewal_batch'].includes(name));
    const params=Object.entries(args).map(([k,v])=>`${k} => ${literal(v)}`).join(',');
    if (name==='process_subscription_renewal_v2') {
      attempts.push(args.p_subscription_id);
      assert.equal(args.p_period_end,periods.get(args.p_subscription_id),'TS must preserve the DB timestamp, including microseconds');
    }
    const isSet=name==='process_subscription_renewal_v2'||name==='claim_subscription_renewal_batch';
    const rows=await query(isSet?`select * from public.${name}(${params})`:`select public.${name}(${params}) as result`);
    return {data:isSet?rows:rows[0].result,error:null};
  }};
  const at=new Date((await query('select now() as at'))[0].at);
  const healthy=(await query("select id from public.subscriptions where mentor_id='00000000-0000-4000-8000-00000000f002'"))[0].id;
  const first=await runSubscriptionRenewalBatch(client,at);
  assert.equal(first.scanned,50);assert.equal(first.renewed,0);assert.equal(first.skipped,50);
  assert.ok(first.errors.every(e=>e.message.startsWith('price_changed_since_notice:')),JSON.stringify(first));
  assert.equal(attempts.includes(healthy),false);
  const second=await runSubscriptionRenewalBatch(client,at);
  assert.equal(second.scanned,50);assert.equal(second.renewed,1,JSON.stringify(second));
  assert.ok(attempts.includes(healthy));
  const overdue=new Date(at.getTime()+3*86400000);
  const third=await runSubscriptionRenewalBatch(client,overdue);
  assert.equal(third.expired,50);
  const totals=(await query("select count(*) filter(where status='expired')::int as expired,count(*) filter(where status='active')::int as active from public.subscriptions"))[0];
  assert.deepEqual(totals,{expired:50,active:1});
  console.log('BATCH_FAIRNESS_PASS: blocked 50; next batch renewed healthy 1; expired unresolved 50');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  psql(fs.readFileSync(root+'scripts/verify/fixtures/subscription_batch_seed.sql','utf8'));
  await verifyBatchFairness(async sql => JSON.parse(psql(`set role service_role;select coalesce(json_agg(t),'[]'::json) from (${sql}) t;`)));
}
