import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import useAuthStore from '../stores/authStore';
import ThemeToggle from '../components/ThemeToggle';
import BrandLogo from '../components/BrandLogo';
import { Lock, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react';

const fadeUp = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } } };
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

export default function ChangePasswordPage() {
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const changePassword = useAuthStore((s) => s.changePassword);
    const loading = useAuthStore((s) => s.loading);
    const error = useAuthStore((s) => s.error);
    const [formData, setFormData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [localError, setLocalError] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);

    const handleChange = (e) => { setFormData((c) => ({ ...c, [e.target.name]: e.target.value })); setLocalError(''); };

    const strength = (() => {
        const p = formData.newPassword;
        if (!p) return 0;
        let s = 0;
        if (p.length >= 8) s++;
        if (/[A-Z]/.test(p)) s++;
        if (/[0-9]/.test(p)) s++;
        if (/[^A-Za-z0-9]/.test(p)) s++;
        return s;
    })();

    const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const strengthColors = ['', 'bg-danger', 'bg-warning', 'bg-accent', 'bg-success'];

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (formData.newPassword !== formData.confirmPassword) { setLocalError('Passwords must match.'); return; }
        try { await changePassword(formData.currentPassword, formData.newPassword); navigate('/dashboard', { replace: true }); }
        catch { /* Store error rendered */ }
    };

    return (
        <div className="min-h-screen text-text-primary">
            <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />
            <div className="pointer-events-none fixed inset-0 bg-dot-pattern opacity-30 z-0" />

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8 lg:px-12">
                <motion.header initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                    <Link to="/" className="inline-flex items-center gap-3 group">
                        <BrandLogo size="sm" title="MechTrackPulse" subtitle="Password Update" />
                    </Link>
                    <ThemeToggle />
                </motion.header>

                <div className="flex flex-1 items-center justify-center py-10">
                    <div className="grid w-full max-w-4xl gap-7 lg:grid-cols-[0.95fr_1.05fr]">
                        <motion.section initial="hidden" animate="show" variants={stagger} className="glass-strong rounded-3xl p-7 sm:p-9">
                            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 rounded-full bg-gold/10 border border-gold/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gold">
                                <Lock size={10} /> Security Checkpoint
                            </motion.div>
                            <motion.h1 variants={fadeUp} className="mt-4 text-3xl font-bold tracking-tight leading-tight">
                                Set a <span className="gradient-text">permanent password</span>.
                            </motion.h1>
                            <motion.p variants={fadeUp} className="mt-4 text-sm leading-7 text-text-secondary">
                                {user?.full_name ? `${user.full_name}, replace` : 'Replace'} your temporary password before accessing the dashboard.
                            </motion.p>
                            <motion.div variants={fadeUp} className="mt-7 glass-card rounded-2xl p-4 flex items-start gap-3">
                                <ShieldCheck size={16} className="text-success mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-bold text-text-primary">Password Guidance</p>
                                    <p className="mt-1 text-xs leading-5 text-text-secondary">Use a strong password with uppercase, numbers, and special characters.</p>
                                </div>
                            </motion.div>
                        </motion.section>

                        <motion.section initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.1 }} className="glass-strong rounded-3xl p-7 sm:p-9">
                            <div className="mb-7">
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Required Action</p>
                                <h2 className="mt-2 text-2xl font-bold tracking-tight">Change password</h2>
                                <p className="mt-2 text-xs leading-5 text-text-secondary">Finish this step to unlock full access.</p>
                            </div>

                            {(error || localError) && (
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                                    className="mb-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                                    {localError || error}
                                </motion.div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label htmlFor="currentPassword" className="mb-1.5 block text-xs font-semibold">Current password</label>
                                    <div className="relative">
                                        <input id="currentPassword" name="currentPassword" type={showCurrent ? 'text' : 'password'}
                                            value={formData.currentPassword} onChange={handleChange}
                                            className="input-glass w-full rounded-xl px-4 py-3 pr-10 text-sm" placeholder="Temporary password" required />
                                        <button type="button" onClick={() => setShowCurrent(!showCurrent)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                                            {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="newPassword" className="mb-1.5 block text-xs font-semibold">New password</label>
                                    <div className="relative">
                                        <input id="newPassword" name="newPassword" type={showNew ? 'text' : 'password'}
                                            value={formData.newPassword} onChange={handleChange}
                                            className="input-glass w-full rounded-xl px-4 py-3 pr-10 text-sm" placeholder="Create a strong password" required />
                                        <button type="button" onClick={() => setShowNew(!showNew)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                                            {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    {formData.newPassword && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <div className="flex-1 flex gap-1">
                                                {[1, 2, 3, 4].map((level) => (
                                                    <div key={level}
                                                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${strength >= level ? strengthColors[strength] : 'bg-border'}`} />
                                                ))}
                                            </div>
                                            <span className={`text-[10px] font-bold ${strengthColors[strength]?.replace('bg-', 'text-')}`}>
                                                {strengthLabels[strength]}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label htmlFor="confirmPassword" className="mb-1.5 block text-xs font-semibold">Confirm new password</label>
                                    <input id="confirmPassword" name="confirmPassword" type="password"
                                        value={formData.confirmPassword} onChange={handleChange}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="Repeat new password" required />
                                </div>

                                <motion.button type="submit" disabled={loading} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                                    className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                                    {loading ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> :
                                        <>Update Password <ArrowRight size={14} /></>}
                                </motion.button>
                            </form>
                        </motion.section>
                    </div>
                </div>
            </div>
        </div>
    );
}
