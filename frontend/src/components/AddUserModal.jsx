import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import { X, Plus, Copy, CheckCircle, User, Mail, Phone } from 'lucide-react';

const INITIAL_FORM = { full_name: '', email: '', phone: '', role: 'operator' };
const ROLE_LABELS = { supervisor: 'Supervisor', operator: 'Operator', client: 'Client' };

export default function AddUserModal() {
    const closeModal = useAppStore((state) => state.closeAddUserModal);
    const createUser = useAppStore((state) => state.createUser);
    const creatingUser = useAppStore((state) => state.creatingUser);
    const currentUserRole = useAuthStore((state) => state.user?.role);

    const allowedRoles = useMemo(() => {
        if (currentUserRole === 'owner') return ['supervisor', 'operator', 'client'];
        if (currentUserRole === 'supervisor') return ['operator'];
        return [];
    }, [currentUserRole]);

    const [formData, setFormData] = useState(() => ({ ...INITIAL_FORM, role: allowedRoles[0] || 'operator' }));
    const [error, setError] = useState('');
    const [createdUser, setCreatedUser] = useState(null);
    const [copied, setCopied] = useState(false);
    const selectedRole = allowedRoles.includes(formData.role) ? formData.role : (allowedRoles[0] || '');

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape' && !creatingUser) closeModal(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [creatingUser, closeModal]);

    const handleChange = (e) => { setFormData((c) => ({ ...c, [e.target.name]: e.target.value })); setError(''); setCopied(false); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const full_name = formData.full_name.trim(), email = formData.email.trim(), phone = formData.phone.trim();
        if (full_name.length < 2) { setError('Name must be at least 2 characters.'); return; }
        if (!email) { setError('Email is required.'); return; }
        try { const data = await createUser({ full_name, email, phone, role: selectedRole }); setCreatedUser({ ...data, phone }); }
        catch (err) { setError(err.message || 'Unable to add user.'); }
    };

    const handleCopy = async () => {
        if (!createdUser) return;
        try { await navigator.clipboard.writeText(`Email: ${createdUser.email}\nTemp Password: ${createdUser.temp_password}`); setCopied(true); }
        catch { setError('Unable to copy. Please copy manually.'); }
    };

    return (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-bg-overlay px-4 py-8" onClick={closeModal}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="modal-shell w-full max-w-lg rounded-[30px] p-7 shadow-2xl sm:p-8"
                onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Team management</p>
                        <h2 className="font-display mt-2 text-3xl tracking-tight text-text-primary">Add User</h2>
                        <p className="mt-2 text-xs leading-6 text-text-secondary">New users must change their temp password on first login.</p>
                    </div>
                    <button type="button" onClick={closeModal} disabled={creatingUser}
                        className="modal-close disabled:opacity-50"><X size={14} /> Close</button>
                </div>

                <AnimatePresence mode="wait">
                    {createdUser ? (
                        <motion.div key="success" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                            className="mt-6 glass-card rounded-2xl p-6 border-success/20 glow-success">
                            <div className="flex items-center gap-2 text-success mb-3">
                                <CheckCircle size={16} />
                                <p className="text-xs font-bold uppercase tracking-[0.2em]">User Created</p>
                            </div>
                            <h3 className="text-xl font-bold text-text-primary">{createdUser.full_name}</h3>
                            <p className="mt-1 text-xs text-text-secondary">{ROLE_LABELS[createdUser.role]} access is ready.</p>

                            <div className="mt-4 space-y-2 glass-card rounded-xl px-4 py-4">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-text-secondary">Email</span>
                                    <span className="font-medium text-text-primary">{createdUser.email}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-text-secondary">Temp Password</span>
                                    <span className="rounded-lg bg-bg-hover px-3 py-1.5 font-mono text-sm font-semibold text-text-primary">{createdUser.temp_password}</span>
                                </div>
                            </div>
                            {error && <div className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}
                            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                                <button type="button" onClick={closeModal} className="btn-ghost rounded-xl px-4 py-3 text-sm font-medium">Close</button>
                                <motion.button type="button" onClick={handleCopy} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                    className="btn-gold rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2">
                                    {copied ? <><CheckCircle size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                                </motion.button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div key="form">
                            {error && (
                                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                                    className="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger">{error}</motion.div>
                            )}
                            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                                <div>
                                    <label htmlFor="full_name" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><User size={12} className="text-text-muted" /> Name</label>
                                    <input id="full_name" name="full_name" type="text" value={formData.full_name} onChange={handleChange}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="Riya Shah" autoFocus required />
                                </div>
                                <div>
                                    <label htmlFor="email" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><Mail size={12} className="text-text-muted" /> Email</label>
                                    <input id="email" name="email" type="email" value={formData.email} onChange={handleChange}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="user@company.com" required />
                                </div>
                                <div>
                                    <label htmlFor="role" className="mb-1.5 block text-xs font-semibold">Role</label>
                                    <select id="role" name="role" value={selectedRole} onChange={handleChange}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                                        {allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="phone" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><Phone size={12} className="text-text-muted" /> Phone <span className="text-text-muted">(optional)</span></label>
                                    <input id="phone" name="phone" type="tel" value={formData.phone} onChange={handleChange}
                                        className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="+91 9876543210" />
                                </div>
                                <div className="glass-card rounded-xl px-4 py-3 text-xs text-text-secondary">
                                    {currentUserRole === 'owner' ? 'Owners can create supervisors, operators, and clients.' : 'Supervisors can create operator accounts only.'}
                                </div>
                                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                                    <button type="button" onClick={closeModal} disabled={creatingUser}
                                        className="btn-ghost rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50">Cancel</button>
                                    <motion.button type="submit" disabled={creatingUser || allowedRoles.length === 0}
                                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                                        className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                                        {creatingUser ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> :
                                            <><Plus size={14} /> Add User</>}
                                    </motion.button>
                                </div>
                            </form>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}
