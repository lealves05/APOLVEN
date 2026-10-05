import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { HttpError } from './util.js';
import { requireAuth, mfaGate } from './auth.js';
import { platformGate } from './platform.js';
import { edgeProxyIp } from './edgeProxy.js';

import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import { platformApi, billing } from './routes/platform.js';
import companyRoutes from './routes/company.js';
import clientRoutes, { privacy } from './routes/clients.js';
import { opportunities, tasks } from './routes/crm.js';
import catalogRoutes from './routes/catalog.js';
import integrationRoutes from './routes/integrations.js';
import quoteRoutes, { comparisons } from './routes/quotes.js';
import proposalRoutes from './routes/proposals.js';
import policyRoutes, { renewals } from './routes/policies.js';
import installmentRoutes from './routes/installments.js';
import commissionRoutes from './routes/commissions.js';
import { partners, splitRoutes } from './routes/splits.js';
import financeRoutes from './routes/finance.js';
import { claims, serviceRequests } from './routes/claims.js';
import documentRoutes from './routes/documents.js';
import workspaceRoutes from './routes/workspace.js';
import reportRoutes, { exportAll } from './routes/reports.js';
import { need } from './auth.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(edgeProxyIp); // IP real quando o site (Cloudflare) encaminha /api
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(compression());

  // CORS: origens exatas. O site chama a API pela mesma origem (Worker /api), então em produção sem lista
  // nenhuma origem externa recebe permissão. localhost só fora de produção.
  const prod = process.env.NODE_ENV === 'production';
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, false);
      cb(null, origins.includes(origin) || (!prod && /^http:\/\/localhost(:\d+)?$/.test(origin)));
    },
  }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); });
  app.use((_req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); next(); });
  // corpo bruto para conferir a assinatura das chamadas da central da plataforma; documentos até ~8 MB (base64)
  app.use(express.json({ limit: '12mb', verify: (req, _res, buf) => { if (req.originalUrl?.includes('/api/platform/')) req.rawBody = buf; } }));

  app.get('/', (_req, res) => res.json({ name: 'APOLVEN API', status: 'ok' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/platform/v1', platformApi); // central da plataforma (chamadas assinadas)

  const api = express.Router();
  api.use(requireAuth);
  api.use(mfaGate);      // perfis críticos sem segundo fator só cadastram o MFA
  api.use(platformGate); // assinatura, bloqueio e módulos definidos pela central
  api.use('/billing', billing);
  api.use('/company', companyRoutes);
  api.use('/clients', clientRoutes);
  api.use('/privacy-requests', privacy);
  api.use('/opportunities', opportunities);
  api.use('/tasks', tasks);
  api.use('/catalog', catalogRoutes);
  api.use('/integrations', integrationRoutes);
  api.use('/quote-requests', quoteRoutes);
  api.use('/comparisons', comparisons);
  api.use('/proposals', proposalRoutes);
  api.use('/policies', policyRoutes);
  api.use('/renewals', renewals);
  api.use('/premium-installments', installmentRoutes);
  api.use('/commissions', commissionRoutes);
  api.use('/partners', partners);
  api.use('/splits', splitRoutes);
  api.use('/finance', financeRoutes);
  api.use('/claims', claims);
  api.use('/service-requests', serviceRequests);
  api.use('/documents', documentRoutes);
  api.use('/reports', reportRoutes);
  api.get('/export', need('data_export'), exportAll); // cópia completa (liberada mesmo com assinatura restrita)
  api.use('/', workspaceRoutes);
  app.use('/api/v1', api);

  app.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Erro interno';
    let code = err.extra?.code;
    if (err.code === '23505') { status = 409; message = 'Registro duplicado.'; code = 'DUPLICATE'; }
    else if (err.code === '23503') { status = 409; message = 'Registro vinculado a outros dados (ou de outra corretora).'; code = 'FK_VIOLATION'; }
    else if (err.code === '22P02') { status = 400; message = 'Identificador inválido.'; }
    else if (err.code === '23514') { status = 400; message = 'Valor fora das regras do cadastro.'; }
    else if (err.code === 'P0001') { status = 409; message = String(err.message).replace(/^.*?: /, '').slice(0, 300); code = 'PROTECTED_RECORD'; }
    else if (err.type === 'entity.too.large') { status = 413; message = 'Arquivo muito grande.'; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'Requisição inválida.'; }
    const correlation = Math.random().toString(36).slice(2, 10);
    if (status >= 500) console.error(`[${correlation}]`, err);
    const expected = err instanceof HttpError;
    // erro com código estável e correlação, sem segredo nem retorno bruto (29.2)
    res.status(status).json({ error: status >= 500 && !expected ? 'Erro interno no servidor.' : message, ...(err.extra || {}), ...(code ? { code } : {}), correlation_id: correlation });
  });

  return app;
}
