import { memo, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Cpu,
    Download,
    FileText,
    History,
    Save,
    Sparkles,
    Users,
} from 'lucide-react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import api from '../api/client';

const EMPTY_PROFILE = {
    name: '',
    gst_number: '',
    msme_number: '',
    industry_type: '',
    address: '',
    city: '',
    state: '',
};

function formatPlan(plan) {
    return plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : 'Free';
}

function formatDate(value) {
    if (!value) return 'Not yet';
    try {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(new Date(value));
    } catch {
        return 'Not yet';
    }
}

function toDateTimeLocal(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDefaultReportWindow(hoursBack = 24 * 7) {
    const end = new Date();
    const start = new Date(end.getTime() - (hoursBack * 60 * 60 * 1000));
    return {
        period_start: toDateTimeLocal(start),
        period_end: toDateTimeLocal(end),
    };
}

function UsageBar({ label, metric, accent }) {
    const width = metric.utilization_percent == null ? 24 : Math.max(metric.utilization_percent, 6);
    return (
        <div className="rounded-xl border border-border/60 bg-black/10 p-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</p>
                <p className="text-[11px] font-mono text-text-secondary">
                    {metric.limit === -1 ? `${metric.used} / Unlimited` : `${metric.used} / ${metric.limit}`}
                </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-primary">
                <div className={`h-full rounded-full ${accent}`} style={{ width: `${Math.min(width, 100)}%` }} />
            </div>
            <p className="mt-2 text-[10px] text-text-muted">
                {metric.remaining == null ? 'Unlimited plan capacity' : `${metric.remaining} remaining`}
            </p>
        </div>
    );
}

const OwnerBusinessPanel = memo(function OwnerBusinessPanel({ embedded = false }) {
    const ownerBusiness = useAppStore((state) => state.ownerBusiness);
    const reports = useAppStore((state) => state.reports);
    const dashboard = useAppStore((state) => state.dashboard);
    const loadingOwnerBusiness = useAppStore((state) => state.loadingOwnerBusiness);
    const loadingReports = useAppStore((state) => state.loadingReports);
    const savingCompanyProfile = useAppStore((state) => state.savingCompanyProfile);
    const generatingReport = useAppStore((state) => state.generatingReport);
    const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
    const generateReport = useAppStore((state) => state.generateReport);
    const downloadOwnerExport = useAppStore((state) => state.downloadOwnerExport);
    const openJobCreationModal = useAppStore((state) => state.openJobCreationModal);
    const user = useAuthStore((state) => state.user);

    const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
    const [profileError, setProfileError] = useState('');
    const [reportError, setReportError] = useState('');
    const [exportingFormat, setExportingFormat] = useState('');
    const [ownerIntelligence, setOwnerIntelligence] = useState(null);
    const [auditLogs, setAuditLogs] = useState([]);
    const [providerStatus, setProviderStatus] = useState(null);
    const [reportForm, setReportForm] = useState(() => ({
        title: 'Weekly Operations Pulse',
        report_type: 'weekly',
        ...getDefaultReportWindow(),
    }));

    useEffect(() => {
        if (!ownerBusiness?.company) return;
        setProfileForm({
            name: ownerBusiness.company.name || '',
            gst_number: ownerBusiness.company.gst_number || '',
            msme_number: ownerBusiness.company.msme_number || '',
            industry_type: ownerBusiness.company.industry_type || '',
            address: ownerBusiness.company.address || '',
            city: ownerBusiness.company.city || '',
            state: ownerBusiness.company.state || '',
        });
    }, [ownerBusiness?.company]);

    useEffect(() => {
        let cancelled = false;

        async function loadOwnerExtras() {
            try {
                const [intelligenceResponse, auditResponse, providerResponse] = await Promise.all([
                    api.get('/ai/owner-intelligence'),
                    api.get('/owner/audit-logs'),
                    api.get('/ai/provider-status'),
                ]);
                if (!cancelled) {
                    setOwnerIntelligence(intelligenceResponse.data || null);
                    setAuditLogs(Array.isArray(auditResponse.data) ? auditResponse.data : []);
                    setProviderStatus(providerResponse.data || null);
                }
            } catch (error) {
                void error;
            }
        }

        if (user?.role === 'owner') {
            loadOwnerExtras();
        }

        return () => {
            cancelled = true;
        };
    }, [user?.role, ownerBusiness?.company?.id, reports.length]);

    const summaryCards = useMemo(() => {
        if (!ownerBusiness) return [];
        return [
            { label: 'Completion', value: `${ownerBusiness.tasks.completion_rate.toFixed(1)}%`, tone: 'text-success', icon: Activity },
            { label: 'Active Ops', value: ownerBusiness.team.active_operators, tone: 'text-accent', icon: Users },
            { label: 'Machine Fleet', value: ownerBusiness.machines.total, tone: 'text-text-primary', icon: Cpu },
            { label: 'Risk Watch', value: ownerBusiness.watchlist.high_risk_tasks, tone: 'text-danger', icon: AlertTriangle },
        ];
    }, [ownerBusiness]);

    const usageEntries = useMemo(() => {
        if (!ownerBusiness) return [];
        return [
            { label: 'Users', metric: ownerBusiness.subscription.usage.users, accent: 'bg-accent' },
            { label: 'Machines', metric: ownerBusiness.subscription.usage.machines, accent: 'bg-warning' },
            { label: 'Tasks / Month', metric: ownerBusiness.subscription.usage.tasks, accent: 'bg-success' },
        ];
    }, [ownerBusiness]);

    const handleProfileSubmit = async (event) => {
        event.preventDefault();
        setProfileError('');
        try {
            await updateCompanyProfile(profileForm);
        } catch (error) {
            setProfileError(error.message || 'Unable to save company profile.');
        }
    };

    const handleReportSubmit = async (event) => {
        event.preventDefault();
        setReportError('');

        if (!reportForm.period_start || !reportForm.period_end) {
            setReportError('Choose a valid report date range.');
            return;
        }

        const start = new Date(reportForm.period_start);
        const end = new Date(reportForm.period_end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            setReportError('Report end time must be after the start time.');
            return;
        }

        try {
            await generateReport({
                ...reportForm,
                period_start: start.toISOString(),
                period_end: end.toISOString(),
            });
        } catch (error) {
            setReportError(error.message || 'Unable to generate report.');
        }
    };

    const handleExport = async (format) => {
        setExportingFormat(format);
        try {
            await downloadOwnerExport(format);
        } catch (error) {
            setReportError(error.message || `Unable to export ${format.toUpperCase()} file.`);
        } finally {
            setExportingFormat('');
        }
    };

    if (loadingOwnerBusiness && !ownerBusiness) {
        const shellClass = embedded
            ? 'premium-surface rounded-[28px] flex flex-col overflow-hidden'
            : 'w-80 glass border-l border-border flex flex-col shrink-0 overflow-hidden';
        const contentClass = embedded ? 'p-4 space-y-3' : 'flex-1 overflow-y-auto p-4 space-y-3';
        return (
            <aside className={shellClass}>
                <div className="px-4 py-3 border-b border-border">
                    <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Owner Console</h2>
                    <p className="text-[10px] text-text-muted mt-1">Syncing business command center...</p>
                </div>
                <div className={contentClass}>
                    {[0, 1, 2, 3].map((item) => (
                        <div key={item} className="glass-card rounded-2xl p-4">
                            <div className="h-3 w-20 animate-shimmer rounded-full" />
                            <div className="mt-3 h-10 animate-shimmer rounded-xl" />
                        </div>
                    ))}
                </div>
            </aside>
        );
    }

    if (!ownerBusiness) {
        const shellClass = embedded
            ? 'premium-surface rounded-[28px] flex flex-col overflow-hidden'
            : 'w-80 glass border-l border-border flex flex-col shrink-0 overflow-hidden';
        return (
            <aside className={shellClass}>
                <div className="px-4 py-3 border-b border-border">
                    <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Owner Console</h2>
                </div>
                <div className="flex-1 flex items-center justify-center p-6 text-center">
                    <div>
                        <div className="w-12 h-12 bg-accent/10 rounded-xl border border-accent/20 flex items-center justify-center mx-auto mb-3">
                            <Sparkles size={20} className="text-accent" />
                        </div>
                        <p className="text-sm font-semibold text-text-primary">Business data is unavailable right now</p>
                        <p className="mt-2 text-xs text-text-muted">Refresh the dashboard or check owner permissions.</p>
                    </div>
                </div>
            </aside>
        );
    }

    const { company, subscription, tasks, machines, team, reports: reportsSummary, watchlist } = ownerBusiness;
    const shellClass = embedded
        ? 'premium-surface rounded-[28px] flex flex-col overflow-hidden'
        : 'w-80 glass border-l border-border flex flex-col shrink-0 overflow-hidden';
    const contentClass = embedded ? 'p-4 space-y-4' : 'flex-1 overflow-y-auto p-4 space-y-4';

    return (
        <aside className={shellClass}>
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Owner Console</h2>
                        <p className="mt-1 text-sm font-semibold text-text-primary">{company.name}</p>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">
                            {formatPlan(subscription.plan)} plan · {subscription.payment_status}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => openJobCreationModal()}
                        className="btn-primary rounded-full px-3 py-1.5 text-[11px] font-semibold"
                    >
                        + Job
                    </button>
                </div>
            </div>

            <div className={contentClass}>
                <div className="grid grid-cols-2 gap-2">
                    {summaryCards.map((card) => {
                        const Icon = card.icon;
                        return (
                            <div key={card.label} className="glass-card rounded-2xl p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{card.label}</p>
                                    <Icon size={12} className={card.tone} />
                                </div>
                                <p className={`mt-3 text-xl font-black tracking-tight ${card.tone}`}>{card.value}</p>
                            </div>
                        );
                    })}
                </div>

                <div className="glass-card rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Business Capacity</p>
                            <p className="mt-1 text-sm font-semibold text-text-primary">
                                AI {subscription.ai_enabled ? 'enabled' : 'locked'} on {formatPlan(subscription.plan)}
                            </p>
                        </div>
                        <div className="text-right text-[10px] text-text-muted">
                            <p>Since {formatDate(subscription.started_at)}</p>
                            <p>{subscription.expires_at ? `Renews ${formatDate(subscription.expires_at)}` : 'No expiry set'}</p>
                        </div>
                    </div>
                    {providerStatus && (
                        <div className="rounded-xl border border-border/60 bg-black/10 px-3 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">AI Provider</p>
                            <p className={`mt-1 text-xs font-semibold ${providerStatus.enabled ? 'text-success' : 'text-warning'}`}>
                                {providerStatus.enabled ? 'OpenRouter connected' : 'Heuristic fallback active'}
                            </p>
                            <p className="mt-1 text-[10px] text-text-muted">
                                General: {providerStatus.models?.general || '--'}
                            </p>
                        </div>
                    )}
                    {usageEntries.map((entry) => <UsageBar key={entry.label} {...entry} />)}
                </div>

                <div className="glass-card rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Operations Watchlist</p>
                            <p className="mt-1 text-sm font-semibold text-text-primary">What needs owner attention now</p>
                        </div>
                        <Sparkles size={14} className="text-accent" />
                    </div>
                    <div className="mt-3 grid gap-2">
                        {[
                            { label: 'High-risk tasks', value: watchlist.high_risk_tasks, tone: 'text-danger' },
                            { label: 'Unassigned active tasks', value: watchlist.unassigned_tasks, tone: 'text-warning' },
                            { label: 'Overloaded operators', value: watchlist.overloaded_operators, tone: 'text-accent' },
                            { label: 'Reports generated', value: reportsSummary.total_reports, tone: 'text-success' },
                        ].map((item) => (
                            <div key={item.label} className="flex items-center justify-between rounded-xl border border-border/60 bg-black/10 px-3 py-2">
                                <span className="text-xs text-text-secondary">{item.label}</span>
                                <span className={`text-sm font-bold ${item.tone}`}>{item.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {ownerIntelligence && (
                    <div className="glass-card rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Owner AI Intelligence</p>
                                <p className="mt-1 text-sm font-semibold text-text-primary">Strategic guidance from live operations</p>
                            </div>
                            <Sparkles size={14} className="text-accent" />
                        </div>
                        <p className="text-xs leading-6 text-text-secondary">{ownerIntelligence.forecast?.summary}</p>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-border/60 bg-black/10 p-3">
                                <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Optimization</p>
                                <p className="mt-2 text-xs text-text-secondary">{ownerIntelligence.optimization?.summary}</p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-black/10 p-3">
                                <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Cost / Task</p>
                                <p className="mt-2 text-lg font-black text-text-primary">
                                    INR {ownerIntelligence.cost_analysis?.estimated_cost_per_task_inr ?? '--'}
                                </p>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {ownerIntelligence.recommendations?.slice(0, 3).map((item) => (
                                <div key={item} className="rounded-xl border border-border/60 bg-black/10 px-3 py-3 text-xs text-text-secondary">
                                    {item}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <form onSubmit={handleProfileSubmit} className="glass-card rounded-2xl p-4 space-y-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Company Profile</p>
                        <p className="mt-1 text-sm font-semibold text-text-primary">Keep the operating identity up to date</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                        <input
                            value={profileForm.name}
                            onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                            className="input-glass rounded-xl px-3 py-2 text-xs"
                            placeholder="Company name"
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                value={profileForm.industry_type}
                                onChange={(event) => setProfileForm((current) => ({ ...current, industry_type: event.target.value }))}
                                className="input-glass rounded-xl px-3 py-2 text-xs"
                                placeholder="Industry"
                            />
                            <input
                                value={profileForm.city}
                                onChange={(event) => setProfileForm((current) => ({ ...current, city: event.target.value }))}
                                className="input-glass rounded-xl px-3 py-2 text-xs"
                                placeholder="City"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <input
                                value={profileForm.state}
                                onChange={(event) => setProfileForm((current) => ({ ...current, state: event.target.value }))}
                                className="input-glass rounded-xl px-3 py-2 text-xs"
                                placeholder="State"
                            />
                            <input
                                value={profileForm.gst_number}
                                onChange={(event) => setProfileForm((current) => ({ ...current, gst_number: event.target.value }))}
                                className="input-glass rounded-xl px-3 py-2 text-xs"
                                placeholder="GST"
                            />
                        </div>
                        <input
                            value={profileForm.msme_number}
                            onChange={(event) => setProfileForm((current) => ({ ...current, msme_number: event.target.value }))}
                            className="input-glass rounded-xl px-3 py-2 text-xs"
                            placeholder="MSME number"
                        />
                        <textarea
                            value={profileForm.address}
                            onChange={(event) => setProfileForm((current) => ({ ...current, address: event.target.value }))}
                            className="input-glass min-h-24 rounded-xl px-3 py-2 text-xs"
                            placeholder="Registered address"
                        />
                    </div>
                    <div className="rounded-xl border border-border/60 bg-black/10 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Owner contact</p>
                        <p className="mt-1 text-xs text-text-primary">{user?.full_name || 'Owner'} · {company.owner_email}</p>
                    </div>
                    {profileError && <p className="text-[10px] text-danger">{profileError}</p>}
                    <button
                        type="submit"
                        disabled={savingCompanyProfile}
                        className="btn-primary w-full rounded-xl px-4 py-2.5 text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                        <Save size={12} />
                        {savingCompanyProfile ? 'Saving...' : 'Save Company Profile'}
                    </button>
                </form>

                <div className="glass-card rounded-2xl p-4 space-y-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Exports & Reports</p>
                        <p className="mt-1 text-sm font-semibold text-text-primary">Archive operations and share summaries</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => handleExport('csv')}
                            disabled={exportingFormat === 'csv'}
                            className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-60"
                        >
                            <Download size={12} className="inline mr-1.5" />
                            {exportingFormat === 'csv' ? 'Exporting...' : 'CSV Export'}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleExport('pdf')}
                            disabled={exportingFormat === 'pdf'}
                            className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-60"
                        >
                            <FileText size={12} className="inline mr-1.5" />
                            {exportingFormat === 'pdf' ? 'Exporting...' : 'PDF Export'}
                        </button>
                    </div>
                    <form onSubmit={handleReportSubmit} className="space-y-2 rounded-xl border border-border/60 bg-black/10 p-3">
                        <input
                            value={reportForm.title}
                            onChange={(event) => setReportForm((current) => ({ ...current, title: event.target.value }))}
                            className="input-glass w-full rounded-xl px-3 py-2 text-xs"
                            placeholder="Report title"
                        />
                        <select
                            value={reportForm.report_type}
                            onChange={(event) => setReportForm((current) => ({ ...current, report_type: event.target.value }))}
                            className="input-glass w-full rounded-xl px-3 py-2 text-xs"
                        >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="custom">Custom</option>
                        </select>
                        <div className="grid grid-cols-1 gap-2">
                            <input
                                type="datetime-local"
                                value={reportForm.period_start}
                                onChange={(event) => setReportForm((current) => ({ ...current, period_start: event.target.value }))}
                                className="input-glass rounded-xl px-3 py-2 text-xs"
                            />
                            <input
                                type="datetime-local"
                                value={reportForm.period_end}
                                onChange={(event) => setReportForm((current) => ({ ...current, period_end: event.target.value }))}
                                className="input-glass rounded-xl px-3 py-2 text-xs"
                            />
                        </div>
                        {reportError && <p className="text-[10px] text-danger">{reportError}</p>}
                        <button
                            type="submit"
                            disabled={generatingReport}
                            className="btn-primary w-full rounded-xl px-4 py-2.5 text-xs font-semibold disabled:opacity-60"
                        >
                            {generatingReport ? 'Generating...' : 'Generate Report'}
                        </button>
                    </form>
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Recent reports</p>
                            <span className="text-[10px] text-text-muted">{loadingReports ? 'Syncing...' : reports.length}</span>
                        </div>
                        <div className="mt-2 space-y-2">
                            {reports.slice(0, 4).map((report) => (
                                <div key={report.id} className="rounded-xl border border-border/60 bg-black/10 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-xs font-medium text-text-primary truncate">{report.title}</p>
                                        <span className="text-[10px] uppercase tracking-[0.16em] text-accent">{report.report_type}</span>
                                    </div>
                                    <p className="mt-1 text-[10px] text-text-muted">
                                        {formatDate(report.period_start)} to {formatDate(report.period_end)}
                                    </p>
                                </div>
                            ))}
                            {reports.length === 0 && (
                                <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center">
                                    <p className="text-xs text-text-muted">No reports yet. Generate your first owner summary.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="glass-card rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Audit Trail</p>
                            <p className="mt-1 text-sm font-semibold text-text-primary">Recent owner-visible business actions</p>
                        </div>
                        <History size={14} className="text-text-primary" />
                    </div>
                    <div className="mt-3 space-y-2">
                        {auditLogs.slice(0, 6).map((entry) => (
                            <div key={entry.id} className="rounded-xl border border-border/60 bg-black/10 px-3 py-3">
                                <p className="text-xs font-medium text-text-primary">{entry.action.replace(/\./g, ' ')}</p>
                                <p className="mt-1 text-[10px] text-text-muted">
                                    {entry.user_role ? `${entry.user_role} action` : 'System action'} · {formatDate(entry.created_at)}
                                </p>
                            </div>
                        ))}
                        {auditLogs.length === 0 && (
                            <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center">
                                <p className="text-xs text-text-muted">Audit history will appear here as the workspace changes.</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="glass-card rounded-2xl p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Owner Snapshot</p>
                    <div className="mt-3 grid gap-2">
                        <div className="flex items-center justify-between rounded-xl bg-black/10 px-3 py-2">
                            <span className="text-xs text-text-secondary">Tasks completed</span>
                            <span className="text-sm font-bold text-success">{dashboard?.tasks?.completed ?? tasks.completed}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl bg-black/10 px-3 py-2">
                            <span className="text-xs text-text-secondary">Delayed tasks</span>
                            <span className="text-sm font-bold text-danger">{dashboard?.tasks?.delayed ?? tasks.delayed}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl bg-black/10 px-3 py-2">
                            <span className="text-xs text-text-secondary">On-duty operators</span>
                            <span className="text-sm font-bold text-accent">{team.active_operators}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl bg-black/10 px-3 py-2">
                            <span className="text-xs text-text-secondary">Latest report</span>
                            <span className="text-sm font-bold text-text-primary">{formatDate(reportsSummary.latest_generated_at)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
});

export default OwnerBusinessPanel;
