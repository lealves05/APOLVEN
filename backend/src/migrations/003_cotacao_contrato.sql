-- APOLVEN — 003: multicálculo (pedidos, rodadas imutáveis, tarefas por fonte, ofertas), comparativos,
-- propostas (estados separados, autorização do cliente, operações idempotentes), apólices, endossos,
-- cancelamentos, parcelas do seguro (obrigação do segurado com a seguradora), sinistros e solicitações.

create table if not exists quote_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  client_id uuid not null,
  opportunity_id uuid,
  renewal_of_policy_id uuid,
  branch text not null,
  status text not null default 'rascunho', -- rascunho | em_andamento | concluida | parcial | cancelada
  title text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references clients(company_id, id),
  foreign key (company_id, opportunity_id) references opportunities(company_id, id)
);

-- Rodada imutável (8.1-8): versão do questionário, dados, coberturas mínimas, preferências, regras e autor
create table if not exists quote_rounds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  request_id uuid not null,
  round_no integer not null,
  risk_schema_version text not null,
  risk_data jsonb not null,
  min_coverages jsonb not null default '[]'::jsonb,   -- [{code,name,min_limit_cents,required}]
  preferences jsonb not null default '{}'::jsonb,
  start_date date,
  end_date date,
  scoring jsonb not null,                               -- pesos usados na comparação (sem comissão)
  status text not null default 'executando',           -- executando | concluida | parcial | cancelada
  data_hash text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (company_id, id),
  unique (company_id, request_id, round_no),
  foreign key (company_id, request_id) references quote_requests(company_id, id) on delete cascade
);

create or replace function apolven_round_immutable() returns trigger language plpgsql as $$
begin
  if new.risk_data is distinct from old.risk_data or new.min_coverages is distinct from old.min_coverages
     or new.preferences is distinct from old.preferences or new.scoring is distinct from old.scoring
     or new.risk_schema_version is distinct from old.risk_schema_version or new.data_hash is distinct from old.data_hash
     or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    raise exception 'rodada de cotação é imutável: crie uma nova rodada' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists quote_rounds_immutable on quote_rounds;
create trigger quote_rounds_immutable before update on quote_rounds for each row execute function apolven_round_immutable();

-- Uma tarefa por fonte/produto/cenário (8.3). Estados do 8.4: falha técnica nunca vira recusa.
create table if not exists quote_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  round_id uuid not null,
  institution_id uuid not null references institutions(id),
  connection_id uuid,
  product_id uuid,
  scenario text not null default 'minima',
  mode text not null check (mode in ('automatica', 'assistida')),
  status text not null default 'aguardando',
  reason text,
  protocol text,
  attempts integer not null default 0,
  assignee_user_id uuid,
  due_at timestamptz,
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, round_id) references quote_rounds(company_id, id) on delete cascade,
  foreign key (company_id, connection_id) references provider_connections(company_id, id),
  foreign key (company_id, product_id) references products(company_id, id)
);
create index if not exists quote_tasks_round on quote_tasks(company_id, round_id);

-- Oferta normalizada (8.5): valores desconhecidos ficam NULL (nunca zero); preço não pode ser editado depois
create table if not exists quote_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  round_id uuid not null,
  task_id uuid not null,
  institution_id uuid not null references institutions(id),
  connection_id uuid,
  product_name text not null,
  product_id uuid,
  scenario text not null default 'minima',
  origin text not null,                -- api | documento_formal | informada_pela_seguradora
  quote_kind text not null check (quote_kind in ('cotacao_valida', 'valor_indicativo')),
  external_id text,
  quoted_at timestamptz not null default now(),
  valid_until date,
  premium_net_cents bigint,
  taxes_cents bigint,
  fees_cents bigint,
  total_premium_cents bigint not null check (total_premium_cents > 0),
  fields_definition text,              -- como os campos da fonte foram mapeados
  coverages jsonb not null default '[]'::jsonb,       -- [{code,name,limit_cents,deductible_text,deductible_cents}]
  assistances jsonb not null default '[]'::jsonb,
  payment_options jsonb not null default '[]'::jsonb, -- [{id,method,installments,first_cents,installment_cents,total_cents,note}]
  commission_rate numeric(9,4),
  commission_source text,              -- retornada | condicao_interna | nao_informada
  requirements text,                   -- vistoria, documentos, análise
  conditions text,
  document_id uuid,
  status text not null default 'ativa' check (status in ('ativa', 'retirada', 'vencida')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, round_id) references quote_rounds(company_id, id) on delete cascade,
  foreign key (company_id, task_id) references quote_tasks(company_id, id) on delete cascade,
  foreign key (company_id, document_id) references documents(company_id, id)
);

