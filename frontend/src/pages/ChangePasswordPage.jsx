import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../stores/authStore';

export default function ChangePasswordPage() {
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const changePassword = useAuthStore((state) => state.changePassword);
    const loading = useAuthStore((state) => state.loading);
    const error = useAuthStore((state) => state.error);

    const [formData, setFormData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });
    const [localError, setLocalError] = useState('');

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({ ...current, [name]: value }));
        setLocalError('');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (formData.newPassword !== formData.confirmPassword) {
            setLocalError('New password and confirmation must match.');
            return;
        }

        try {
            await changePassword(formData.currentPassword, formData.newPassword);
            navigate('/dashboard', { replace: true });
        } catch {
            // Store error is rendered below.
        }
    };

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10 lg:px-12">
                <header className="flex items-center justify-between">
                    <Link to="/" className="inline-flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_10px_24px_rgba(59,130,246,0.22)]">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-lg font-semibold tracking-tight">MechTrack Pulse</p>
                            <p className="text-sm text-text-secondary">Password update</p>
                        </div>
                    </Link>
                </header>

                <div className="flex flex-1 items-center justify-center py-12">
                    <div className="grid w-full max-w-4xl gap-8 lg:grid-cols-[0.95fr_1.05fr]">
                        <section className="rounded-[32px] border border-border bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
                            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-gold">Security checkpoint</p>
                            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Set a permanent password.</h1>
                            <p className="mt-4 text-base leading-7 text-text-secondary">
                                {user?.full_name
                                    ? `${user.full_name} needs to replace the temporary password before entering the dashboard.`
                                    : 'Replace the temporary password before entering the dashboard.'}
                            </p>

                            <div className="mt-8 rounded-3xl border border-border bg-bg-secondary p-5">
                                <p className="text-sm font-semibold text-text-primary">Password guidance</p>
                                <p className="mt-2 text-sm leading-6 text-text-secondary">
                                    Use a strong password you can store securely. Once updated, you will be redirected to the dashboard.
                                </p>
                            </div>
                        </section>

                        <section className="rounded-[32px] border border-border bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
                            <div className="mb-8">
                                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">Required action</p>
                                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Change password</h2>
                                <p className="mt-3 text-sm leading-6 text-text-secondary">
                                    Finish this step to unlock full access.
                                </p>
                            </div>

                            {error || localError ? (
                                <div className="mb-6 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                    {localError || error}
                                </div>
                            ) : null}

                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div>
                                    <label htmlFor="currentPassword" className="mb-2 block text-sm font-medium text-text-primary">
                                        Current password
                                    </label>
                                    <input
                                        id="currentPassword"
                                        type="password"
                                        name="currentPassword"
                                        value={formData.currentPassword}
                                        onChange={handleChange}
                                        className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                        placeholder="Temporary password"
                                        autoComplete="current-password"
                                        required
                                    />
                                </div>

                                <div>
                                    <label htmlFor="newPassword" className="mb-2 block text-sm font-medium text-text-primary">
                                        New password
                                    </label>
                                    <input
                                        id="newPassword"
                                        type="password"
                                        name="newPassword"
                                        value={formData.newPassword}
                                        onChange={handleChange}
                                        className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                        placeholder="Create a strong password"
                                        autoComplete="new-password"
                                        required
                                    />
                                </div>

                                <div>
                                    <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-text-primary">
                                        Confirm new password
                                    </label>
                                    <input
                                        id="confirmPassword"
                                        type="password"
                                        name="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={handleChange}
                                        className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                        placeholder="Repeat new password"
                                        autoComplete="new-password"
                                        required
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {loading ? 'Updating...' : 'Update Password'}
                                </button>
                            </form>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
