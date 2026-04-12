import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/apiError';
import ThemeToggle from '../components/ThemeToggle';
import BrandLogo from '../components/BrandLogo';
import { CheckCircle, Building2, User, Mail, FileText, ArrowRight, Sparkles } from 'lucide-react';

const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

export default function RegisterPage() {
    const [formData, setFormData] = useState({ company_name: '', gst_number: '', owner_name: '', owner_email: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleChange = (e) => { setFormData((c) => ({ ...c, [e.target.name]: e.target.value })); setError(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await api.post('/companies/register', formData);
            setSuccess(true);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Registration failed. Please review details.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen text-text-primary">
            <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />
            <div className="pointer-events-none fixed inset-0 bg-dot-pattern opacity-30 z-0" />

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-12">
                <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                    <Link to="/" className="inline-flex items-center gap-3 group">
                        <BrandLogo size="sm" title="MechTrackPulse" subtitle="Company Onboarding" />
                    </Link>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Link to="/login" className="hidden sm:inline-flex btn-ghost rounded-full px-4 py-2 text-xs font-medium">Login</Link>
                        <Link to="/admin/login" className="hidden sm:inline-flex btn-gold rounded-full px-4 py-2 text-xs font-semibold">Admin</Link>
                    </div>
                </motion.header>

                <div className="flex flex-1 items-center justify-center py-10">
                    <div className="grid w-full max-w-5xl gap-7 lg:grid-cols-[0.95fr_1.05fr]">
                        <motion.section initial="hidden" animate="show" variants={stagger} className="glass-strong rounded-3xl p-7 sm:p-9">
                            <motion.p variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Company Registration</motion.p>
                            <motion.h1 variants={fadeUp} className="mt-4 text-3xl font-bold tracking-tight leading-tight">
                                Request access for your <span className="gradient-text">factory team</span>.
                            </motion.h1>
                            <motion.p variants={fadeUp} className="mt-4 text-sm leading-7 text-text-secondary">
                                Submit your company details once. Platform admins review and approve from the admin dashboard.
                            </motion.p>
                            <motion.div variants={stagger} className="mt-7 space-y-3">
                                <motion.div variants={fadeUp} className="glass-card rounded-2xl p-4 flex items-start gap-3">
                                    <Sparkles size={16} className="text-accent mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs font-bold text-text-primary">Instant Setup</p>
                                        <p className="mt-1 text-xs leading-5 text-text-secondary">One form, auto-generated credentials on approval.</p>
                                    </div>
                                </motion.div>
                                <motion.div variants={fadeUp} className="glass-card rounded-2xl p-4 flex items-start gap-3">
                                    <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs font-bold text-text-primary">Admin Reviewed</p>
                                        <p className="mt-1 text-xs leading-5 text-text-secondary">Registrations stay pending until manually approved.</p>
                                    </div>
                                </motion.div>
                            </motion.div>
                        </motion.section>

                        <motion.section
                            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="glass-strong rounded-3xl p-7 sm:p-9"
                        >
                            <AnimatePresence mode="wait">
                                {success ? (
                                    <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
                                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                                            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 border border-success/20 glow-success mb-5">
                                            <CheckCircle size={32} className="text-success" />
                                        </motion.div>
                                        <h3 className="text-2xl font-bold tracking-tight">Registration Submitted!</h3>
                                        <p className="mt-3 text-sm text-text-secondary max-w-xs mx-auto">Your company is now pending review. Once approved, your team can sign in.</p>
                                        <div className="mt-6 flex flex-col gap-3">
                                            <Link to="/login" className="btn-primary rounded-xl px-4 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2">
                                                Go to Login <ArrowRight size={14} />
                                            </Link>
                                            <Link to="/" className="text-xs text-text-secondary hover:text-text-primary transition-colors">Back to home</Link>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <motion.div key="form">
                                        <div className="mb-7">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Get Started</p>
                                            <h2 className="mt-2 text-2xl font-bold tracking-tight">Register your company</h2>
                                            <p className="mt-2 text-xs leading-5 text-text-secondary">We only need the essentials to create your pending record.</p>
                                        </div>

                                        {error && (
                                            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                                                className="mb-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                                                {error}
                                            </motion.div>
                                        )}

                                        <form onSubmit={handleSubmit} className="space-y-4">
                                            <div>
                                                <label htmlFor="company_name" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                                                    <Building2 size={12} className="text-text-muted" /> Company Name
                                                </label>
                                                <input id="company_name" name="company_name" type="text" value={formData.company_name} onChange={handleChange}
                                                    className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="Acme Manufacturing" required />
                                            </div>
                                            <div>
                                                <label htmlFor="gst_number" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                                                    <FileText size={12} className="text-text-muted" /> GST Number
                                                </label>
                                                <input id="gst_number" name="gst_number" type="text" value={formData.gst_number} onChange={handleChange}
                                                    className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="22AAAAA0000A1Z5" required />
                                            </div>
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div>
                                                    <label htmlFor="owner_name" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                                                        <User size={12} className="text-text-muted" /> Owner Name
                                                    </label>
                                                    <input id="owner_name" name="owner_name" type="text" value={formData.owner_name} onChange={handleChange}
                                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="Jane Doe" required />
                                                </div>
                                                <div>
                                                    <label htmlFor="owner_email" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                                                        <Mail size={12} className="text-text-muted" /> Owner Email
                                                    </label>
                                                    <input id="owner_email" name="owner_email" type="email" value={formData.owner_email} onChange={handleChange}
                                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="jane@acme.com" required />
                                                </div>
                                            </div>

                                            <motion.button type="submit" disabled={loading} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                                                className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                                                {loading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> :
                                                    <>Submit Registration <ArrowRight size={14} /></>}
                                            </motion.button>
                                        </form>

                                        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5 text-xs text-text-secondary">
                                            <Link to="/login" className="font-medium text-accent hover:text-accent-glow transition-colors">Already approved? Go to login</Link>
                                            <Link to="/" className="hover:text-text-primary transition-colors">Back to home</Link>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.section>
                    </div>
                </div>
            </div>
        </div>
    );
}