create or replace function apolven_offer_immutable() returns trigger language plpgsql as $$
begin
  if new.total_premium_cents is distinct from old.total_premium_cents or new.premium_net_cents is distinct from old.premium_net_cents
     or new.taxes_cents is distinct from old.taxes_cents or new.coverages is distinct from old.coverages
     or new.payment_options is distinct from old.payment_options or new.valid_until is distinct from old.valid_until
     or new.institution_id is distinct from old.institution_id or new.round_id is distinct from old.round_id then
    raise exception 'oferta registrada não pode ter preço/condições alterados: registre uma nova oferta' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists quote_offers_immutable on quote_offers;
create trigger quote_offers_immutable before update on quote_offers for each row execute function apolven_offer_immutable();

-- Comparativo da corretora (documento distinto da proposta formal do fornecedor — 9.1)
create table if not exists comparisons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  request_id uuid not null,
  round_id uuid not null,
  client_id uuid not null,
  offer_ids uuid[] not null,
  message text,
  status text not null default 'rascunho', -- rascunho | aprovado | enviado | escolhido | expirado | cancelado
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  chosen_offer_id uuid,
  chosen_payment_option text,
  chosen_at timestamptz,
  chosen_via text,
  chosen_by_name text,
  chosen_ip text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, request_id) references quote_requests(company_id, id),
  foreign key (company_id, round_id) references quote_rounds(company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id)
);

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  client_id uuid not null,
  request_id uuid,
  comparison_id uuid,
  offer_id uuid not null,
  offer_snapshot jsonb not null,       -- versão exata autorizada
  snapshot_hash text not null,
  payment_option jsonb,
  institution_id uuid not null references institutions(id),
  connection_id uuid,
  branch text not null,
  status text not null default 'rascunho',
  mode text not null default 'assistida' check (mode in ('automatica', 'assistida')),
  external_protocol text,
  external_proposal_number text,
  provisional_coverage text,           -- só com evidência formal
  policy_id uuid,
  divergences jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references clients(company_id, id),
  foreign key (company_id, offer_id) references quote_offers(company_id, id),
  foreign key (company_id, comparison_id) references comparisons(company_id, id)
);

create table if not exists customer_authorizations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  proposal_id uuid not null,
  offer_id uuid not null,
  snapshot_hash text not null,
  payment_option_id text,
  via text not null,                   -- portal | presencial | email | whatsapp | assinatura_eletronica | telefone
  authorized_by_name text not null,
  evidence text,
  evidence_document_id uuid,
  ip text,
  revoked_at timestamptz,
  created_by uuid,
  authorized_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, proposal_id) references proposals(company_id, id) on delete cascade
);

create table if not exists proposal_status_events (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  proposal_id uuid not null,
  from_status text,
  to_status text not null,
  source text not null default 'manual',  -- manual | fornecedor | sistema
  protocol text,
  evidence text,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  notes text,
  foreign key (company_id, proposal_id) references proposals(company_id, id) on delete cascade
);

-- Transmissões: identificador estável + tentativas; timeout vira "indeterminada" e exige consulta (9.3 / A10)
create table if not exists proposal_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  proposal_id uuid not null,
  kind text not null,                  -- transmissao | consulta
  operation_key text not null,
  status text not null,                -- enviada | confirmada | indeterminada | falhou | registrada_manual
  protocol text,
  attempts integer not null default 1,
  detail text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, operation_key),
  foreign key (company_id, proposal_id) references proposals(company_id, id) on delete cascade
);

