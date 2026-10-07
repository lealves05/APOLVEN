-- Reverte 008_excluir_empresa.sql: volta a trava dos itens de lote de repasse sem a exceção da exclusão de empresa.
set search_path to apolven;
create or replace function apolven_batch_items_lock() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from split_payment_batches where id = coalesce(new.batch_id, old.batch_id);
  if st is not null and st <> 'rascunho' then
    raise exception 'lote de repasse aprovado: itens e favorecidos não podem ser alterados' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
