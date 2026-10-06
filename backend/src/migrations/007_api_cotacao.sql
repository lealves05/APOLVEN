-- API de cotação "padrão APOLVEN": configuração não secreta da API por conexão (os segredos continuam cifrados em
-- credential_versions) e trilha de cada chamada (quais dados foram para qual seguradora, resposta original e resultado).
-- Somente acréscimos: nada existente é alterado.

alter table provider_connections add column if not exists api_config jsonb;   -- {base_url, auth_type, header_name, token_url, scope, timeout_ms}

create table if not exists quote_api_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid not null,
  institution_id uuid references institutions(id),
  round_id uuid,
  task_id uuid,
  kind text not null check (kind in ('cotacao', 'teste')),
  host text not null,                    -- só o servidor de destino (sem caminho/credencial)
  attempt integer not null default 1,
  http_status integer,
  outcome text not null,                 -- estado resultante da tarefa / resultado do teste
  error text,
  duration_ms integer,
  fields_sent text[] not null default '{}',  -- caminhos dos dados efetivamente enviados (LGPD)
  sharing_basis text,                    -- base de compartilhamento informada na rodada
  request_hash text,
  response_raw jsonb,                    -- resposta original (limitada a 512 KB), nunca exibida ao cliente
  response_bytes integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, connection_id) references provider_connections(company_id, id) on delete cascade,
  foreign key (company_id, task_id) references quote_tasks(company_id, id) on delete cascade
);
create index if not exists quote_api_calls_task on quote_api_calls(company_id, task_id);
create index if not exists quote_api_calls_recent on quote_api_calls(company_id, created_at desc);

alter table quote_offers add column if not exists api_call_id uuid;    -- resposta original que gerou a oferta

alter table quote_api_calls enable row level security;
