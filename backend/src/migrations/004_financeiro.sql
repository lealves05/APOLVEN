-- APOLVEN — 004: comissões (acordos, regras versionadas, previsões, liquidações, alocações, ajustes, contestações),
-- repasses (regras, vínculos por apólice, liberações, lotes com aprovação travada), importações (extratos),
-- contas bancárias, conciliação, financeiro próprio da corretora, fechamento de período e comunicação.
-- Prêmio do seguro, comissão da corretora, repasse ao produtor e assinatura SaaS são fluxos SEPARADOS.

create table if not exists commission_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  institution_id uuid not null references institutions(id),
  name text not null,
  branch text,
  product_id uuid,
  unit_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, product_id) references products(company_id, id),
  foreign key (company_id, unit_id) references units(company_id, id)
);

create table if not exists commission_rule_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  agreement_id uuid not null,
  version integer not null,
  kind text not null check (kind in ('percentual', 'fixo')),
  rate numeric(9,4) check (rate is null or (rate >= 0 and rate <= 100)),
  fixed_cents bigint check (fixed_cents is null or fixed_cents >= 0),
  base_definition text not null,       -- premio_liquido | premio_total | outra (descrita em base_notes)
  base_notes text,
  schedule text not null default 'unica' check (schedule in ('unica', 'parcelada')),
  installments integer not null default 1 check (installments between 1 and 120),
  right_event text,                    -- emissão | pagamento do segurado | outro (momento de aquisição do direito)
  valid_from date not null,
  valid_to date,
  document_id uuid,
  approved_by uuid,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, agreement_id, version),
  foreign key (company_id, agreement_id) references commission_agreements(company_id, id)
);
drop trigger if exists commission_rule_versions_immutable on commission_rule_versions;
create trigger commission_rule_versions_immutable before update on commission_rule_versions for each row execute function apolven_block_change();

-- Comissão a receber por apólice/endosso e parcela do calendário de comissão.
-- expected_cents = previsão; confirmed_cents = direito confirmado pela fonte. Saldos derivam de alocações e ajustes.
create table if not exists commission_receivables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  endorsement_id uuid,
  installment_no integer not null default 1,
  installments_total integer not null default 1,
  rule_snapshot jsonb,
  base_cents bigint,
  rate numeric(9,4),
  category text not null default 'prevista' check (category in ('estimativa', 'prevista')),
  expected_cents bigint not null check (expected_cents >= 0),
  confirmed_cents bigint check (confirmed_cents is null or confirmed_cents >= 0),
  confirmed_at timestamptz,
  confirmation_source text,
  due_date date,
  contested boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique nulls not distinct (company_id, policy_id, endorsement_id, installment_no),
  foreign key (company_id, policy_id) references policies(company_id, id),
  foreign key (company_id, endorsement_id) references endorsements(company_id, id)
);
create index if not exists commission_receivables_policy on commission_receivables(company_id, policy_id);

create table if not exists import_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,                  -- extrato_comissao | extrato_bancario | clientes | apolices | parcelas
  filename text not null,
  sha256 text not null,
  size integer not null,
  institution_id uuid references institutions(id),
  bank_account_id uuid,
  summary jsonb not null default '{}'::jsonb,
  document_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, kind, sha256)    -- o mesmo arquivo importado duas vezes é recusado (A21)
);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  bank text,
  agency text,
  account text,
  opening_balance_cents bigint not null default 0,
  opening_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid not null,
  file_id uuid,
  tx_date date not null,
  amount_cents bigint not null check (amount_cents <> 0),
  description text,
  fitid text,
  fingerprint text not null,
  ordinal integer not null default 1,
  status text not null default 'pendente' check (status in ('pendente', 'conciliada', 'ignorada')),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, account_id, fingerprint, ordinal),
  foreign key (company_id, account_id) references bank_accounts(company_id, id),
  foreign key (company_id, file_id) references import_files(company_id, id)
);

-- Liquidação de comissão pela seguradora: bruto quitado, retenções e deduções informadas, líquido depositado.
create table if not exists commission_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  institution_id uuid not null references institutions(id),
  settled_date date not null,
  gross_cents bigint not null check (gross_cents > 0),
  retention_cents bigint not null default 0 check (retention_cents >= 0),
  retention_nature text,
  deductions_cents bigint not null default 0 check (deductions_cents >= 0),
  net_cents bigint not null,
  source text not null default 'manual', -- manual | extrato | api
  reference text,
  notes text,
  import_file_id uuid,
  reversed_at timestamptz,
  reversed_reason text,
  reversed_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (net_cents = gross_cents - retention_cents - deductions_cents),
  unique (company_id, id),
  unique (company_id, number)
);

