import { useEffect, useMemo, useState } from 'react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';

const INITIAL_FORM = {
    full_name: '',
    email: '',
    phone: '',
    role: 'operator',
};

const ROLE_LABELS = {
    supervisor: 'Supervisor',
    operator: 'Operator',
    client: 'Client',
};

export default function AddUserModal() {
    const closeModal = useAppStore((state) => state.closeAddUserModal);
    const createUser = useAppStore((state) => state.createUser);
    const creatingUser = useAppStore((state) => state.creatingUser);
    const currentUserRole = useAuthStore((state) => state.user?.role);

    const allowedRoles = useMemo(() => {
        if (currentUserRole === 'owner') {
            return ['supervisor', 'operator', 'client'];
        }
        if (currentUserRole === 'supervisor') {
            return ['operator'];
        }
        return [];
    }, [currentUserRole]);

    const [formData, setFormData] = useState(() => ({
        ...INITIAL_FORM,
        role: allowedRoles[0] || 'operator',
    }));
    const [error, setError] = useState('');
    const [createdUser, setCreatedUser] = useState(null);
    const [copied, setCopied] = useState(false);
    const selectedRole = allowedRoles.includes(formData.role) ? formData.role : (allowedRoles[0] || '');

    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape' && !creatingUser) {
                closeModal();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [creatingUser, closeModal]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({ ...current, [name]: value }));
        setError('');
        setCopied(false);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const full_name = formData.full_name.trim();
        const email = formData.email.trim();
        const phone = formData.phone.trim();

        if (full_name.length < 2) {
            setError('Name must be at least 2 characters.');
            return;
        }

        if (!email) {
            setError('Email is required.');
            return;
        }

        try {
            const data = await createUser({
                full_name,
                email,
                phone,
                role: selectedRole,
            });
            setCreatedUser({
                ...data,
                phone,
            });
        } catch (createError) {
            setError(createError.message || 'Unable to add user right now.');
        }
    };

    const handleCopy = async () => {
        if (!createdUser) {
            return;
        }

        const payload = `Email: ${createdUser.email}\nTemp Password: ${createdUser.temp_password}`;

        try {
            await navigator.clipboard.writeText(payload);
            setCopied(true);
        } catch {
            setCopied(false);
            setError('Unable to copy credentials automatically. Please copy them manually.');
        }
    };

    return (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.18)] px-4 py-8">
            <div className="w-full max-w-lg rounded-[32px] border border-border bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:p-8">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">Team management</p>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">Add User</h2>
                        <p className="mt-3 text-sm leading-6 text-text-secondary">
                            Create a team member and share the temporary password once. New users are forced to change it on first login.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={closeModal}
                        disabled={creatingUser}
                        className="rounded-full border border-border px-3 py-2 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Close
                    </button>
                </div>

                {createdUser ? (
                    <div className="mt-8 rounded-[28px] border border-success/20 bg-success/5 p-6">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-success">User Created</p>
                        <h3 className="mt-3 text-xl font-semibold text-text-primary">{createdUser.full_name}</h3>
                        <p className="mt-2 text-sm text-text-secondary">
                            {ROLE_LABELS[createdUser.role]} access is ready. Share these credentials securely.
                        </p>

                        <div className="mt-5 space-y-3 rounded-2xl border border-border bg-white px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-text-secondary">Email</span>
                                <span className="text-sm font-medium text-text-primary">{createdUser.email}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-text-secondary">Temp Password</span>
                                <span className="rounded-xl bg-bg-secondary px-3 py-1.5 font-mono text-sm font-semibold text-text-primary">
                                    {createdUser.temp_password}
                                </span>
                            </div>
                        </div>

                        {error ? (
                            <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                {error}
                            </div>
                        ) : null}

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeModal}
                                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="rounded-2xl bg-gold px-5 py-3 text-sm font-semibold text-text-primary shadow-[0_14px_28px_rgba(212,175,55,0.18)] transition hover:brightness-105"
                            >
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {error ? (
                            <div className="mt-6 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                {error}
                            </div>
                        ) : null}

                        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                            <div>
                                <label htmlFor="full_name" className="mb-2 block text-sm font-medium text-text-primary">
                                    Name
                                </label>
                                <input
                                    id="full_name"
                                    name="full_name"
                                    type="text"
                                    value={formData.full_name}
                                    onChange={handleChange}
                                    className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                    placeholder="Riya Shah"
                                    autoFocus
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="email" className="mb-2 block text-sm font-medium text-text-primary">
                                    Email
                                </label>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                    placeholder="user@company.com"
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="role" className="mb-2 block text-sm font-medium text-text-primary">
                                    Role
                                </label>
                                <select
                                    id="role"
                                    name="role"
                                    value={selectedRole}
                                    onChange={handleChange}
                                    className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                >
                                    {allowedRoles.map((role) => (
                                        <option key={role} value={role}>
                                            {ROLE_LABELS[role]}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label htmlFor="phone" className="mb-2 block text-sm font-medium text-text-primary">
                                    Phone <span className="text-text-muted">(optional)</span>
                                </label>
                                <input
                                    id="phone"
                                    name="phone"
                                    type="tel"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                    placeholder="+91 9876543210"
                                />
                            </div>

                            <div className="rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
                                {currentUserRole === 'owner'
                                    ? 'Owners can create supervisors, operators, and clients.'
                                    : 'Supervisors can create operator accounts only.'}
                            </div>

                            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    disabled={creatingUser}
                                    className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={creatingUser || allowedRoles.length === 0}
                                    className="flex items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {creatingUser ? 'Creating...' : '+ Add User'}
                                </button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
