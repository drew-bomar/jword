-- Decision 022: Workday boards. The enum value is added on its own because Postgres cannot use
-- a new enum value inside the transaction that adds it; the board rules follow in 000300.
alter type public.ats_provider add value if not exists 'WORKDAY' before 'OTHER';