create table if not exists policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null,             -- contratante
  insured_client_id uuid,              -- segurado (pode ser outro)
  payer_client_id uuid,                -- pagador (pode ser outro)
  institution_id uuid not null references institutions(id),
  product_id uuid,
  product_name text,
  branch text not null,
  policy_number text,
  certificate_number text,
  proposal_id uuid,
  previous_policy_id uuid,             -- renovação vinculada ao contrato anterior
  unit_id uuid,
  owner_user_id uuid,
  start_date date not null,
  end_date date not null,
  start_time text not null default '24:00',
  timezone text not null default 'America/Sao_Paulo',
  contract_state text not null default 'vigente',  -- vigente | cancelamento_solicitado | cancelada | vencida | renovada | suspensa
  doc_state text not null default 'aguardando_documento', -- aguardando_documento | recebido | divergente | conferido
  total_premium_cents bigint not null,
  premium_net_cents bigint,
  taxes_cents bigint,
  payment_summary text,
  coverages jsonb not null default '[]'::jsonb,
  commission_rule_version_id uuid,
  commission_snapshot jsonb,           -- regra vigente na contratação (14.3)
  source text not null default 'manual',          -- proposta | manual | importacao
  status_source text not null default 'manual',
  status_reason text,
  notes text,
  verified_at timestamptz,
  verified_by uuid,
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date),
  check (total_premium_cents >= 0),
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id),
  foreign key (company_id, insured_client_id) references clients(company_id, id),
  foreign key (company_id, payer_client_id) references clients(company_id, id),
  foreign key (company_id, proposal_id) references proposals(company_id, id),
  foreign key (company_id, previous_policy_id) references policies(company_id, id),
  foreign key (company_id, product_id) references products(company_id, id),
  foreign key (company_id, unit_id) references units(company_id, id)
);
-- identificador externo único por instituição + tipo dentro do tenant (28.2)
create unique index if not exists policies_number_uq on policies(company_id, institution_id, branch, policy_number) where policy_number is not null;
create index if not exists policies_end on policies(company_id, end_date);

alter table proposals add constraint proposals_policy_fk foreign key (company_id, policy_id) references policies(company_id, id);
alter table opportunities add constraint opportunities_renewal_fk foreign key (company_id, renewal_of_policy_id) references policies(company_id, id);
alter table quote_requests add constraint quote_requests_renewal_fk foreign key (company_id, renewal_of_policy_id) references policies(company_id, id);

create table if not exists policy_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  reason text not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (company_id, policy_id, version),
  foreign key (company_id, policy_id) references policies(company_id, id) on delete cascade
);
drop trigger if exists policy_versions_append_only on policy_versions;
create trigger policy_versions_append_only before update on policy_versions for each row execute function apolven_block_change();

create table if not exists policy_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  kind text not null default 'bem',    -- veiculo | imovel | vida | bem | local
  description text not null,
  identifier text,                     -- placa, chassi, CPF do segurado da vida…
  data jsonb not null default '{}'::jsonb,
  start_date date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, policy_id) references policies(company_id, id) on delete cascade
);
create index if not exists policy_items_identifier on policy_items(company_id, upper(identifier));

create table if not exists endorsements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  number bigint not null,
  kind text not null,                  -- inclusao | exclusao | alteracao_dados | alteracao_cobertura | alteracao_local | outro
  reason text not null,
  requested_date date not null,
  changes text not null,
  status text not null default 'solicitado', -- solicitado | em_analise | aceito | recusado | emitido | cancelado
  premium_diff_cents bigint,
  commission_diff_cents bigint,
  protocol text,
  effective_date date,
  document_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, policy_id) references policies(company_id, id)
);

create table if not exists cancellations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  requested_by_name text not null,
  powers text,
  reason text not null,
  requested_date date not null,
  status text not null default 'solicitado', -- solicitado | efetivado | desistencia | recusado
  effective_date date,
  refund_cents bigint,                 -- informado pela seguradora
  refund_estimate_cents bigint,        -- estimativa interna, sempre provisória
  refund_recipient text,
  refund_payer text,
  protocol text,
  evidence text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, policy_id) references policies(company_id, id)
);

