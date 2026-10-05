-- APOLVEN — 002: CRM (clientes, vínculos, consentimentos, oportunidades, atendimento, tarefas), documentos,
-- links temporários, parceiros/produtores, instituições, conexões de integração (Anexo C) e catálogo de produtos.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_id uuid,
  kind text not null default 'pf' check (kind in ('pf', 'pj')),
  name text not null,
  trade_name text,
  document text,                       -- CPF/CNPJ só dígitos (normalizado)
  birth_date date,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  owner_user_id uuid,                  -- corretor responsável (carteira)
  origin text,
  preferred_channel text,
  marketing_opt_out boolean not null default false,
  notes text,
  tags text[] not null default '{}',
  active boolean not null default true,
  merged_into uuid,
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, unit_id) references units(company_id, id),
  foreign key (company_id, owner_user_id) references users(company_id, id)
);
-- duplicidade detectada por identificador normalizado dentro do tenant (5.1)
create unique index if not exists clients_document_uq on clients(company_id, document) where document is not null and merged_into is null;
create index if not exists clients_company_name on clients(company_id, lower(name));

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null,
  name text not null,
  role text,
  email text,
  phone text,
  authorized boolean not null default false,   -- contato autorizado a tratar do contrato
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete cascade
);

-- contratante, segurado, pagador, estipulante, beneficiário, dependente, representante… nunca presumidos iguais
create table if not exists client_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null,
  related_client_id uuid not null,
  relation text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, client_id, related_client_id, relation),
  check (client_id <> related_client_id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete cascade,
  foreign key (company_id, related_client_id) references clients(company_id, id) on delete cascade
);

-- finalidades e autorizações (25.3) — separadas de marketing e de Open Insurance
create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid not null,
  purpose text not null,               -- cotacao | marketing | dados_sensiveis | open_insurance | portal
  legal_basis text,
  recipients text,
  granted boolean not null default true,
  evidence text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_by uuid,
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete cascade
);
create index if not exists consents_client on consents(company_id, client_id, purpose);

create table if not exists privacy_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid,
  kind text not null,                  -- acesso | correcao | exportacao | eliminacao | revogacao | informacao
  description text,
  status text not null default 'aberta',
  due_at date,
  response text,
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id)
);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  number bigint,
  client_id uuid not null,
  branch text not null,                -- ramo
  title text not null,
  need text,
  stage text not null default 'novo_contato',
  estimated_premium_cents bigint,
  origin text,
  owner_user_id uuid,
  next_action text,
  next_action_at timestamptz,
  lost_reason text,
  renewal_of_policy_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id),
  foreign key (company_id, owner_user_id) references users(company_id, id)
);
create index if not exists opportunities_company_stage on opportunities(company_id, stage);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid,
  opportunity_id uuid,
  entity text,
  entity_id uuid,
  kind text not null default 'nota',   -- nota | ligacao | email | whatsapp | reuniao | sistema | reclamacao
  summary text not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete cascade,
  foreign key (company_id, opportunity_id) references opportunities(company_id, id) on delete cascade
);
create index if not exists activities_client on activities(company_id, client_id, created_at desc);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  description text,
  kind text not null default 'tarefa', -- tarefa | renovacao | parcela | cotacao | proposta | sinistro | integracao | documento
  priority text not null default 'normal',
  status text not null default 'aberta' check (status in ('aberta', 'concluida', 'cancelada')),
  due_at timestamptz,
  assignee_user_id uuid,
  client_id uuid,
  entity text,
  entity_id uuid,
  auto_key text,                       -- idempotência das tarefas geradas por regra
  created_by uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid,
  unique (company_id, id),
  foreign key (company_id, assignee_user_id) references users(company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete cascade
);
create unique index if not exists tasks_auto_key on tasks(company_id, auto_key) where auto_key is not null;
create index if not exists tasks_open on tasks(company_id, status, due_at);

-- Documentos privados (19.3): no banco (entram no backup), com hash, versão, origem e nível de acesso
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  client_id uuid,
  kind text not null default 'outro',
  filename text not null,
  mime text not null,
  size integer not null,
  sha256 text not null,
  data bytea not null,
  version integer not null default 1,
  origin text not null default 'corretora',  -- corretora | seguradora | cliente | importacao
  access_level text not null default 'normal' check (access_level in ('normal', 'restrito')),
  valid_until date,
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id)
);
create index if not exists documents_entity on documents(company_id, entity, entity_id);

