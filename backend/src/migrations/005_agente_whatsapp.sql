-- Agente do WhatsApp Business (API oficial Cloud da Meta): conexão por corretora, conversas, mensagens,
-- rotinas automáticas para clientes (com controle de duplicidade) e lembretes da equipe.

-- WhatsApp do próprio usuário para receber os lembretes da equipe
alter table users add column if not exists phone text;
alter table users add column if not exists wa_reminders boolean not null default false;

create table if not exists wa_agents (
  company_id uuid primary key references companies(id) on delete cascade,
  enabled boolean not null default false,          -- envios reais (rotinas e respostas) ligados
  name text not null default 'Assistente',
  phone_number_id text unique,                     -- ID do número na Meta (roteia o webhook)
  waba_id text,
  display_phone text,
  verified_name text,
  quality_rating text,
  secrets text,                                    -- {access_token, app_secret} cifrados (secretbox), nunca voltam ao navegador
  verify_token text not null,                      -- token de verificação do webhook (gerado)
  connection_status text not null default 'nao_configurado'
    check (connection_status in ('nao_configurado', 'configurado', 'verificado', 'conectado', 'erro')),
  connection_checked_at timestamptz,
  webhook_verified_at timestamptz,
  last_webhook_at timestamptz,
  last_error text,
  settings jsonb not null default '{}'::jsonb,     -- rotinas, horários, modelos, menu, lembretes da equipe
  version integer not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wa_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  phone text not null,                             -- wa_id (só dígitos, com DDI)
  simulated boolean not null default false,        -- simulador da tela (nada sai do sistema)
  client_id uuid,
  user_id uuid,                                    -- conversa com um usuário da equipe (lembretes)
  contact_name text,
  status text not null default 'agente' check (status in ('agente', 'humano', 'encerrada')),
  assigned_user_id uuid,
  context jsonb not null default '{}'::jsonb,
  handoff_reason text,
  handoff_at timestamptz,
  verified_until timestamptz,                      -- identidade conferida (3 primeiros dígitos do CPF/CNPJ)
  opted_out_at timestamptz,                        -- pediu para não receber avisos (SAIR)
  unread integer not null default 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, phone, simulated),
  foreign key (company_id, client_id) references clients(company_id, id) on delete set null (client_id),
  foreign key (company_id, user_id) references users(company_id, id) on delete set null (user_id),
  foreign key (company_id, assigned_user_id) references users(company_id, id) on delete set null (assigned_user_id)
);
create index if not exists wa_conversations_recent on wa_conversations(company_id, simulated, updated_at desc);

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'text',               -- text | template | image | document | audio | ...
  body text,
  template_name text,
  wa_message_id text,
  status text not null default 'enviada',          -- recebida | enviada | entregue | lida | falhou | simulada
  error text,
  routine text,                                    -- rotina que gerou o envio (se houver)
  entity text,
  entity_id uuid,
  sent_by uuid,                                    -- usuário que respondeu manualmente
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, conversation_id) references wa_conversations(company_id, id) on delete cascade
);
create unique index if not exists wa_messages_waid on wa_messages(company_id, wa_message_id) where wa_message_id is not null;
create index if not exists wa_messages_conv on wa_messages(conversation_id, created_at);

-- Controle de duplicidade: um aviso por rotina, registro e marco (ex.: parcela X, 3 dias antes)
create table if not exists agent_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  routine text not null,
  ref_id uuid not null,
  milestone text not null default '',
  recipient text not null,                         -- telefone do destinatário
  status text not null default 'pendente' check (status in ('pendente', 'enviada', 'falhou', 'ignorada')),
  attempts integer not null default 0,
  reason text,
  message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, routine, ref_id, milestone)
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  routine text not null,
  trigger text not null default 'agendado',        -- agendado | manual
  sent integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  note text,
  details jsonb not null default '[]'::jsonb,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists agent_runs_recent on agent_runs(company_id, created_at desc);

alter table wa_agents enable row level security;
alter table wa_conversations enable row level security;
alter table wa_messages enable row level security;
alter table agent_dispatches enable row level security;
alter table agent_runs enable row level security;
