// Dados de exemplo da DEMONSTRAÇÃO (corretora is_demo). Todos fictícios e identificados como tal;
// nenhuma cotação de exemplo é apresentada como real: as ofertas ficam marcadas como "valor indicativo (exemplo)".
import bcrypt from 'bcryptjs';
import { today, addDays, addMonths, splitEven, applyRate, hashOf } from './util.js';
import { commissionSchedule } from './lib/finance.js';

function docWithDigits(base) {
  const calc = (b, w) => { const s = b.split('').reduce((a, n, i) => a + Number(n) * w[i], 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  if (base.length === 9) {
    const d1 = calc(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return `${base}${d1}${calc(`${base}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`;
  }
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${calc(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

export async function seedDemo(db, companyId, ownerId) {
  const one = async (sql, p) => (await db.query(sql, p)).rows[0];
  const ref = today();
  const unit = await one('select id from units where company_id = $1 limit 1', [companyId]);
  const inst = Object.fromEntries((await db.query(`select code, id from institutions where company_id is null`)).rows.map((x) => [x.code, x.id]));
  const pass = await bcrypt.hash(`demo-${Math.random()}`, 6);
  const broker = await one(`insert into users (company_id, unit_id, name, email, password_hash, role, team) values ($1,$2,'Carla Mendes',$3,$4,'broker','Comercial') returning id`,
    [companyId, unit.id, `carla-${companyId.slice(0, 8)}@demo.apolven.app`, pass]);
  await db.query(`insert into users (company_id, unit_id, name, email, password_hash, role, team) values ($1,$2,'Rafael Souza',$3,$4,'finance','Financeiro')`,
    [companyId, unit.id, `rafael-${companyId.slice(0, 8)}@demo.apolven.app`, pass]);
  await db.query(`update companies set document = $2, susep_code = 'DEMO-0000', tech_responsible_name = 'Responsável Técnico (exemplo)', phone = '(19) 3000-0000',
    city = 'Campinas', uf = 'SP', segments = '{danos,pessoas}' where id = $1`, [companyId, docWithDigits('112223330001')]);

  // ---- clientes ----
  const C = [
    ['pf', 'Ana Beatriz Oliveira', docWithDigits('123456781'), 'ana.oliveira@exemplo.com', '(19) 99111-1001'],
    ['pf', 'Bruno Carvalho', docWithDigits('234567812'), 'bruno.carvalho@exemplo.com', '(19) 99111-1002'],
    ['pj', 'Padaria Pão Dourado Ltda', docWithDigits('234567890001'), 'contato@paodourado.exemplo', '(19) 3222-1003'],
    ['pf', 'Daniela Rocha', docWithDigits('345678123'), 'dani.rocha@exemplo.com', '(19) 99111-1004'],
    ['pf', 'Eduardo Lima', docWithDigits('456781234'), 'edu.lima@exemplo.com', '(19) 99111-1005'],
    ['pj', 'Transportes Rota Sul ME', docWithDigits('345678900001'), 'adm@rotasul.exemplo', '(19) 3222-1006'],
  ];
  const clients = [];
  for (const [i, c] of C.entries()) {
    const x = await one(`insert into clients (company_id, unit_id, kind, name, document, email, phone, owner_user_id, origin, address, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, name`,
    [companyId, unit.id, c[0], c[1], c[2], c[3], c[4], i % 2 ? broker.id : ownerId, ['indicação', 'site', 'carteira', 'whatsapp'][i % 4], { city: 'Campinas', uf: 'SP' }, ownerId]);
    await db.query(`insert into consents (company_id, client_id, purpose, legal_basis, evidence, created_by) values ($1,$2,'cotacao','procedimentos preliminares ao contrato','Autorização verbal registrada no atendimento (exemplo)',$3)`, [companyId, x.id, ownerId]);
    clients.push(x);
  }
  await db.query(`insert into client_relationships (company_id, client_id, related_client_id, relation, notes) values ($1,$2,$3,'conjuge','Exemplo de vínculo')`, [companyId, clients[0].id, clients[1].id]);

  // ---- seguradoras e conexões (operação assistida — nenhuma integração simulada) ----
  const conn = {};
  for (const [code, tpl, acc] of [['porto', 'assistida', 'sim'], ['tokio_marine', 'assistida', 'sim'], ['bradesco_seguros', 'bradesco_re_api', 'em_analise']]) {
    const c = await one(`insert into provider_connections (company_id, institution_id, template_code, template_version, method, unit_id, products, accreditation, broker_code, environment, technical_state, commercial_state, reg_state, step, created_by)
       values ($1,$2,$3,1,$4,$5,$6,$7,$8,'producao','sem_conector',$9,'completo',2,$10) returning id`,
    [companyId, inst[code], tpl, tpl === 'assistida' ? 'assistida' : 'api_direta', unit.id, tpl === 'assistida' ? ['auto', 'residencial', 'empresarial'] : ['empresarial'],
      acc, `DEMO-${code.toUpperCase().slice(0, 4)}`, acc === 'sim' ? 'aprovado' : 'em_analise', ownerId]);
    await db.query(`insert into integration_requirements (company_id, connection_id, code, label, why, provided_by, resolved_by, required, blocks, status)
       values ($1,$2,'credenciamento','Credenciamento comercial aprovado nesta empresa','Vínculo da corretora com a instituição.','seguradora','contato_comercial',true,'{cotacao}',$3)`,
    [companyId, c.id, acc === 'sim' ? 'confirmado' : 'aguardando_analise']);
    await db.query(`insert into integration_events (company_id, connection_id, kind, summary, user_name) values ($1,$2,'criada','Conexão de exemplo (demonstração)','Sistema')`, [companyId, c.id]);
    conn[code] = c.id;
  }

  // ---- produtos ----
  const autoCovs = [
    { code: 'casco', name: 'Casco (colisão, incêndio e roubo/furto)', basic: true, limit_cents: null, deductible: 'Conforme tabela FIPE e franquia escolhida' },
    { code: 'rcf_dm', name: 'RCF danos materiais', basic: false, limit_cents: 10000000 }, { code: 'rcf_dc', name: 'RCF danos corporais', basic: false, limit_cents: 10000000 },
    { code: 'assist_24h', name: 'Assistência 24h', basic: false, limit_cents: null },
  ];
  const prodPorto = await one(`insert into products (company_id, institution_id, branch, name, version, status, coverages, source, validated_by, validated_at)
     values ($1,$2,'auto','Auto (exemplo)','1','validado',$3,'Exemplo da demonstração — validar com a seguradora',$4, now()) returning id`, [companyId, inst.porto, JSON.stringify(autoCovs), ownerId]);
  await db.query(`insert into products (company_id, institution_id, branch, name, version, status, coverages, source) values ($1,$2,'auto','Auto (exemplo)','1','validado',$3,'Exemplo da demonstração')`,
    [companyId, inst.tokio_marine, JSON.stringify(autoCovs)]);

  // ---- regra de comissão e repasse ----
  const agr = await one(`insert into commission_agreements (company_id, institution_id, name, branch) values ($1,$2,'Porto — Auto (exemplo)','auto') returning id`, [companyId, inst.porto]);
  const rule = await one(`insert into commission_rule_versions (company_id, agreement_id, version, kind, rate, base_definition, base_notes, schedule, installments, right_event, valid_from, approved_by, created_by)
     values ($1,$2,1,'percentual',20,'premio_liquido','Base comissionável acordada (exemplo)','parcelada',6,'pagamento do segurado',$3,$4,$4) returning *`, [companyId, agr.id, addMonths(ref, -24), ownerId]);
  const partner = await one(`insert into partners (company_id, kind, name, email, user_id, bank_info, bank_info_changed_at) values ($1,'produtor','Carla Mendes (produtora)',$2,$3,$4, now()) returning id`,
    [companyId, 'carla@exemplo.com', broker.id, { holder: 'Carla Mendes', holder_document: '00000000000', bank: 'Banco Exemplo', agency: '0001', account: '12345-6' }]);
  const srule = await one(`insert into split_rule_versions (company_id, partner_id, name, version, kind, rate, base, stage, approved_by, created_by)
     values ($1,$2,'Produção própria',1,'percentual',30,'recebimento_efetivo',1,$3,$3) returning *`, [companyId, partner.id, ownerId]);
  const bank = await one(`insert into bank_accounts (company_id, name, bank, agency, account, opening_balance_cents, opening_date) values ($1,'Conta movimento (exemplo)','Banco Exemplo','0001','99999-0',500000,$2) returning id`, [companyId, addMonths(ref, -12)]);

  // ---- apólices ----
  async function policy({ client, insurer, number, start, months = 12, total, net, state = 'vigente', doc = 'conferido', items = [], installments = 6, paidUpTo = 0, informed = false, commission = true, split = false }) {
    const end = addMonths(start, months);
    const p = await one(`insert into policies (company_id, client_id, insured_client_id, payer_client_id, institution_id, product_id, product_name, branch, policy_number, start_date, end_date,
        contract_state, doc_state, total_premium_cents, premium_net_cents, taxes_cents, coverages, source, owner_user_id, verified_at, created_by)
      values ($1,$2,$2,$2,$3,$4,'Auto (exemplo)','auto',$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',(select owner_user_id from clients where id = $2),$14,$15) returning *`,
    [companyId, client.id, inst[insurer], insurer === 'porto' ? prodPorto.id : null, number, start, end, state, doc, total, net, total - net, JSON.stringify(autoCovs.map(({ basic: _b, deductible: _d, ...c }) => ({ ...c, deductible_cents: c.code === 'casco' ? 350000 : null }))),
      doc === 'conferido' ? new Date() : null, ownerId]);
    await db.query(`insert into policy_versions (company_id, policy_id, version, snapshot, reason, created_by_name) values ($1,$2,1,$3,'Cadastro da demonstração','Sistema')`, [companyId, p.id, p]);
    for (const it of items) await db.query('insert into policy_items (company_id, policy_id, kind, description, identifier) values ($1,$2,$3,$4,$5)', [companyId, p.id, 'veiculo', it[0], it[1]]);
    const parts = splitEven(total, installments);
    const ids = [];
    for (let i = 0; i < installments; i += 1) {
      const due = addMonths(start, i);
      const x = await one(`insert into premium_installments (company_id, policy_id, number, total_count, due_date, amount_cents, method, source, payer_client_id, last_update_at)
         values ($1,$2,$3,$4,$5,$6,'boleto','manual',$7, now() - interval '20 hours') returning id`, [companyId, p.id, i + 1, installments, due, parts[i], client.id]);
      ids.push(x.id);
      if (i < paidUpTo) await db.query(`insert into premium_payments (company_id, installment_id, kind, amount_cents, paid_date, source, evidence, created_by) values ($1,$2,'confirmado',$3,$4,'seguradora_portal','Consulta ao portal da seguradora (exemplo)',$5)`, [companyId, x.id, parts[i], due, ownerId]);
    }
    if (informed) await db.query(`insert into premium_payments (company_id, installment_id, kind, amount_cents, paid_date, source, evidence) values ($1,$2,'informado',$3,$4,'cliente','Comprovante enviado pelo cliente (exemplo)')`, [companyId, ids[paidUpTo], parts[paidUpTo], ref]);
    let recs = [];
    if (commission) {
      const snapshot = { rule_version_id: rule.id, agreement: 'Porto — Auto (exemplo)', version: 1, kind: 'percentual', rate: 20, base_definition: 'premio_liquido', schedule: 'parcelada', installments: 6, base_cents: net };
      for (const x of commissionSchedule({ rule, baseCents: net, startDate: start })) {
        const r = await one(`insert into commission_receivables (company_id, policy_id, installment_no, installments_total, rule_snapshot, base_cents, rate, category, expected_cents, due_date)
           values ($1,$2,$3,$4,$5,$6,20,'prevista',$7,$8) returning *`, [companyId, p.id, x.installment_no, x.installments_total, snapshot, net, x.expected_cents, x.due_date]);
        recs.push(r);
      }
      await db.query('update policies set commission_rule_version_id = $2, commission_snapshot = $3 where id = $1', [p.id, rule.id, snapshot]);
    }
    let ps = null;
    if (split) {
      ps = await one(`insert into policy_splits (company_id, policy_id, partner_id, rule_version_id, snapshot, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [companyId, p.id, partner.id, srule.id, { name: srule.name, version: 1, kind: 'percentual', rate: 30, base: 'recebimento_efetivo', stage: 1, sequential: false, release: 'no_recebimento', reversal: 'proporcional' }, ownerId]);
    }
    return { p, recs, ps };
  }

  const a = await policy({ client: clients[0], insurer: 'porto', number: 'DEMO-AUTO-1001', start: addMonths(ref, -11), total: 360000, net: 300000, items: [['Hatch 1.0 (exemplo)', 'DEM1A23']], paidUpTo: 6, split: true });
  await policy({ client: clients[1], insurer: 'tokio_marine', number: 'DEMO-AUTO-1002', start: addMonths(ref, -9), total: 240000, net: 210000, items: [['Sedan (exemplo)', 'DEM2B34']], paidUpTo: 4, informed: true, commission: false });
  await policy({ client: clients[3], insurer: 'porto', number: 'DEMO-AUTO-1003', start: addMonths(ref, -2), total: 180000, net: 150000, doc: 'recebido', items: [['SUV (exemplo)', 'DEM3C45']], paidUpTo: 1 });
  await policy({ client: clients[4], insurer: 'porto', number: 'DEMO-AUTO-0999', start: addMonths(ref, -14), total: 200000, net: 170000, state: 'vencida', items: [['Picape (exemplo)', 'DEM4D56']], paidUpTo: 6, commission: false });

  // liquidação de 3 parcelas de comissão da apólice A (exemplo 16.1: comissão 600, 3 × 100 liquidadas, repasse 30%)
  const gross = a.recs.slice(0, 3).reduce((s, r) => s + r.expected_cents, 0);
  const st = await one(`insert into commission_settlements (company_id, number, institution_id, settled_date, gross_cents, retention_cents, deductions_cents, net_cents, source, reference, created_by)
     values ($1,1,$2,$3,$4,0,0,$4,'manual','Extrato de comissão (exemplo)',$5) returning *`, [companyId, inst.porto, addDays(ref, -20), gross, ownerId]);
  await db.query(`insert into counters (company_id, kind, value) values ($1,'settlement',1)`, [companyId]);
  for (const r of a.recs.slice(0, 3)) {
    await db.query('update commission_receivables set confirmed_cents = expected_cents, confirmed_at = now(), confirmation_source = $2 where id = $1', [r.id, 'Extrato da seguradora (exemplo)']);
    const al = await one('insert into commission_allocations (company_id, settlement_id, receivable_id, amount_cents) values ($1,$2,$3,$4) returning id', [companyId, st.id, r.id, r.expected_cents]);
    await db.query(`insert into split_accruals (company_id, policy_split_id, partner_id, policy_id, receivable_id, allocation_id, base_cents, amount_cents, kind, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'liberacao','Liberado pelo recebimento (exemplo)')`, [companyId, a.ps.id, partner.id, a.p.id, r.id, al.id, r.expected_cents, applyRate(r.expected_cents, 30)]);
  }
  await db.query(`insert into cash_entries (company_id, kind, category, description, amount_cents, competence, due_date, paid_date, status, source, source_id, created_by)
     values ($1,'receber','Comissões','Liquidação de comissão nº 1 (exemplo)',$2,$3,$3,$3,'pago','comissao',$4,$5)`, [companyId, gross, addDays(ref, -20), st.id, ownerId]);
  await db.query(`insert into bank_transactions (company_id, account_id, tx_date, amount_cents, description, fingerprint) values ($1,$2,$3,$4,'TED SEGURADORA EXEMPLO COMISSOES','demo-1')`, [companyId, bank.id, addDays(ref, -19), gross]);
  await db.query(`insert into cash_entries (company_id, kind, category, description, amount_cents, competence, due_date, created_by) values ($1,'pagar','Sistemas e software','Assinatura de sistemas (exemplo)',19900,$2,$2,$3)`, [companyId, addDays(ref, 5), ownerId]);

  // ---- oportunidade e cotação assistida em andamento ----
  const opp = await one(`insert into opportunities (company_id, number, client_id, branch, title, need, stage, estimated_premium_cents, origin, owner_user_id, next_action, next_action_at, created_by)
     values ($1,1,$2,'auto','Seguro auto — carro novo','Cobertura completa com carro reserva','cotacao',250000,'indicação',$3,'Registrar respostas das seguradoras', now() + interval '1 day',$3) returning id`, [companyId, clients[0].id, ownerId]);
  await db.query(`insert into opportunities (company_id, number, client_id, branch, title, stage, origin, owner_user_id, created_by) values ($1,2,$2,'empresarial','Seguro empresarial da padaria','qualificacao','site',$3,$3),
     ($1,3,$4,'frota','Frota de 4 caminhões','coleta_dados','carteira',$5,$3)`, [companyId, clients[2].id, ownerId, clients[5].id, broker.id]);
  await db.query(`insert into counters (company_id, kind, value) values ($1,'opportunity',3), ($1,'quote',1)`, [companyId]);
  const qr = await one(`insert into quote_requests (company_id, number, client_id, opportunity_id, branch, status, title, created_by) values ($1,1,$2,$3,'auto','parcial','Auto — carro novo',$4) returning id`,
    [companyId, clients[0].id, opp.id, ownerId]);
  const minCov = [{ code: 'casco', name: 'Casco (colisão, incêndio e roubo/furto)', min_limit_cents: null, required: true }, { code: 'rcf_dm', name: 'RCF danos materiais', min_limit_cents: 10000000, required: true },
    { code: 'carro_reserva', name: 'Carro reserva', min_limit_cents: null, required: false }];
  const risk = { placa: null, marca_modelo: 'Hatch 1.0 (exemplo)', ano_modelo: 2025, chassi: null, uso: 'particular', cep_pernoite: '13010-000', cep_circulacao: null, condutor_principal: 'Ana Beatriz Oliveira', idade_condutor: 34, condutores_18_25: false, classe_bonus: 5, sinistros_12m: 0, garagem: 'ambos' };
  const scoring = { coverage: 45, cost: 30, deductible: 15, assistance: 10 };
  const round = await one(`insert into quote_rounds (company_id, request_id, round_no, risk_schema_version, risk_data, min_coverages, preferences, start_date, end_date, scoring, status, data_hash, created_by)
     values ($1,$2,1,'auto-1',$3,$4,$5,$6,$7,$8,'parcial',$9,$10) returning *`,
  [companyId, qr.id, risk, JSON.stringify(minCov), { sharing_basis: 'Autorização do cliente (exemplo)' }, addDays(ref, 10), addMonths(addDays(ref, 10), 12), scoring, hashOf(risk), ownerId]);
  const tasks = {};
  for (const code of ['porto', 'tokio_marine']) {
    tasks[code] = await one(`insert into quote_tasks (company_id, round_id, institution_id, connection_id, scenario, mode, status, assignee_user_id) values ($1,$2,$3,$4,'minima','assistida','pendente_assistida',$5) returning id`,
      [companyId, round.id, inst[code], conn[code], ownerId]);
  }
  await db.query(`insert into quote_offers (company_id, round_id, task_id, institution_id, connection_id, product_name, scenario, origin, quote_kind, external_id, valid_until, total_premium_cents,
      fields_definition, coverages, assistances, payment_options, commission_source, notes, created_by)
    values ($1,$2,$3,$4,$5,'Auto (exemplo)','minima','informada_pela_seguradora','valor_indicativo','EXEMPLO-001',$6,248000,'Exemplo da demonstração: valor indicativo, não é cotação real',$7,$8,$9,'nao_informada','Dado fictício da demonstração',$10)`,
  [companyId, round.id, tasks.porto.id, inst.porto, conn.porto, addDays(ref, 6),
    JSON.stringify([{ code: 'casco', name: 'Casco', limit_cents: null, deductible_cents: 350000, deductible_text: 'Franquia normal' }, { code: 'rcf_dm', name: 'RCF danos materiais', limit_cents: 10000000 }, { code: 'carro_reserva', name: 'Carro reserva', limit_cents: null, deductible_text: '7 dias' }]),
    JSON.stringify([{ name: 'Guincho 24h' }]), JSON.stringify([{ id: 'op1', method: 'boleto', installments: 1, total_cents: 248000 }, { id: 'op2', method: 'cartao', installments: 4, installment_cents: 62000, first_cents: 62000, total_cents: 248000 }]), ownerId]);
  await db.query(`update quote_tasks set status = 'valor_indicativo', finished_at = now() where id = $1`, [tasks.porto.id]);

  // ---- pós-venda e tarefas ----
  await db.query(`insert into claims (company_id, number, policy_id, client_id, occurred_at, description, work_status, insurer_protocol, insurer_status, deadline_at, deadline_rule, assignee_user_id, created_by)
     values ($1,1,$2,$3,now() - interval '5 days','Colisão traseira em estacionamento (exemplo)','documentacao','PROTO-EXEMPLO-77','Aguardando documentos (informado)',now() + interval '2 days','Prazo interno de acompanhamento (exemplo)',$4,$4)`,
  [companyId, a.p.id, clients[0].id, ownerId]);
  await db.query(`insert into counters (company_id, kind, value) values ($1,'claim',1), ($1,'request',1)`, [companyId]);
  await db.query(`insert into service_requests (company_id, number, client_id, policy_id, kind, description, created_by, assignee_user_id) values ($1,1,$2,$3,'segunda_via','Cliente pediu 2ª via do boleto (exemplo)',$4,$4)`,
    [companyId, clients[1].id, null, ownerId]);
  await db.query(`insert into tasks (company_id, title, kind, priority, due_at, assignee_user_id, client_id, created_by) values
     ($1,'Ligar para Ana sobre o comparativo','cotacao','alta',now() + interval '3 hours',$2,$3,$2),
     ($1,'Conferir documento da apólice DEMO-AUTO-1003','documento','normal',now() + interval '1 day',$2,$4,$2)`, [companyId, ownerId, clients[0].id, clients[3].id]);
  await db.query(`insert into activities (company_id, client_id, kind, summary, created_by_name) values ($1,$2,'ligacao','Cliente quer renovar com carro reserva (exemplo)','Sistema')`, [companyId, clients[0].id]);
}
