-- Reverte 006_modelos_impressao.sql (APAGA os modelos de impressão e o logotipo em tamanho de impressão). Rode antes do 005.
set search_path to apolven;
drop table if exists print_templates cascade;
drop table if exists company_assets cascade;
delete from _migrations where name = '006_modelos_impressao.sql';