create table if not exists commission_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  settlement_id uuid not null,
  receivable_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),  -- valor BRUTO quitado
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, settlement_id) references commission_settlements(company_id, id),
  foreign key (company_id, receivable_id) references commission_receivables(company_id, id)
);
create index if not exists commission_allocations_receivable on commission_allocations(company_id, receivable_id);

create table if not exists commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  receivable_id uuid not null,
  kind text not null check (kind in ('credito', 'debito', 'estorno')),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  evidence text,
  source text not null default 'manual',
  cancellation_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, receivable_id) references commission_receivables(company_id, id)
);
drop trigger if exists commission_adjustments_immutable on commission_adjustments;
create trigger commission_adjustments_immutable before update on commission_adjustments for each row execute function apolven_block_change();

create table if not exists tax_withholdings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  settlement_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  nature text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, settlement_id) references commission_settlements(company_id, id)
);

create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity text not null,                -- commission_receivable | statement_line | split_accrual
  entity_id uuid not null,
  amount_cents bigint,
  reason text not null,
  status text not null default 'aberta' check (status in ('aberta', 'enviada', 'respondida', 'encerrada')),
  response text,
  opened_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (company_id, id)
);

create table if not exists statement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  file_id uuid not null,
  line_no integer not null,
  institution_id uuid not null references institutions(id),
  policy_number text,
  installment_no integer,
  external_id text,
  line_date date,
  gross_cents bigint not null,
  retention_cents bigint not null default 0,
  kind text not null default 'comissao', -- comissao | estorno | bonus | adiantamento | ajuste
  description text,
  fingerprint text not null,
  ordinal integer not null default 1,
  status text not null default 'pendente', -- pendente | conciliada | divergente | ignorada
  receivable_id uuid,
  settlement_id uuid,
  diff_cents bigint,
  note text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, institution_id, fingerprint, ordinal), -- linhas iguais legítimas recebem ordinal 1, 2… (A22)
  foreign key (company_id, file_id) references import_files(company_id, id),
  foreign key (company_id, receivable_id) references commission_receivables(company_id, id),
  foreign key (company_id, settlement_id) references commission_settlements(company_id, id)
);

-- Repasses ---------------------------------------------------------------
create table if not exists split_rule_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  partner_id uuid not null,
  name text not null,
  version integer not null default 1,
  institution_id uuid references institutions(id),
  branch text,
  kind text not null check (kind in ('percentual', 'fixo')),
  rate numeric(9,4) check (rate is null or (rate >= 0 and rate <= 100)),
  fixed_cents bigint check (fixed_cents is null or fixed_cents >= 0),
  base text not null check (base in ('comissao_bruta', 'comissao_liquida', 'recebimento_efetivo')),
  stage integer not null default 1 check (stage between 1 and 9),
  sequential boolean not null default false,  -- aplica sobre o restante após as etapas anteriores
  release text not null default 'no_recebimento' check (release in ('no_recebimento', 'antecipado')),
  reversal text not null default 'proporcional' check (reversal in ('proporcional', 'nenhuma')),
  valid_from date not null default current_date,
  valid_to date,
  approved_by uuid,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, partner_id) references partners(company_id, id)
);

create table if not exists policy_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  partner_id uuid not null,
  rule_version_id uuid not null,
  snapshot jsonb not null,             -- regra copiada no vínculo (alteração futura não recalcula)
  extraordinary boolean not null default false,
  extraordinary_reason text,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, policy_id, partner_id, rule_version_id),
  foreign key (company_id, policy_id) references policies(company_id, id) on delete cascade,
  foreign key (company_id, partner_id) references partners(company_id, id),
  foreign key (company_id, rule_version_id) references split_rule_versions(company_id, id)
);

create table if not exists split_payment_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado', 'pago', 'cancelado')),
  total_cents bigint not null default 0,
  items_hash text,
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_evidence text,
  bank_transaction_id uuid,
  cancelled_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number)
);

