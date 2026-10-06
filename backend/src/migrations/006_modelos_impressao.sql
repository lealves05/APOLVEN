-- Logotipo em tamanho de impressão e modelos de impressão (apólice) por corretora.
-- Somente acréscimos: nada existente é alterado.

create table if not exists company_assets (
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('logo')),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  data bytea not null,
  size integer not null,
  sha256 text not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);

create table if not exists print_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null default 'apolice' check (kind in ('apolice')),
  branch text,                                   -- null = modelo padrão da corretora (vale para todos os ramos)
  doc jsonb not null,                            -- corpo (JSON do editor, validado no servidor)
  header jsonb,
  footer jsonb,
  page jsonb not null,                           -- papel, orientação e margens
  version integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists print_templates_unique on print_templates (company_id, kind, coalesce(branch, ''));

alter table company_assets enable row level security;
alter table print_templates enable row level security;
