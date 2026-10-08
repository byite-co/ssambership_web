#!/usr/bin/env python3
"""Two native PostgreSQL sessions, LOCAL Supabase only; never uses a project secret.

A holds its successful renewal open, B must actually wait on A's advisory lock,
then replay after A commits. Synthetic rows live only in the disposable CI stack.
"""
import json
import subprocess
import time
import uuid

DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
BASE = ["psql", DB, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]


def query(sql):
    return subprocess.run(BASE + ["-c", sql], check=True, text=True, capture_output=True, timeout=20).stdout.strip()


def main():
    mentor, student, sub = [str(uuid.uuid4()) for _ in range(3)]
    query(f"""
      insert into auth.users(instance_id,id,aud,role,email,raw_user_meta_data,created_at,updated_at)
      values ('00000000-0000-0000-0000-000000000000','{mentor}','authenticated','authenticated','{mentor}@test.local','{{"app_role":"mentor","full_name":"동시성멘토","nickname":"동시성멘토"}}',now(),now()),
             ('00000000-0000-0000-0000-000000000000','{student}','authenticated','authenticated','{student}@test.local','{{"app_role":"student","full_name":"동시성학생","nickname":"동시성학생"}}',now(),now());
      update public.mentor_profiles set verification_status='approved' where user_id='{mentor}';
      update public.mentor_plans set amount_cents=5000000,is_active=false where mentor_id='{mentor}';
      insert into public.cash_wallets(user_id,balance_cents) values('{student}',15000000)
      on conflict(user_id) do update set balance_cents=excluded.balance_cents;
      insert into public.subscriptions(id,student_id,mentor_id,plan_id,plan_tier,status,current_period_start,current_period_end,next_billing_at)
      select '{sub}','{student}','{mentor}',id,'limited','active',now()-interval '1 month',date_trunc('second',now()-interval '1 hour'),date_trunc('second',now()-interval '1 hour')
      from public.mentor_plans where mentor_id='{mentor}' and plan_tier='limited';
    """)
    period = query(f"select current_period_end from public.subscriptions where id='{sub}'")
    key = query(f"select 'sub_renewal:'||id||':'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD') from public.subscriptions where id='{sub}'")
    rpc = f"select row_to_json(r) from public.process_subscription_renewal_v2('{sub}','{period}','{key}',now()) r;"
    a = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    b = None
    try:
        a.stdin.write("begin; set local statement_timeout='15s';\n" + rpc + "\n\\echo LOCK_HELD\n")
        a.stdin.flush()
        first = json.loads(a.stdout.readline())
        assert first["code"] == "succeeded", first
        assert a.stdout.readline().strip() == "LOCK_HELD"
        b = subprocess.Popen(BASE + ["-c", "set application_name='subscription-boundary-B';set statement_timeout='15s';" + rpc], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 8
        while True:
            blocked = query("select count(*) from pg_stat_activity where application_name='subscription-boundary-B' and wait_event_type='Lock' and wait_event='advisory'")
            if blocked == "1":
                break
            if b.poll() is not None or time.monotonic() > deadline:
                raise AssertionError("B did not demonstrably wait on A's renewal lock")
            time.sleep(0.05)
        a.stdin.write("commit;\n\\q\n")
        a.stdin.flush()
        a.wait(timeout=10)
        out, err = b.communicate(timeout=10)
        assert a.returncode == b.returncode == 0, err
        second = json.loads(out.strip())
        assert second["code"] == "already_succeeded", second
        assert first["ledger_id"] == second["ledger_id"]
        state = json.loads(query(f"""select json_build_object(
          'debits',(select count(*) from public.cash_ledger where idempotency_key='{key}'),
          'amount',(select -sum(delta_cents) from public.cash_ledger where idempotency_key='{key}'),
          'events',(select count(*) from public.subscription_billing_events where idempotency_key='{key}' and status='succeeded'),
          'balance',(select balance_cents from public.cash_wallets where user_id='{student}'))"""))
        assert state == {"debits": 1, "amount": 5000000, "events": 1, "balance": 10000000}, state
        print("CONCURRENT_RENEWAL_PASS: observed B waiting; one debit/event; exact custom price")
    finally:
        for process in (a, b):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
