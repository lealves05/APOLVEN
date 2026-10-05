-- APOLVEN — 001: base multiempresa (tenant = corretora), identidade, auditoria, central da plataforma.
-- Convenções: valores monetários em CENTAVOS (bigint, sufixo _cents); percentuais numeric(9,4);
-- toda tabela operacional tem company_id e unique (company_id, id), e os vínculos usam chave estrangeira composta
-- (company_id, x_id) → nenhum registro de uma corretora pode apontar para registro de outra (caso A02).

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  slug text not null unique,
  document text,                       -- CNPJ (só dígitos)
  susep_code text,                     -- registro da corretora (habilitação), não é credencial de API
  tech_responsible_name text,
  tech_responsible_document text,
  segments text[] not null default '{}',
  phone text,
  email text,
  cep text, street text, number text, complement text, district text, city text, uf text, city_code text,
  logo_url text,
  settings jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  platform_access jsonb,
  platform_access_at timestamptz,
  platform_registered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  document text,
  susep_code text,
  city text, uf text,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_id uuid,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'broker',
  team text,
  active boolean not null default true,
  preferences jsonb not null default '{}'::jsonb,
  auth_version integer not null default 0,
  password_changed_at timestamptz,
  mfa_enabled boolean not null default false,
  mfa_secret text,                     -- cifrado (secretbox), nunca volta ao navegador
  mfa_recovery jsonb,                  -- hashes dos códigos de recuperação
  mfa_enabled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, unit_id) references units(company_id, id)
);
create index if not exists users_company on users(company_id);

create table if not exists counters (
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,
  value bigint not null default 0,
  primary key (company_id, kind)
);

create table if not exists rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);

create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

create table if not exists system_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- Auditoria de atos (25.4): somente inclusão
create table if not exists audit_log (
  id bigserial primary key,
  company_id uuid references companies(id) on delete cascade,
  user_id uuid,
  user_name text,
  entity text not null,
  entity_id text,
  action text not null,
  summary text,
  reason text,
  data jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists audit_company_at on audit_log(company_id, created_at desc);

create or replace function apolven_block_change() returns trigger language plpgsql as $$
begin
  raise exception 'registro protegido: % não permite %', tg_table_name, tg_op using errcode = 'P0001';
end $$;
drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only before update on audit_log for each row execute function apolven_block_change();

-- Chaves de idempotência (29.2): mesma chave + conteúdo diferente = conflito, sem executar de novo
create table if not exists idempotency_keys (
  company_id uuid not null references companies(id) on delete cascade,
  key text not null,
  operation text not null,
  request_hash text not null,
  response jsonb,
  status text not null default 'em_andamento',
  created_at timestamptz not null default now(),
  primary key (company_id, key)
);

-- Eventos de negócio (29.3): identificador único, tenant, entidade, versão, instante, origem e correlação
create table if not exists business_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  type text not null,
  entity text not null,
  entity_id uuid,
  version integer not null default 1,
  source text not null default 'sistema',
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  correlation_id text,
  data jsonb,
  processed_at timestamptz
);
create index if not exists business_events_company on business_events(company_id, occurred_at desc);

-- Notificações recebidas de fora (webhooks): deduplicadas por origem + identificador externo
create table if not exists inbox_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  source text not null,
  external_id text not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  unique (source, external_id)
);

alter table companies enable row level security;
alter table units enable row level security;
alter table users enable row level security;
alter table counters enable row level security;
alter table rate_limits enable row level security;
alter table password_resets enable row level security;
alter table system_settings enable row level security;
alter table audit_log enable row level security;
alter table idempotency_keys enable row level security;
alter table business_events enable row level security;
alter table inbox_events enable row level security;
