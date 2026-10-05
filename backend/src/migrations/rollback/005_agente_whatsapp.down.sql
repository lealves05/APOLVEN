-- Reverte 005_agente_whatsapp.sql (APAGA conversas, mensagens e configuração do agente). Rode antes do 004.
set search_path to apolven;
drop table if exists agent_runs cascade;
drop table if exists agent_dispatches cascade;
drop table if exists wa_messages cascade;
drop table if exists wa_conversations cascade;
drop table if exists wa_agents cascade;
alter table users drop column if exists phone, drop column if exists wa_reminders;
delete from _migrations where name = '005_agente_whatsapp.sql';
