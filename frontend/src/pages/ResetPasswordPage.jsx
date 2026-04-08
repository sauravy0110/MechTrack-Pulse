import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '../stores/authStore';
import FactoryScene from '../components/FactoryScene';

export default function ResetPasswordPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    
    const { resetPassword, loading, error } = useAuthStore();
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [success, setSuccess] = useState(false);

    // Password validation state
    const [validations, setValidations] = useState({
        length: false, uppercase: false, lowercase: false, number: false, special: false
    });

    useEffect(() => {
        if (!token) {
            navigate('/login');
        }
    }, [token, navigate]);

    useEffect(() => {
        setValidations({
            length: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            lowercase: /[a-z]/.test(password),
            number: /\d/.test(password),
            special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
        });
    }, [password]);

    const isSubmittable = Object.values(validations).every(Boolean);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isSubmittable) return;

        try {
            await resetPassword(token, password);
            setSuccess(true);
        } catch (err) {
            // Handled by store
        }
    };

    const ValidationItem = ({ label, isValid }) => (
        <div className={`flex items-center gap-2 text-xs transition-colors duration-300 ${isValid ? 'text-success' : 'text-text-muted'}`}>
            <CheckCircle2 size={12} className={isValid ? 'opacity-100' : 'opacity-30'} />
            <span>{label}</span>
        </div>
    );

    return (
        <div className="relative min-h-screen overflow-hidden flex items-center justify-center p-4">
            <div className="absolute inset-0 z-0">
                <FactoryScene />
            </div>

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
                        <div className="p-2 rounded-full bg-accent/10 text-accent">
                            <ShieldCheck size={24} />
                        </div>
                        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Create New Password</h2>
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
                                <h3 className="text-xl font-bold text-text-primary mb-2">Password Reset Successful</h3>
                                <p className="text-sm text-text-secondary leading-relaxed mb-8">
                                    Your password has been successfully updated. You can now sign in with your new credentials.
                                </p>
                                <button
                                    onClick={() => navigate('/login')}
                                    className="btn-primary w-full rounded-xl py-3.5 text-sm font-bold"
                                >
                                    Proceed to Login
                                </button>
                            </motion.div>
                        ) : (
                            <motion.form
                                key="form"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                onSubmit={handleSubmit}
                                className="space-y-6"
                            >
                                <p className="text-sm text-text-secondary mb-6">
                                    Please enter your new password below.
                                </p>

                                {error && (
                                    <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium">
                                        {error}
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-accent transition-colors">
                                            <Lock size={18} />
                                        </div>
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            required
                                            className="input-glass w-full pl-11 pr-12 py-3.5 rounded-xl text-sm"
                                            placeholder="New Password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            disabled={loading}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute inset-y-0 right-0 pr-4 flex items-center text-text-muted hover:text-text-primary transition-colors"
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>

                                    {/* Password Strength Indicators */}
                                    <div className="p-4 rounded-xl bg-bg-primary/50 border border-border mt-4">
                                        <h4 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider">Password Requirements</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <ValidationItem label="Minimum 8 characters" isValid={validations.length} />
                                            <ValidationItem label="One uppercase letter" isValid={validations.uppercase} />
                                            <ValidationItem label="One lowercase letter" isValid={validations.lowercase} />
                                            <ValidationItem label="One number" isValid={validations.number} />
                                            <ValidationItem label="One special character" isValid={validations.special} />
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || !isSubmittable}
                                    className="btn-primary w-full rounded-xl py-3.5 text-sm font-bold tracking-wide mt-6"
                                >
                                    {loading ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                                    ) : (
                                        "Secure My Account"
                                    )}
                                </button>
                            </motion.form>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </div>
    );
}
