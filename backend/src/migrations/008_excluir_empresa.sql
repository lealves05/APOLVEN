-- Exclusão de empresa pedida pela central da plataforma (MASTER): a empresa e tudo o que é dela saem juntos
-- (on delete cascade). A trava dos itens de lote de repasse aprovado continua valendo sempre, exceto durante a
-- exclusão da própria empresa (marcada só na transação da exclusão por set_config('apolven.purge_company', ...)).
-- Rollback: migrations/rollback/008_excluir_empresa.down.sql
create or replace function apolven_batch_items_lock() returns trigger language plpgsql as $$
declare st text;
begin
  if tg_op = 'DELETE' and current_setting('apolven.purge_company', true) = old.company_id::text then
    return old;
  end if;
  select status into st from split_payment_batches where id = coalesce(new.batch_id, old.batch_id);
  if st is not null and st <> 'rascunho' then
    raise exception 'lote de repasse aprovado: itens e favorecidos não podem ser alterados' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
