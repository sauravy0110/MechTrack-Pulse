import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowLeft, Send, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '../stores/authStore';
import FactoryScene from '../components/FactoryScene';

export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const { forgotPassword, loading, error } = useAuthStore();
    const [email, setEmail] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await forgotPassword(email);
            setSuccess(true);
        } catch (err) {
            // Error is handled by authStore
        }
    };

    return (
        <div className="relative min-h-screen overflow-hidden flex items-center justify-center p-4">
            {/* 3D Background */}
            <div className="absolute inset-0 z-0">
                <FactoryScene />
            </div>

            {/* Video Background Layer */}
            <div className="video-bg-container pointer-events-none">
                <div className="video-bg-overlay pointer-events-none"></div>
            </div>

            <div className="relative z-10 w-full max-w-md">
                <motion.div
                    initial={{ opacity: 0, y: 30, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="glass-strong rounded-3xl p-8 sm:p-10 shadow-2xl animated-border"
                >
                    <div className="flex items-center gap-3 mb-8">
                        <button 
                            onClick={() => navigate('/login')}
                            className="p-2 rounded-full hover:bg-white/10 transition-colors text-text-secondary hover:text-text-primary"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Recovery</h2>
                    </div>

                    <AnimatePresence mode="wait">
                        {success ? (
                            <motion.div
                                key="success"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-center py-8"
                            >
                                <div className="mx-auto w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mb-6 animate-glow-breathe text-success">
                                    <CheckCircle2 size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-text-primary mb-2">Check Your Email</h3>
                                <p className="text-sm text-text-secondary leading-relaxed mb-8">
                                    If an account exists for <span className="text-text-primary font-medium">{email}</span>, we have sent a password reset link.
                                </p>
                                <button
                                    onClick={() => navigate('/login')}
                                    className="btn-ghost w-full rounded-xl py-3 text-sm font-semibold"
                                >
                                    Return to Login
                                </button>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="form"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                            >
                                <p className="text-sm text-text-secondary mb-8 leading-relaxed">
                                    Enter the email address associated with your account and we'll send you a link to reset your password.
                                </p>

                                {error && (
                                    <motion.div 
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="mb-6 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium"
                                    >
                                        {error}
                                    </motion.div>
                                )}

                                <form onSubmit={handleSubmit} className="space-y-6">
                                    <div className="space-y-4">
                                        <div className="relative group">
                                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-accent transition-colors">
                                                <Mail size={18} />
                                            </div>
                                            <input
                                                type="email"
                                                required
                                                className="input-glass w-full pl-11 pr-4 py-3.5 rounded-xl text-sm"
                                                placeholder="Email Address"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                disabled={loading}
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loading || !email}
                                        className="btn-primary w-full rounded-xl py-3.5 text-sm font-bold tracking-wide flex justify-center items-center gap-2 mt-4"
                                    >
                                        {loading ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                Send Reset Link <Send size={16} />
                                            </>
                                        )}
                                    </button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </div>
    );
}