-- Links temporários, revogáveis e vinculados a uma finalidade (23): o token nunca é guardado em claro
create table if not exists public_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  purpose text not null,               -- comparativo | parcelas | documento | dados_cadastrais
  entity text not null,
  entity_id uuid not null,
  client_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_access_at timestamptz,
  access_count integer not null default 0,
  unique (company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id)
);

-- Produtores, assessorias e parceiros (repasses)
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null default 'produtor', -- produtor | assessoria | parceiro | filial
  name text not null,
  document text,
  email text,
  phone text,
  user_id uuid,
  bank_info jsonb,                     -- favorecido; troca exige reautenticação e fica na auditoria
  bank_info_changed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, user_id) references users(company_id, id)
);

-- Instituições: catálogo global da plataforma (company_id nulo, só dados públicos validados) + cadastros da corretora
create table if not exists institutions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  code text,                           -- código do catálogo global (ex.: porto)
  kind text not null default 'seguradora', -- seguradora | operadora | administradora | previdencia | parceiro_tecnologico
  name text not null,
  legal_name text,
  cnpj text,                           -- só quando validado; nunca adivinhado
  brand_group text,
  official_code text,                  -- código SUSEP/ANS da instituição quando validado
  verified_at date,
  verified_source text,
  assistance_phone text,
  contacts jsonb not null default '{}'::jsonb,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index if not exists institutions_global_code on institutions(code) where company_id is null;

-- Conexão/vínculo da corretora com uma instituição por um caminho (Anexo C). Estados em dimensões separadas (C.10).
create table if not exists provider_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  institution_id uuid not null references institutions(id),
  template_code text not null,
  template_version integer not null,
  method text not null,                -- api_direta | multicalculo_parceiro | open_insurance | arquivo | assistida
  unit_id uuid,
  partner_connection_id uuid,          -- vínculo via parceiro de multicálculo
  products text[] not null default '{}',
  accreditation text not null default 'nao' check (accreditation in ('sim', 'em_analise', 'nao')),
  broker_code text,                    -- código da corretora/produtor/sucursal NO fornecedor (não é segredo)
  branch_code text,
  producer_code text,
  environment text not null default 'testes' check (environment in ('testes', 'producao')),
  reg_state text not null default 'rascunho',       -- rascunho | completo | pendente_evidencia | divergente
  commercial_state text not null default 'nao_solicitado', -- nao_solicitado | em_analise | aprovado | recusado | suspenso | vencido
  technical_state text not null default 'sem_conector',    -- sem_conector | nao_configurado | aguardando_credencial | autenticacao_valida | erro | em_homologacao | homologado
  health_state text not null default 'desconhecido',       -- operando | degradado | indisponivel | desconhecido
  step integer not null default 1 check (step between 1 and 5),
  paused boolean not null default false,
  paused_reason text,
  revoked_at timestamptz,
  evaluation_requested_at timestamptz,
  notes text,
  last_test_at timestamptz,
  last_sync_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (company_id, id),
  foreign key (company_id, unit_id) references units(company_id, id)
);
-- impede duplicação idêntica por clique repetido (C.5); caminhos/filiais diferentes continuam permitidos
create unique index if not exists provider_connections_uq on provider_connections
  (company_id, institution_id, template_code, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), environment, coalesce(partner_connection_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

create table if not exists integration_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid not null,
  code text not null,
  label text not null,
  why text,
  provided_by text,                    -- corretora | seguradora | parceiro | plataforma
  resolved_by text,                    -- administrador | responsavel_tecnico | contato_comercial | suporte
  required boolean not null default true,
  blocks text[] not null default '{}', -- capacidades bloqueadas enquanto não confirmado
  status text not null default 'nao_iniciado', -- nao_iniciado | preenchido | enviado | aguardando_analise | confirmado | recusado | vencido
  link text,
  protocol text,
  evidence_document_id uuid,
  valid_until date,
  notes text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, connection_id, code),
  foreign key (company_id, connection_id) references provider_connections(company_id, id) on delete cascade,
  foreign key (company_id, evidence_document_id) references documents(company_id, id)
);

