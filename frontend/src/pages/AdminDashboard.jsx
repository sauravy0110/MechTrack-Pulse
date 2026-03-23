import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import adminClient from '../api/adminClient';
import { getApiErrorMessage } from '../utils/apiError';

function formatDate(value) {
    if (!value) {
        return 'Recently submitted';
    }

    try {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(new Date(value));
    } catch {
        return 'Recently submitted';
    }
}

function createApprovalForms(companies) {
    return companies.reduce((forms, company) => {
        forms[company.id] = {
            owner_name: company.owner_name || '',
            owner_email: company.owner_email || '',
            owner_phone: company.owner_phone || '',
        };
        return forms;
    }, {});
}

export default function AdminDashboard() {
    const navigate = useNavigate();
    const token = localStorage.getItem('admin_token');
    const [companies, setCompanies] = useState([]);
    const [approvalForms, setApprovalForms] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [approvingId, setApprovingId] = useState('');
    const [cardErrors, setCardErrors] = useState({});
    const [approvalNotice, setApprovalNotice] = useState(null);

    useEffect(() => {
        if (!toast) {
            return undefined;
        }

        const timer = window.setTimeout(() => setToast(''), 3500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        let active = true;

        const loadCompanies = async () => {
            setLoading(true);
            setError('');

            try {
                const { data } = await adminClient.get('/platform/companies', {
                    params: { status: 'pending' },
                });

                if (!active) {
                    return;
                }

                const safeCompanies = Array.isArray(data) ? data : [];
                setCompanies(safeCompanies);
                setApprovalForms(createApprovalForms(safeCompanies));
            } catch (requestError) {
                if (active) {
                    setError(getApiErrorMessage(requestError, 'Unable to load pending companies.'));
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        loadCompanies();

        return () => {
            active = false;
        };
    }, []);

    const pendingCount = companies.length;
    const subtitle = loading
        ? 'Loading pending approvals'
        : pendingCount === 0
            ? 'No pending companies'
            : `${pendingCount} pending ${pendingCount === 1 ? 'company' : 'companies'}`;

    if (!token) {
        return <Navigate to="/admin/login" replace />;
    }

    const updateForm = (companyId, field, value) => {
        setApprovalForms((current) => ({
            ...current,
            [companyId]: {
                ...current[companyId],
                [field]: value,
            },
        }));

        setCardErrors((current) => ({
            ...current,
            [companyId]: '',
        }));
    };

    const reloadCompanies = async () => {
        setLoading(true);
        setError('');

        try {
            const { data } = await adminClient.get('/platform/companies', {
                params: { status: 'pending' },
            });

            const safeCompanies = Array.isArray(data) ? data : [];
            setCompanies(safeCompanies);
            setApprovalForms(createApprovalForms(safeCompanies));
        } catch (requestError) {
            setError(getApiErrorMessage(requestError, 'Unable to refresh pending companies.'));
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (company) => {
        const form = approvalForms[company.id] || {};
        const payload = {
            owner_name: form.owner_name?.trim() || '',
            owner_email: form.owner_email?.trim() || '',
            owner_phone: form.owner_phone?.trim() || '',
        };

        if (payload.owner_name.length < 2) {
            setCardErrors((current) => ({
                ...current,
                [company.id]: 'Owner name is required before approval.',
            }));
            return;
        }

        if (!payload.owner_email) {
            setCardErrors((current) => ({
                ...current,
                [company.id]: 'Owner email is required before approval.',
            }));
            return;
        }

        setApprovingId(company.id);
        setCardErrors((current) => ({
            ...current,
            [company.id]: '',
        }));

        try {
            const { data } = await adminClient.patch(`/platform/companies/${company.id}/approve`, payload);
            setCompanies((current) => current.filter((item) => item.id !== company.id));
            setApprovalForms((current) => {
                const next = { ...current };
                delete next[company.id];
                return next;
            });
            setApprovalNotice({
                companyName: company.name,
                ownerEmail: data.owner_email || payload.owner_email,
                emailSent: Boolean(data.email_sent),
                tempPassword: data.temp_password || '',
                note: data.note || '',
                emailError: data.email_error || '',
            });
            setToast(
                data.email_sent
                    ? `${company.name} approved and temp password emailed.`
                    : `${company.name} approved. Email failed, temp password shown below.`
            );
        } catch (requestError) {
            setCardErrors((current) => ({
                ...current,
                [company.id]: getApiErrorMessage(requestError, 'Unable to approve this company right now.'),
            }));
        } finally {
            setApprovingId('');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        navigate('/admin/login', { replace: true });
    };

    return (
        <div className="min-h-screen bg-bg-primary text-text-primary">
            {toast ? (
                <div className="fixed right-6 top-6 z-50 rounded-2xl border border-success/20 bg-white px-4 py-3 text-sm font-medium text-success shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                    {toast}
                </div>
            ) : null}

            <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
                <header className="flex flex-col gap-5 rounded-[32px] border border-border bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.07)] lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="inline-flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_10px_24px_rgba(59,130,246,0.22)]">
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-gold">Platform Console</p>
                                <h1 className="mt-1 text-3xl font-semibold tracking-tight">Admin dashboard</h1>
                            </div>
                        </div>
                        <p className="mt-4 text-sm text-text-secondary">{subtitle}</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={reloadCompanies}
                            className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-text-primary shadow-[0_10px_22px_rgba(212,175,55,0.18)] transition hover:brightness-105"
                        >
                            Refresh
                        </button>
                        <Link
                            to="/login"
                            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent"
                        >
                            User Login
                        </Link>
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent"
                        >
                            Logout
                        </button>
                    </div>
                </header>

                <div className="mt-8 rounded-[28px] border border-border bg-white px-6 py-5 text-sm text-text-secondary shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                    Pending registrations currently expose company metadata only. Owner details can be filled in here before approval, and approved owners are forced to change their temporary password on first login.
                </div>

                {approvalNotice ? (
                    <div className="mt-8 rounded-[28px] border border-success/20 bg-white px-6 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-success">Owner access ready</p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
                                    {approvalNotice.companyName} approved
                                </h2>
                                <p className="mt-2 text-sm text-text-secondary">
                                    Owner email: <span className="font-medium text-text-primary">{approvalNotice.ownerEmail}</span>
                                </p>
                                <p className="mt-2 text-sm text-text-secondary">
                                    {approvalNotice.emailSent
                                        ? 'The temporary password was emailed. On first login, the owner will be redirected to change it before accessing the dashboard.'
                                        : 'Email is not configured or failed. Share the temporary password below, and the owner will be forced to change it on first login.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setApprovalNotice(null)}
                                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent"
                            >
                                Dismiss
                            </button>
                        </div>

                        {!approvalNotice.emailSent ? (
                            <div className="mt-5 rounded-2xl border border-gold/20 bg-gold/10 px-4 py-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Temporary password</p>
                                <p className="mt-2 font-mono text-lg font-semibold text-text-primary">{approvalNotice.tempPassword}</p>
                                {approvalNotice.note ? (
                                    <p className="mt-2 text-sm text-text-secondary">{approvalNotice.note}</p>
                                ) : null}
                                {approvalNotice.emailError ? (
                                    <p className="mt-2 text-sm text-danger">{approvalNotice.emailError}</p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {error ? (
                    <div className="mt-8 rounded-[28px] border border-danger/20 bg-white px-6 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                        <p className="text-sm text-danger">{error}</p>
                        <button
                            type="button"
                            onClick={reloadCompanies}
                            className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)] transition hover:bg-accent-glow"
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                {loading ? (
                    <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="rounded-[28px] border border-border bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                                <div className="h-4 w-28 animate-pulse rounded-full bg-bg-secondary" />
                                <div className="mt-4 h-8 w-3/4 animate-pulse rounded-full bg-bg-secondary" />
                                <div className="mt-8 space-y-3">
                                    <div className="h-12 animate-pulse rounded-2xl bg-bg-secondary" />
                                    <div className="h-12 animate-pulse rounded-2xl bg-bg-secondary" />
                                    <div className="h-12 animate-pulse rounded-2xl bg-bg-secondary" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}

                {!loading && !error && companies.length === 0 ? (
                    <div className="mt-8 rounded-[32px] border border-border bg-white px-8 py-16 text-center shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-gold">All clear</p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight">No pending companies</h2>
                        <p className="mt-3 text-sm leading-6 text-text-secondary">
                            New registrations will appear here as soon as they are submitted.
                        </p>
                    </div>
                ) : null}

                {!loading && companies.length > 0 ? (
                    <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {companies.map((company) => {
                            const form = approvalForms[company.id] || {};
                            const cardError = cardErrors[company.id];
                            const isApproving = approvingId === company.id;

                            return (
                                <article
                                    key={company.id}
                                    className="rounded-[28px] border border-border bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Pending company</p>
                                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">{company.name}</h2>
                                        </div>
                                        <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                                            Pending
                                        </span>
                                    </div>

                                    <dl className="mt-6 space-y-4">
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">GST number</dt>
                                            <dd className="mt-1 text-sm font-medium text-text-primary">
                                                {company.gst_number || 'Not provided'}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Owner email</dt>
                                            <dd className="mt-1 text-sm text-text-secondary">
                                                {form.owner_email || 'Not exposed by the current API. Enter it below to approve.'}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Submitted</dt>
                                            <dd className="mt-1 text-sm font-medium text-text-primary">{formatDate(company.created_at)}</dd>
                                        </div>
                                    </dl>

                                    <div className="mt-6 space-y-4 border-t border-border pt-6">
                                        <div>
                                            <label htmlFor={`owner-name-${company.id}`} className="mb-2 block text-sm font-medium text-text-primary">
                                                Owner name
                                            </label>
                                            <input
                                                id={`owner-name-${company.id}`}
                                                type="text"
                                                value={form.owner_name || ''}
                                                onChange={(event) => updateForm(company.id, 'owner_name', event.target.value)}
                                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                                placeholder="Owner full name"
                                                required
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor={`owner-email-${company.id}`} className="mb-2 block text-sm font-medium text-text-primary">
                                                Owner email
                                            </label>
                                            <input
                                                id={`owner-email-${company.id}`}
                                                type="email"
                                                value={form.owner_email || ''}
                                                onChange={(event) => updateForm(company.id, 'owner_email', event.target.value)}
                                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                                placeholder="owner@company.com"
                                                required
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor={`owner-phone-${company.id}`} className="mb-2 block text-sm font-medium text-text-primary">
                                                Owner phone
                                            </label>
                                            <input
                                                id={`owner-phone-${company.id}`}
                                                type="tel"
                                                value={form.owner_phone || ''}
                                                onChange={(event) => updateForm(company.id, 'owner_phone', event.target.value)}
                                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                                placeholder="Optional"
                                            />
                                        </div>
                                    </div>

                                    {cardError ? (
                                        <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                            {cardError}
                                        </div>
                                    ) : null}

                                    <button
                                        type="button"
                                        onClick={() => handleApprove(company)}
                                        disabled={isApproving}
                                        className="mt-6 flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isApproving ? 'Approving...' : 'Approve'}
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
