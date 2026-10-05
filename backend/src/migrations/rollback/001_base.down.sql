-- Reverte 001_base.sql (APAGA os dados destas tabelas). Rode na ordem inversa: 004 → 001, com search_path apolven.
set search_path to apolven;
drop table if exists inbox_events cascade;
drop table if exists business_events cascade;
drop table if exists idempotency_keys cascade;
drop table if exists audit_log cascade;
drop table if exists system_settings cascade;
drop table if exists password_resets cascade;
drop table if exists rate_limits cascade;
drop table if exists counters cascade;
drop table if exists users cascade;
drop table if exists units cascade;
drop table if exists companies cascade;
delete from _migrations where name = '001_base.sql';
