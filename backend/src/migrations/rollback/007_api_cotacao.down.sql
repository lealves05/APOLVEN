-- Reverte 007_api_cotacao.sql (APAGA a trilha de chamadas à API de cotação e a configuração das APIs). Rode antes do 006.
set search_path to apolven;
alter table quote_offers drop column if exists api_call_id;
drop table if exists quote_api_calls cascade;
alter table provider_connections drop column if exists api_config;
delete from _migrations where name = '007_api_cotacao.sql';
