import { Navigate, Route, Routes, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { BlockedScreen } from './components/Billing';
import { Login, Register, ForgotPassword, ResetPassword } from './pages/Auth';
import Account, { MfaRequiredScreen } from './pages/Account';
import Subscription from './pages/Subscription';
import Dashboard from './pages/Dashboard';
import Agenda from './pages/Agenda';
import Opportunities from './pages/Opportunities';
import Clients, { ClientDetail } from './pages/Clients';
import Quotes, { QuoteNew, QuoteDetail, ComparisonDetail } from './pages/Quotes';
import Proposals, { ProposalDetail } from './pages/Proposals';
import Policies, { PolicyNew, PolicyDetail } from './pages/Policies';
import Renewals from './pages/Renewals';
import Installments from './pages/Installments';
import Claims, { ClaimDetail } from './pages/Claims';
import Commissions from './pages/Commissions';
import Splits from './pages/Splits';
import Finance from './pages/Finance';
import Integrations, { ConnectionDetail } from './pages/Integrations';
import Products from './pages/Products';
import Documents from './pages/Documents';
import Communication from './pages/Communication';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Audit from './pages/Audit';
import Privacy from './pages/Privacy';
import Support from './pages/Support';
import { PrintComparison } from './pages/Print';
import { PublicComparison, PublicInstallments, PublicDocument } from './pages/Public';

function BlockedSubscription() {
  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto max-w-[1100px] p-4 sm:p-6">
        <Link to="/" className="btn-ghost mb-3"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
        <Subscription />
      </div>
    </div>
  );
}

function Guard({ perms, children }) {
  const { can } = useAuth();
  return !perms || can(...perms) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading, access, mfa_setup_required: mfaSetup } = useAuth();
  const admin = ['owner', 'admin'].includes(user?.role);
  return (
    <Routes>
      <Route path="/p/comparativo/:token" element={<PublicComparison />} />
      <Route path="/p/parcelas/:token" element={<PublicInstallments />} />
      <Route path="/p/documento/:token" element={<PublicDocument />} />
      <Route path="/esqueci-senha" element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      {loading ? (
        <Route path="*" element={<Loading />} />
      ) : !user ? (
        <>
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="*" element={<Navigate to="/entrar" replace />} />
        </>
      ) : mfaSetup ? (
        <Route path="*" element={<MfaRequiredScreen />} />
      ) : access?.blocked ? (
        <>
          {admin && <Route path="/assinatura" element={<BlockedSubscription />} />}
          <Route path="*" element={<BlockedScreen />} />
        </>
      ) : (
        <>
          <Route path="/imprimir/comparativo/:id" element={<Guard perms={['quotes_view']}><PrintComparison /></Guard>} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="oportunidades" element={<Guard perms={['opportunities']}><Opportunities /></Guard>} />
            <Route path="clientes" element={<Guard perms={['clients_view']}><Clients /></Guard>} />
            <Route path="clientes/:id" element={<Guard perms={['clients_view']}><ClientDetail /></Guard>} />
            <Route path="cotacoes" element={<Guard perms={['quotes_view']}><Quotes /></Guard>} />
            <Route path="cotacoes/nova" element={<Guard perms={['quotes_manage']}><QuoteNew /></Guard>} />
            <Route path="cotacoes/:id" element={<Guard perms={['quotes_view']}><QuoteDetail /></Guard>} />
            <Route path="comparativos/:id" element={<Guard perms={['quotes_view']}><ComparisonDetail /></Guard>} />
            <Route path="propostas" element={<Guard perms={['quotes_view']}><Proposals /></Guard>} />
            <Route path="propostas/:id" element={<Guard perms={['quotes_view']}><ProposalDetail /></Guard>} />
            <Route path="apolices" element={<Guard perms={['policies_view']}><Policies /></Guard>} />
            <Route path="apolices/nova" element={<Guard perms={['policies_manage']}><PolicyNew /></Guard>} />
            <Route path="apolices/:id" element={<Guard perms={['policies_view']}><PolicyDetail /></Guard>} />
            <Route path="renovacoes" element={<Guard perms={['renewals']}><Renewals /></Guard>} />
            <Route path="parcelas" element={<Guard perms={['installments']}><Installments /></Guard>} />
            <Route path="sinistros" element={<Guard perms={['claims', 'service_requests']}><Claims /></Guard>} />
            <Route path="sinistros/:id" element={<Guard perms={['claims']}><ClaimDetail /></Guard>} />
            <Route path="comissoes" element={<Guard perms={['commissions_view']}><Commissions /></Guard>} />
            <Route path="repasses" element={<Guard perms={['splits_view']}><Splits /></Guard>} />
            <Route path="financeiro" element={<Guard perms={['finance']}><Finance /></Guard>} />
            <Route path="integracoes" element={<Guard perms={['integrations_view']}><Integrations /></Guard>} />
            <Route path="integracoes/:id" element={<Guard perms={['integrations_view']}><ConnectionDetail /></Guard>} />
            <Route path="produtos" element={<Products />} />
            <Route path="documentos" element={<Documents />} />
            <Route path="comunicacao" element={<Communication />} />
            <Route path="relatorios" element={<Guard perms={['reports']}><Reports /></Guard>} />
            <Route path="configuracoes" element={<Guard perms={['settings', 'users', 'units_manage']}><Settings /></Guard>} />
            <Route path="auditoria" element={<Guard perms={['audit_view']}><Audit /></Guard>} />
            <Route path="privacidade" element={<Guard perms={['privacy']}><Privacy /></Guard>} />
            <Route path="conta" element={<Account />} />
            <Route path="suporte" element={<Support />} />
            {access && admin && <Route path="assinatura" element={<Subscription />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </>
      )}
    </Routes>
  );
}
