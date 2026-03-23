import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import adminClient from '../api/adminClient';
import { getApiErrorMessage } from '../utils/apiError';

export default function AdminLogin() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    if (localStorage.getItem('admin_token')) {
        return <Navigate to="/admin/dashboard" replace />;
    }

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        try {
            const { data } = await adminClient.post('/platform/login', {
                email,
                password,
            });

            if (!data?.access_token) {
                throw new Error('Missing admin access token in login response.');
            }

            localStorage.setItem('admin_token', data.access_token);
            navigate('/admin/dashboard', { replace: true });
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, 'Unable to sign in with those admin credentials.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
                <header className="flex items-center justify-between">
                    <Link to="/" className="inline-flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_10px_24px_rgba(59,130,246,0.22)]">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-lg font-semibold tracking-tight">MechTrack Admin</p>
                            <p className="text-sm text-text-secondary">Platform approval workspace</p>
                        </div>
                    </Link>

                    <div className="hidden items-center gap-3 sm:flex">
                        <Link to="/login" className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent">
                            User Login
                        </Link>
                        <Link to="/" className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-text-primary shadow-[0_10px_22px_rgba(212,175,55,0.18)] transition hover:brightness-105">
                            Home
                        </Link>
                    </div>
                </header>

                <div className="flex flex-1 items-center justify-center py-12">
                    <div className="grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr]">
                        <section className="rounded-[32px] border border-border bg-white px-7 py-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:px-10 sm:py-10">
                            <div className="inline-flex items-center rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-accent">
                                Admin access
                            </div>
                            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
                                Approve new companies without using Swagger.
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-7 text-text-secondary">
                                Review pending registrations, create owner access, and keep onboarding inside a clean internal console.
                            </p>

                            <div className="mt-10 grid gap-4 sm:grid-cols-3">
                                <div className="rounded-3xl border border-border bg-bg-secondary p-5">
                                    <p className="text-sm font-semibold text-text-primary">Fast approvals</p>
                                    <p className="mt-2 text-sm leading-6 text-text-secondary">Approve pending companies from a single queue.</p>
                                </div>
                                <div className="rounded-3xl border border-border bg-bg-secondary p-5">
                                    <p className="text-sm font-semibold text-text-primary">Scoped auth</p>
                                    <p className="mt-2 text-sm leading-6 text-text-secondary">Admin tokens are stored separately from operator sessions.</p>
                                </div>
                                <div className="rounded-3xl border border-border bg-bg-secondary p-5">
                                    <p className="text-sm font-semibold text-text-primary">Graceful errors</p>
                                    <p className="mt-2 text-sm leading-6 text-text-secondary">Network and auth failures stay visible and recoverable.</p>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-[32px] border border-border bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-9">
                            <div className="mb-8">
                                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-gold">MechTrack Admin</p>
                                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Sign in</h2>
                                <p className="mt-3 text-sm leading-6 text-text-secondary">
                                    Use your platform admin credentials to access pending company approvals.
                                </p>
                            </div>

                            {error ? (
                                <div className="mb-6 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                    {error}
                                </div>
                            ) : null}

                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div>
                                    <label htmlFor="admin-email" className="mb-2 block text-sm font-medium text-text-primary">
                                        Email
                                    </label>
                                    <input
                                        id="admin-email"
                                        type="email"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                        className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                        placeholder="admin@mechtrack.com"
                                        autoComplete="email"
                                        required
                                    />
                                </div>

                                <div>
                                    <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-text-primary">
                                        Password
                                    </label>
                                    <input
                                        id="admin-password"
                                        type="password"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                        placeholder="Enter password"
                                        autoComplete="current-password"
                                        required
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {loading ? 'Signing in...' : 'Login'}
                                </button>
                            </form>

                            <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6 text-sm text-text-secondary">
                                <Link to="/login" className="font-medium text-accent transition hover:text-accent-glow">
                                    Switch to user login
                                </Link>
                                <Link to="/" className="transition hover:text-text-primary">
                                    Back to home
                                </Link>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
