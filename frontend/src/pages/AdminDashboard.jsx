import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import adminClient from '../api/adminClient';
import { getApiErrorMessage } from '../utils/apiError';
import ThemeToggle from '../components/ThemeToggle';
import { Shield, RefreshCw, LogOut, CheckCircle, AlertCircle, Copy, Building2, Mail, Phone, Calendar, X } from 'lucide-react';

function formatDate(value) {
    if (!value) return 'Recently submitted';
    try {
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
    } catch { return 'Recently submitted'; }
}

function createApprovalForms(companies) {
    return companies.reduce((forms, c) => {
        forms[c.id] = { owner_name: c.owner_name || '', owner_email: c.owner_email || '', owner_phone: c.owner_phone || '' };
        return forms;
    }, {});
}

const fadeUp = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } };
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

export default function AdminDashboard() {
    const navigate = useNavigate();
    const token = localStorage.getItem('admin_token');
    const [companies, setCompanies] = useState([]);
    const [approvalForms, setApprovalForms] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [approvingId, setApprovingId] = useState('');
    const [cardErrors, setCardErrors] = useState({});
    const [approvalNotice, setApprovalNotice] = useState(null);

    useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true); setError('');
            try {
                const { data } = await adminClient.get('/platform/companies', { params: { status: 'pending' } });
                if (!active) return;
                const safe = Array.isArray(data) ? data : [];
                setCompanies(safe);
                setApprovalForms(createApprovalForms(safe));
            } catch (e) { if (active) setError(getApiErrorMessage(e, 'Unable to load pending companies.')); }
            finally { if (active) setLoading(false); }
        };
        load();
        return () => { active = false; };
    }, []);

    if (!token) return <Navigate to="/admin/login" replace />;

    const pendingCount = companies.length;
    const subtitle = loading ? 'Loading...' : pendingCount === 0 ? 'No pending companies' : `${pendingCount} pending`;

    const updateForm = (id, field, value) => {
        setApprovalForms((c) => ({ ...c, [id]: { ...c[id], [field]: value } }));
        setCardErrors((c) => ({ ...c, [id]: '' }));
    };

    const reloadCompanies = async () => {
        setLoading(true); setError('');
        try {
            const { data } = await adminClient.get('/platform/companies', { params: { status: 'pending' } });
            const safe = Array.isArray(data) ? data : [];
            setCompanies(safe);
            setApprovalForms(createApprovalForms(safe));
        } catch (e) { setError(getApiErrorMessage(e, 'Refresh failed.')); }
        finally { setLoading(false); }
    };

    const handleApprove = async (company) => {
        const form = approvalForms[company.id] || {};
        const payload = { owner_name: form.owner_name?.trim() || '', owner_email: form.owner_email?.trim() || '', owner_phone: form.owner_phone?.trim() || '' };
        if (payload.owner_name.length < 2) { setCardErrors((c) => ({ ...c, [company.id]: 'Owner name is required.' })); return; }
        if (!payload.owner_email) { setCardErrors((c) => ({ ...c, [company.id]: 'Owner email is required.' })); return; }
        setApprovingId(company.id);
        setCardErrors((c) => ({ ...c, [company.id]: '' }));
        try {
            const { data } = await adminClient.patch(`/platform/companies/${company.id}/approve`, payload);
            setCompanies((c) => c.filter((i) => i.id !== company.id));
            setApprovalForms((c) => { const n = { ...c }; delete n[company.id]; return n; });
            setApprovalNotice({
                companyName: company.name, ownerEmail: data.owner_email || payload.owner_email,
                emailSent: Boolean(data.email_sent), tempPassword: data.temp_password || '',
                note: data.note || '', emailError: data.email_error || '',
            });
            setToast(data.email_sent ? `${company.name} approved!` : `${company.name} approved. See temp password.`);
        } catch (e) { setCardErrors((c) => ({ ...c, [company.id]: getApiErrorMessage(e, 'Approval failed.') })); }
        finally { setApprovingId(''); }
    };

    const handleLogout = () => { localStorage.removeItem('admin_token'); navigate('/admin/login', { replace: true }); };

    return (
        <div className="min-h-screen text-text-primary">
            <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />

            <AnimatePresence>
                {toast && (
                    <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
                        className="fixed right-5 top-5 z-50 glass-strong rounded-xl px-4 py-3 text-xs font-semibold text-success flex items-center gap-2 glow-success">
                        <CheckCircle size={14} /> {toast}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
                <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
                    className="glass-strong rounded-2xl p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-black glow-gold">
                            <Shield size={18} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Platform Console</p>
                            <h1 className="text-xl font-bold tracking-tight">Admin Dashboard</h1>
                            <p className="text-[10px] text-text-muted mt-0.5">{subtitle}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <ThemeToggle />
                        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={reloadCompanies}
                            className="btn-gold rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5">
                            <RefreshCw size={12} /> Refresh
                        </motion.button>
                        <Link to="/login" className="btn-ghost rounded-full px-4 py-2 text-xs font-medium">User Login</Link>
                        <button onClick={handleLogout} className="btn-ghost rounded-full px-4 py-2 text-xs font-medium inline-flex items-center gap-1.5">
                            <LogOut size={12} /> Logout
                        </button>
                    </div>
                </motion.header>

                {approvalNotice && (
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                        className="mt-6 glass-strong rounded-2xl p-5 border border-success/20 glow-success">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-success">Owner Access Ready</p>
                                <h2 className="mt-1 text-xl font-bold tracking-tight">{approvalNotice.companyName} approved</h2>
                                <p className="mt-2 text-xs text-text-secondary">Owner: <span className="font-semibold text-text-primary">{approvalNotice.ownerEmail}</span></p>
                                <p className="mt-1 text-xs text-text-secondary">
                                    {approvalNotice.emailSent ? 'Temp password emailed. Owner must change on first login.' : 'Email failed. Share the temp password below.'}
                                </p>
                            </div>
                            <button onClick={() => setApprovalNotice(null)} className="btn-ghost rounded-full p-2"><X size={14} /></button>
                        </div>
                        {!approvalNotice.emailSent && (
                            <div className="mt-4 rounded-xl bg-gold/10 border border-gold/20 p-4">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Temporary Password</p>
                                <div className="mt-2 flex items-center gap-2">
                                    <p className="font-mono text-lg font-bold text-text-primary">{approvalNotice.tempPassword}</p>
                                    <button onClick={() => navigator.clipboard?.writeText(approvalNotice.tempPassword)}
                                        className="text-text-muted hover:text-accent transition-colors"><Copy size={14} /></button>
                                </div>
                                {approvalNotice.emailError && <p className="mt-2 text-xs text-danger">{approvalNotice.emailError}</p>}
                            </div>
                        )}
                    </motion.div>
                )}

                {error && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 glass-strong rounded-2xl p-5 border border-danger/20">
                        <p className="text-xs text-danger flex items-center gap-2"><AlertCircle size={14} /> {error}</p>
                        <button onClick={reloadCompanies} className="mt-3 btn-primary rounded-full px-4 py-2 text-xs font-semibold">Retry</button>
                    </motion.div>
                )}

                {loading && (
                    <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="glass-card rounded-2xl p-5">
                                <div className="h-3 w-24 animate-shimmer rounded-full" />
                                <div className="mt-4 h-6 w-3/4 animate-shimmer rounded-full" />
                                <div className="mt-6 space-y-3">
                                    <div className="h-10 animate-shimmer rounded-xl" />
                                    <div className="h-10 animate-shimmer rounded-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && !error && companies.length === 0 && (
                    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                        className="mt-6 glass-strong rounded-2xl px-8 py-14 text-center">
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 border border-success/20 mb-4">
                            <CheckCircle size={24} className="text-success" />
                        </motion.div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">All Clear</p>
                        <h2 className="mt-2 text-2xl font-bold tracking-tight">No pending companies</h2>
                        <p className="mt-2 text-sm text-text-secondary">New registrations will appear here.</p>
                    </motion.div>
                )}

                {!loading && companies.length > 0 && (
                    <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {companies.map((company) => {
                            const form = approvalForms[company.id] || {};
                            const cardError = cardErrors[company.id];
                            const isApproving = approvingId === company.id;
                            return (
                                <motion.article key={company.id} variants={fadeUp} className="glass-card rounded-2xl p-5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-accent">Pending</p>
                                            <h2 className="mt-1 text-lg font-bold tracking-tight">{company.name}</h2>
                                        </div>
                                        <span className="rounded-full bg-gold/10 border border-gold/20 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-gold">
                                            Pending
                                        </span>
                                    </div>
                                    <dl className="mt-4 space-y-2 text-xs">
                                        <div className="flex items-center gap-2 text-text-secondary">
                                            <Building2 size={12} /> <span>{company.gst_number || 'No GST'}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-text-secondary">
                                            <Calendar size={12} /> <span>{formatDate(company.created_at)}</span>
                                        </div>
                                    </dl>
                                    <div className="mt-4 space-y-3 border-t border-border pt-4">
                                        <div>
                                            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                                <span>Owner Name</span>
                                            </label>
                                            <input type="text" value={form.owner_name || ''} onChange={(e) => updateForm(company.id, 'owner_name', e.target.value)}
                                                className="input-glass w-full rounded-lg px-3 py-2.5 text-xs" placeholder="Full name" required />
                                        </div>
                                        <div>
                                            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                                <Mail size={10} /> Email
                                            </label>
                                            <input type="email" value={form.owner_email || ''} onChange={(e) => updateForm(company.id, 'owner_email', e.target.value)}
                                                className="input-glass w-full rounded-lg px-3 py-2.5 text-xs" placeholder="owner@company.com" required />
                                        </div>
                                        <div>
                                            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                                <Phone size={10} /> Phone
                                            </label>
                                            <input type="tel" value={form.owner_phone || ''} onChange={(e) => updateForm(company.id, 'owner_phone', e.target.value)}
                                                className="input-glass w-full rounded-lg px-3 py-2.5 text-xs" placeholder="Optional" />
                                        </div>
                                    </div>
                                    {cardError && (
                                        <div className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[11px] text-danger">{cardError}</div>
                                    )}
                                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                        onClick={() => handleApprove(company)} disabled={isApproving}
                                        className="mt-4 btn-primary w-full rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed">
                                        {isApproving ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> :
                                            <><CheckCircle size={13} /> Approve</>}
                                    </motion.button>
                                </motion.article>
                            );
                        })}
                    </motion.div>
                )}
            </div>
        </div>
    );
}
