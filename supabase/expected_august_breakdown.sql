-- Reproduces the "Expected" figure on /financials for a given month.
-- Mirrors BillingMonthTable's `totals.expected`: sum of billing_periods.amount_cents
-- for periods due that month, excluding waived/void (paid + scheduled both count).
-- See src/app/(app)/financials/page.tsx (monthRows) and
-- src/components/financials/BillingMonthTable.tsx (totals.expected).

-- 1) The headline number.
select
  sum(amount_cents) / 100.0 as expected_usd
from billing_periods
where due_date >= '2026-08-01'
  and due_date <= '2026-08-31'
  and status not in ('waived', 'void');

-- 2) Per-client breakdown — exactly what rows make up that total.
select
  b.name as client,
  bp.due_date,
  bp.amount_cents / 100.0 as amount_usd,
  bp.status,
  case
    when bp.status = 'paid' then 'paid'
    when bp.status <> 'scheduled' then bp.status
    when bp.due_date > current_date then 'upcoming'
    when current_date - bp.due_date > 7 then 'overdue'
    else 'due'
  end as state
from billing_periods bp
join brands b on b.id = bp.brand_id
where bp.due_date >= '2026-08-01'
  and bp.due_date <= '2026-08-31'
  and bp.status not in ('waived', 'void')
order by bp.due_date, b.name;
