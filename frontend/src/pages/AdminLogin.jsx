import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import adminClient from '../api/adminClient';
import { getApiErrorMessage } from '../utils/apiError';
import ThemeToggle from '../components/ThemeToggle';
import { Shield, Eye, EyeOff, ArrowRight, Lock, Zap, CheckCircle } from 'lucide-react';

const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

export default function AdminLogin() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (localStorage.getItem('admin_token')) return <Navigate to="/admin/dashboard" replace />;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const { data } = await adminClient.post('/platform/login', { email, password });
            if (!data?.access_token) throw new Error('Missing admin access token.');
            localStorage.setItem('admin_token', data.access_token);
            navigate('/admin/dashboard', { replace: true });
        } catch (err) {
            setError(getApiErrorMessage(err, 'Unable to sign in with those admin credentials.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen text-text-primary">
            <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />
            <div className="pointer-events-none fixed inset-0 bg-dot-pattern opacity-30 z-0" />

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
                <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                    <Link to="/" className="inline-flex items-center gap-3 group">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-black glow-gold group-hover:scale-105 transition-transform">
                            <Shield size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold tracking-tight">MechTrack Admin</p>
                            <p className="text-[10px] text-text-muted font-mono uppercase tracking-widest">Platform Console</p>
                        </div>
                    </Link>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Link to="/login" className="hidden sm:inline-flex btn-ghost rounded-full px-4 py-2 text-xs font-medium">User Login</Link>
                        <Link to="/" className="hidden sm:inline-flex btn-gold rounded-full px-4 py-2 text-xs font-semibold">Home</Link>
                    </div>
                </motion.header>

                <div className="flex flex-1 items-center justify-center py-10">
                    <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                        <motion.section initial="hidden" animate="show" variants={stagger}
                            className="glass-strong rounded-3xl px-7 py-8 sm:px-9 sm:py-10">
                            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 rounded-full bg-gold/10 border border-gold/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gold">
                                <Lock size={10} /> Admin Access
                            </motion.div>
                            <motion.h1 variants={fadeUp} className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl leading-tight">
                                Approve companies from a{' '}<span className="gradient-text">clean console</span>.
                            </motion.h1>
                            <motion.p variants={fadeUp} className="mt-4 text-sm leading-7 text-text-secondary max-w-xl">
                                Review pending registrations, create owner access, and manage onboarding from a secure internal dashboard.
                            </motion.p>

                            <motion.div variants={stagger} className="mt-8 grid gap-3 sm:grid-cols-3">
                                {[
                                    { icon: Zap, title: 'Fast Approvals', desc: 'Single queue review' },
                                    { icon: Lock, title: 'Scoped Auth', desc: 'Separate token storage' },
                                    { icon: CheckCircle, title: 'Graceful Errors', desc: 'Recoverable failures' },
                                ].map((f) => (
                                    <motion.div key={f.title} variants={fadeUp} className="glass-card rounded-2xl p-4">
                                        <f.icon size={16} className="text-gold mb-2" />
                                        <p className="text-xs font-bold text-text-primary">{f.title}</p>
                                        <p className="mt-1 text-[11px] leading-5 text-text-secondary">{f.desc}</p>
                                    </motion.div>
                                ))}
                            </motion.div>
                        </motion.section>

                        <motion.section initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="glass-strong rounded-3xl p-7 sm:p-9">
                            <div className="mb-7">
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">MechTrack Admin</p>
                                <h2 className="mt-2 text-2xl font-bold tracking-tight">Sign in</h2>
                                <p className="mt-2 text-xs leading-5 text-text-secondary">Use your platform admin credentials.</p>
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
                                    <label htmlFor="admin-email" className="mb-1.5 block text-xs font-semibold text-text-primary">Email</label>
                                    <input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="admin@mechtrack.com" autoComplete="email" required />
                                </div>
                                <div>
                                    <label htmlFor="admin-password" className="mb-1.5 block text-xs font-semibold text-text-primary">Password</label>
                                    <div className="relative">
                                        <input id="admin-password" type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                                            className="input-glass w-full rounded-xl px-4 py-3 pr-10 text-sm" placeholder="Enter password" autoComplete="current-password" required />
                                        <button type="button" onClick={() => setShowPass(!showPass)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>

                                <motion.button type="submit" disabled={loading} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                                    className="btn-gold w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                                    {loading ? <div className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" /> :
                                        <>Admin Login <ArrowRight size={14} /></>}
                                </motion.button>
                            </form>

                            <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5 text-xs text-text-secondary">
                                <Link to="/login" className="font-medium text-accent hover:text-accent-glow transition-colors">Switch to user login</Link>
                                <Link to="/" className="hover:text-text-primary transition-colors">Back to home</Link>
                            </div>
                        </motion.section>
                    </div>
                </div>
            </div>
        </div>
    );
}
