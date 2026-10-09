-- 조회 전용(LOCK·DDL·DML 없음). 중지 직전(S1-0)과 재개 직전(R0) 2회 저장해 대조한다. 출력은 증거 디렉터리에만 둔다.
SELECT id, paysync_invoice_id, status, issued_at, expires_at, (expires_at IS NOT NULL AND expires_at < now()) AS already_expired
  FROM public.paysync_invoices WHERE status = 'pending' ORDER BY issued_at;