-- Liberação de repasse: positiva (liberada pelo recebimento) ou negativa (redução/recuperação por estorno)
create table if not exists split_accruals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_split_id uuid not null,
  partner_id uuid not null,
  policy_id uuid not null,
  receivable_id uuid,
  allocation_id uuid,
  adjustment_id uuid,
  base_cents bigint not null,
  amount_cents bigint not null check (amount_cents <> 0),
  kind text not null check (kind in ('liberacao', 'antecipacao', 'reducao', 'recuperacao')),
  status text not null default 'liberada' check (status in ('liberada', 'em_lote', 'paga', 'compensada', 'contestada')),
  batch_id uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, policy_split_id) references policy_splits(company_id, id),
  foreign key (company_id, partner_id) references partners(company_id, id),
  foreign key (company_id, allocation_id) references commission_allocations(company_id, id),
  foreign key (company_id, adjustment_id) references commission_adjustments(company_id, id),
  foreign key (company_id, batch_id) references split_payment_batches(company_id, id)
);
-- uma liberação por alocação/participante e um ajuste por estorno/participante (consumidores idempotentes)
create unique index if not exists split_accruals_alloc_uq on split_accruals(company_id, allocation_id, policy_split_id) where allocation_id is not null;
create unique index if not exists split_accruals_adj_uq on split_accruals(company_id, adjustment_id, policy_split_id, kind) where adjustment_id is not null;

create table if not exists split_batch_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  batch_id uuid not null,
  partner_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  payee jsonb not null,                -- favorecido congelado no momento do lote
  accrual_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, batch_id) references split_payment_batches(company_id, id) on delete cascade,
  foreign key (company_id, partner_id) references partners(company_id, id)
);

-- lote aprovado não pode ter itens/favorecido alterados silenciosamente (26.4 / A28)
create or replace function apolven_batch_items_lock() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from split_payment_batches where id = coalesce(new.batch_id, old.batch_id);
  if st is not null and st <> 'rascunho' then
    raise exception 'lote de repasse aprovado: itens e favorecidos não podem ser alterados' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists split_batch_items_lock on split_batch_items;
create trigger split_batch_items_lock before insert or update or delete on split_batch_items for each row execute function apolven_batch_items_lock();

create table if not exists reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  bank_transaction_id uuid not null,
  target_kind text not null check (target_kind in ('commission_settlement', 'split_batch', 'cash_entry')),
  target_id uuid not null,
  amount_cents bigint not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  undo_reason text,
  unique (company_id, id),
  foreign key (company_id, bank_transaction_id) references bank_transactions(company_id, id)
);
create unique index if not exists reconciliation_active_target on reconciliation_matches(company_id, target_kind, target_id) where undone_at is null;

-- Financeiro próprio da corretora (17.3): receitas de comissão e despesas; prêmio NUNCA entra aqui
create table if not exists cash_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('receber', 'pagar')),
  category text not null,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  competence date not null,
  due_date date not null,
  paid_date date,
  status text not null default 'aberto' check (status in ('aberto', 'pago', 'cancelado')),
  cost_center text,
  unit_id uuid,
  source text not null default 'manual', -- manual | comissao | repasse | retencao
  source_id uuid,
  reversal_of uuid,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, unit_id) references units(company_id, id)
);
create index if not exists cash_entries_due on cash_entries(company_id, status, due_date);

create table if not exists period_closures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  closed_at timestamptz not null default now(),
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  unique (company_id, id)
);
create unique index if not exists period_closures_open on period_closures(company_id, period) where reopened_at is null;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid,
  channel text not null,               -- whatsapp | email | telefone | portal
  purpose text not null,
  body text not null,
  status text not null default 'aberta_no_aparelho',  -- nada é enviado pelo servidor sem provedor contratado
  entity text,
  entity_id uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete cascade
);

alter table commission_agreements enable row level security;
alter table commission_rule_versions enable row level security;
alter table commission_receivables enable row level security;
alter table import_files enable row level security;
alter table bank_accounts enable row level security;
alter table bank_transactions enable row level security;
alter table commission_settlements enable row level security;
alter table commission_allocations enable row level security;
alter table commission_adjustments enable row level security;
alter table tax_withholdings enable row level security;
alter table disputes enable row level security;
alter table statement_lines enable row level security;
alter table split_rule_versions enable row level security;
alter table policy_splits enable row level security;
alter table split_payment_batches enable row level security;
alter table split_accruals enable row level security;
alter table split_batch_items enable row level security;
alter table reconciliation_matches enable row level security;
alter table cash_entries enable row level security;
alter table period_closures enable row level security;
alter table messages enable row level security;
