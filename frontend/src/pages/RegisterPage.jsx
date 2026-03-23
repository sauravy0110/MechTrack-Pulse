import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/apiError';

export default function RegisterPage() {
    const [formData, setFormData] = useState({
        company_name: '',
        gst_number: '',
        owner_name: '',
        owner_email: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({ ...current, [name]: value }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.post('/companies/register', formData);
            setSuccess(true);
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, 'Registration failed. Please review the details and try again.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
                <header className="flex items-center justify-between">
                    <Link to="/" className="inline-flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_10px_24px_rgba(59,130,246,0.22)]">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-lg font-semibold tracking-tight">MechTrack Pulse</p>
                            <p className="text-sm text-text-secondary">Company onboarding</p>
                        </div>
                    </Link>

                    <div className="hidden items-center gap-3 sm:flex">
                        <Link to="/login" className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent">
                            User Login
                        </Link>
                        <Link to="/admin/login" className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-text-primary shadow-[0_10px_22px_rgba(212,175,55,0.18)] transition hover:brightness-105">
                            Admin Login
                        </Link>
                    </div>
                </header>

                <div className="flex flex-1 items-center justify-center py-12">
                    <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[0.95fr_1.05fr]">
                        <section className="rounded-[32px] border border-border bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
                            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">Company registration</p>
                            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Request access for your factory team.</h1>
                            <p className="mt-4 text-base leading-7 text-text-secondary">
                                Submit your company details once. Platform admins review pending registrations from the new admin dashboard.
                            </p>

                            <div className="mt-8 space-y-4">
                                <div className="rounded-3xl border border-border bg-bg-secondary p-5">
                                    <p className="text-sm font-semibold text-text-primary">Simple onboarding</p>
                                    <p className="mt-2 text-sm leading-6 text-text-secondary">Submit company and owner details in a single form.</p>
                                </div>
                                <div className="rounded-3xl border border-border bg-bg-secondary p-5">
                                    <p className="text-sm font-semibold text-text-primary">Admin reviewed</p>
                                    <p className="mt-2 text-sm leading-6 text-text-secondary">Registrations stay pending until a platform admin approves them.</p>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-[32px] border border-border bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
                            <div className="mb-8">
                                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-gold">Get started</p>
                                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Register your company</h2>
                                <p className="mt-3 text-sm leading-6 text-text-secondary">
                                    We only need the essentials to create your pending company record.
                                </p>
                            </div>

                            {success ? (
                                <div className="rounded-[28px] border border-success/20 bg-success/5 p-6 text-center">
                                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
                                        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <h3 className="mt-4 text-2xl font-semibold tracking-tight">Registration submitted</h3>
                                    <p className="mt-3 text-sm leading-6 text-text-secondary">
                                        Your company is now pending review. Once approved, your team can sign in from the user login page.
                                    </p>
                                    <div className="mt-6 flex flex-col gap-3">
                                        <Link
                                            to="/login"
                                            className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow"
                                        >
                                            Go to User Login
                                        </Link>
                                        <Link to="/" className="text-sm text-text-secondary transition hover:text-text-primary">
                                            Back to home
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-5">
                                    {error ? (
                                        <div className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                            {error}
                                        </div>
                                    ) : null}

                                    <div>
                                        <label htmlFor="company_name" className="mb-2 block text-sm font-medium text-text-primary">
                                            Company name
                                        </label>
                                        <input
                                            id="company_name"
                                            type="text"
                                            name="company_name"
                                            value={formData.company_name}
                                            onChange={handleChange}
                                            className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                            placeholder="Acme Manufacturing"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="gst_number" className="mb-2 block text-sm font-medium text-text-primary">
                                            GST number
                                        </label>
                                        <input
                                            id="gst_number"
                                            type="text"
                                            name="gst_number"
                                            value={formData.gst_number}
                                            onChange={handleChange}
                                            className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                            placeholder="22AAAAA0000A1Z5"
                                            required
                                        />
                                    </div>

                                    <div className="grid gap-5 sm:grid-cols-2">
                                        <div>
                                            <label htmlFor="owner_name" className="mb-2 block text-sm font-medium text-text-primary">
                                                Owner name
                                            </label>
                                            <input
                                                id="owner_name"
                                                type="text"
                                                name="owner_name"
                                                value={formData.owner_name}
                                                onChange={handleChange}
                                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                                placeholder="Jane Doe"
                                                required
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="owner_email" className="mb-2 block text-sm font-medium text-text-primary">
                                                Owner email
                                            </label>
                                            <input
                                                id="owner_email"
                                                type="email"
                                                name="owner_email"
                                                value={formData.owner_email}
                                                onChange={handleChange}
                                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                                placeholder="jane@acme.com"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {loading ? 'Submitting...' : 'Submit Registration'}
                                    </button>
                                </form>
                            )}

                            {!success ? (
                                <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6 text-sm text-text-secondary">
                                    <Link to="/login" className="font-medium text-accent transition hover:text-accent-glow">
                                        Already approved? Go to user login
                                    </Link>
                                    <Link to="/" className="transition hover:text-text-primary">
                                        Back to home
                                    </Link>
                                </div>
                            ) : null}
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
