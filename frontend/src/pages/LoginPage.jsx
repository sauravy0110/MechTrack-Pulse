import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import useAuthStore from '../stores/authStore';
import ThemeToggle from '../components/ThemeToggle';
import { Factory, Lock, Eye, EyeOff, ArrowRight, Shield, Monitor } from 'lucide-react';

const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07 } },
};

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const { login, loading, error } = useAuthStore();
    const navigate = useNavigate();

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const data = await login(email, password);
            if (data.must_change_password) {
                navigate('/change-password', { replace: true });
            } else {
                navigate('/dashboard', { replace: true });
            }
        } catch {
            // Store error rendered below
        }
    };

    return (
        <div className="min-h-screen text-text-primary">
            <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />
            <div className="pointer-events-none fixed inset-0 bg-dot-pattern opacity-30 z-0" />

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-12">
                {/* Header */}
                <motion.header
                    initial={{ opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between"
                >
                    <Link to="/" className="inline-flex items-center gap-3 group">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white glow-accent group-hover:scale-105 transition-transform">
                            <Factory size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold tracking-tight">MechTrack Pulse</p>
                            <p className="text-[10px] text-text-muted font-mono uppercase tracking-widest">User Workspace</p>
                        </div>
                    </Link>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Link to="/admin/login" className="hidden sm:inline-flex btn-gold rounded-full px-4 py-2 text-xs font-semibold">
                            Admin
                        </Link>
                        <Link to="/register" className="hidden sm:inline-flex btn-ghost rounded-full px-4 py-2 text-xs font-medium">
                            Register
                        </Link>
                    </div>
                </motion.header>

                <div className="flex flex-1 items-center justify-center py-10">
                    <div className="grid w-full max-w-5xl gap-7 lg:grid-cols-[0.95fr_1.05fr]">
                        {/* Left Info Panel */}
                        <motion.section
                            initial="hidden" animate="show" variants={stagger}
                            className="glass-strong rounded-3xl p-7 sm:p-9"
                        >
                            <motion.p variants={fadeUp} className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">User Login</motion.p>
                            <motion.h1 variants={fadeUp} className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl leading-tight">
                                Access the <span className="gradient-text">production workspace</span>.
                            </motion.h1>
                            <motion.p variants={fadeUp} className="mt-4 text-sm leading-7 text-text-secondary">
                                Owners, supervisors, operators, and clients sign in to access their role-specific MechTrack workspace.
                            </motion.p>

                            <motion.div variants={stagger} className="mt-7 space-y-3">
                                <motion.div variants={fadeUp} className="glass-card rounded-2xl p-4 flex items-start gap-3">
                                    <Monitor size={16} className="text-accent mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs font-bold text-text-primary">Live 3D Visibility</p>
                                        <p className="mt-1 text-xs leading-5 text-text-secondary">Track workstations, assignments, and risk in real-time.</p>
                                    </div>
                                </motion.div>
                                <motion.div variants={fadeUp} className="glass-card rounded-2xl p-4 flex items-start gap-3">
                                    <Shield size={16} className="text-gold mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs font-bold text-text-primary">Separate Admin Flow</p>
                                        <p className="mt-1 text-xs leading-5 text-text-secondary">Platform admins approve companies from their own secure route.</p>
                                    </div>
                                </motion.div>
                            </motion.div>
                        </motion.section>

                        {/* Right Form Panel */}
                        <motion.section
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                            className="glass-strong rounded-3xl p-7 sm:p-9"
                        >
                            <div className="mb-7">
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Welcome Back</p>
                                <h2 className="mt-2 text-2xl font-bold tracking-tight">Sign in</h2>
                                <p className="mt-2 text-xs leading-5 text-text-secondary">
                                    Use your company credentials to enter the dashboard.
                                </p>
                            </div>

                            {error && (
                                <motion.div
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mb-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger flex items-center gap-2"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                                    {error}
                                </motion.div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label htmlFor="user-email" className="mb-1.5 block text-xs font-semibold text-text-primary">
                                        Email
                                    </label>
                                    <input
                                        id="user-email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                                        placeholder="operator@company.com"
                                        autoComplete="email"
                                        required
                                    />
                                </div>

                                <div>
                                    <div className="mb-1.5 flex justify-between items-center">
                                        <label htmlFor="user-password" className="block text-xs font-semibold text-text-primary">
                                            Password
                                        </label>
                                        <Link to="/forgot-password" className="text-xs text-accent hover:text-accent-glow font-medium transition-colors">
                                            Forgot Password?
                                        </Link>
                                    </div>
                                    <div className="relative">
                                        <input
                                            id="user-password"
                                            type={showPass ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="input-glass w-full rounded-xl px-4 py-3 pr-10 text-sm"
                                            placeholder="Enter password"
                                            autoComplete="current-password"
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPass(!showPass)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                        >
                                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>

                                <motion.button
                                    type="submit"
                                    disabled={loading}
                                    whileHover={{ scale: 1.01 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>Sign In <ArrowRight size={14} /></>
                                    )}
                                </motion.button>
                            </form>

                            <div className="mt-6 flex flex-col gap-2 border-t border-border pt-5 text-xs text-text-secondary">
                                <Link to="/admin/login" className="font-medium text-accent hover:text-accent-glow transition-colors">
                                    Need platform access? Go to admin login
                                </Link>
                                <Link to="/register" className="hover:text-text-primary transition-colors">
                                    New company? Register here
                                </Link>
                                <Link to="/" className="hover:text-text-primary transition-colors">
                                    Back to home
                                </Link>
                            </div>
                        </motion.section>
                    </div>
                </div>
            </div>
        </div>
    );
}