-- Credenciais: material cifrado (secretbox) + identificação não secreta. Nunca devolvidas ao navegador (C.7).
create table if not exists credential_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid not null,
  version integer not null,
  sealed text not null,
  public_info jsonb not null default '{}'::jsonb,   -- ex.: client_id mascarado, titular do certificado
  owner text not null default 'corretora',         -- corretora | filial | produtor | parceiro | plataforma
  environment text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, connection_id, version),
  foreign key (company_id, connection_id) references provider_connections(company_id, id) on delete cascade
);

create table if not exists connection_test_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid not null,
  credential_version_id uuid,
  template_version integer not null,
  environment text not null,
  status text not null,                -- concluido | erro
  code text,                           -- código interno (C.17)
  results jsonb not null default '{}'::jsonb,
  duration_ms integer,
  correlation_id text not null,
  started_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, connection_id) references provider_connections(company_id, id) on delete cascade
);

create table if not exists capability_validations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid not null,
  capability text not null,            -- cotacao | proposta_status | transmissao | documentos | parcelas | extratos | endosso_sinistro
  environment text not null,
  state text not null default 'bloqueada', -- bloqueada | pendente | validada | ativa | pausada | indisponivel
  reason text,
  evidence text,
  evidence_document_id uuid,
  test_run_id uuid,
  credential_version_id uuid,
  validated_by uuid,
  validated_at timestamptz,
  activated_by uuid,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, connection_id, capability, environment),
  foreign key (company_id, connection_id) references provider_connections(company_id, id) on delete cascade
);

create table if not exists integration_events (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  connection_id uuid not null,
  kind text not null,
  summary text not null,
  data jsonb,
  user_id uuid,
  user_name text,
  created_at timestamptz not null default now(),
  foreign key (company_id, connection_id) references provider_connections(company_id, id) on delete cascade
);

-- Catálogo de produtos versionado (6.2): características conhecidas; preço só vem de cotação
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  institution_id uuid not null references institutions(id),
  branch text not null,
  name text not null,
  provider_code text,
  official_process text,
  version text not null default '1',
  valid_from date,
  valid_to date,
  status text not null default 'rascunho', -- rascunho | validado | ativo | vencido | retirado | pendente_revisao
  coverages jsonb not null default '[]'::jsonb,  -- [{code,name,basic,limit_cents,deductible}]
  assistances jsonb not null default '[]'::jsonb,
  payment_terms text,
  eligibility text,
  territory text,
  required_documents text,
  conditions_url text,
  source text,
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

-- Catálogo global inicial (C.3): só nomes de caminhos a avaliar. CNPJ e códigos oficiais ficam vazios até validação.
insert into institutions (code, kind, name, notes) values
  ('porto', 'seguradora', 'Porto Seguro', 'Portal do desenvolvedor com cadastro, aprovação de APP, tokens e ambientes de teste [F5][F20].'),
  ('tokio_marine', 'seguradora', 'Tokio Marine', 'Portal de integração público; cadastro comercial exigido antes da documentação técnica [F6][F23].'),
  ('bradesco_seguros', 'seguradora', 'Bradesco Seguros', 'APIs de seguro empresarial (cotação, efetivação, pagamento, consulta, endosso) [F7][F21][F22].'),
  ('bb_brasilseg', 'seguradora', 'BB / Brasilseg', 'API comercial condicionada a parceria e contrato/cadastro ativo [F8].')
on conflict do nothing;

alter table clients enable row level security;
alter table client_contacts enable row level security;
alter table client_relationships enable row level security;
alter table consents enable row level security;
alter table privacy_requests enable row level security;
alter table opportunities enable row level security;
alter table activities enable row level security;
alter table tasks enable row level security;
alter table documents enable row level security;
alter table public_links enable row level security;
alter table partners enable row level security;
alter table institutions enable row level security;
alter table provider_connections enable row level security;
alter table integration_requirements enable row level security;
alter table credential_versions enable row level security;
alter table connection_test_runs enable row level security;
alter table capability_validations enable row level security;
alter table integration_events enable row level security;
alter table products enable row level security;