-- Parcelas do seguro (13): obrigação do contratante com a seguradora — NÃO é conta a receber da corretora
create table if not exists premium_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_id uuid not null,
  endorsement_id uuid,
  number integer not null,
  total_count integer,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  adjustments_cents bigint not null default 0,
  method text,
  charge_url text,                     -- só https de origem verificada
  charge_ref text,
  payer_client_id uuid,
  source text not null default 'manual', -- api | arquivo | manual | cliente
  status_override text,                -- renegociada | cancelada | em_divergencia | restituida (com motivo)
  status_reason text,
  last_update_at timestamptz not null default now(),
  reminders_paused boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique nulls not distinct (company_id, policy_id, endorsement_id, number),
  foreign key (company_id, policy_id) references policies(company_id, id) on delete cascade,
  foreign key (company_id, endorsement_id) references endorsements(company_id, id)
);
create index if not exists premium_installments_due on premium_installments(company_id, due_date);

create table if not exists premium_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  installment_id uuid not null,
  kind text not null check (kind in ('informado', 'confirmado')),
  amount_cents bigint not null check (amount_cents > 0),
  paid_date date not null,
  source text not null,                -- cliente | corretora | seguradora_api | arquivo_oficial | seguradora_portal
  evidence text,
  document_id uuid,
  confirms_payment_id uuid,            -- confirmação de um pagamento informado
  voided_at timestamptz,
  voided_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, installment_id) references premium_installments(company_id, id) on delete cascade
);

create table if not exists premium_refunds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  installment_id uuid,
  cancellation_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  confirmed_date date not null,
  recipient text,
  evidence text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, installment_id) references premium_installments(company_id, id),
  foreign key (company_id, cancellation_id) references cancellations(company_id, id)
);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  policy_id uuid not null,
  client_id uuid not null,
  item_id uuid,
  occurred_at timestamptz not null,
  location text,
  description text not null,
  contact_name text,
  contact_phone text,
  insurer_protocol text,
  insurer_status text,                 -- estado informado pela seguradora (texto/fonte)
  insurer_status_at timestamptz,
  work_status text not null default 'aberto', -- aberto | documentacao | aguardando_seguradora | em_regulacao | indenizado | negado | encerrado
  coverage_decision text,              -- decisão informada pela seguradora (o sistema não decide cobertura)
  decision_evidence text,
  amount_paid_cents bigint,
  deadline_at timestamptz,
  deadline_rule text,
  assignee_user_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, policy_id) references policies(company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id),
  foreign key (company_id, item_id) references policy_items(company_id, id)
);

create table if not exists claim_events (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  claim_id uuid not null,
  kind text not null,                  -- nota | documento_solicitado | documento_entregue | contato | status | decisao
  summary text not null,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  document_id uuid,
  user_id uuid,
  user_name text,
  foreign key (company_id, claim_id) references claims(company_id, id) on delete cascade
);

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint not null,
  client_id uuid not null,
  policy_id uuid,
  kind text not null,                  -- segunda_via | assistencia | atualizacao_cadastral | declaracao | duvida | reclamacao | outro
  description text not null,
  priority text not null default 'normal',
  status text not null default 'aberta', -- aberta | em_andamento | aguardando_cliente | aguardando_seguradora | concluida | cancelada
  channel text,
  assignee_user_id uuid,
  due_at timestamptz,
  resolution text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, client_id) references clients(company_id, id),
  foreign key (company_id, policy_id) references policies(company_id, id)
);

alter table quote_requests enable row level security;
alter table quote_rounds enable row level security;
alter table quote_tasks enable row level security;
alter table quote_offers enable row level security;
alter table comparisons enable row level security;
alter table proposals enable row level security;
alter table customer_authorizations enable row level security;
alter table proposal_status_events enable row level security;
alter table proposal_operations enable row level security;
alter table policies enable row level security;
alter table policy_versions enable row level security;
alter table policy_items enable row level security;
alter table endorsements enable row level security;
alter table cancellations enable row level security;
alter table premium_installments enable row level security;
alter table premium_payments enable row level security;
alter table premium_refunds enable row level security;
alter table claims enable row level security;
alter table claim_events enable row level security;
alter table service_requests enable row level security;
