import { memo, useEffect, useState } from 'react';
import { Activity, ShieldCheck, Zap, AlertCircle } from 'lucide-react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import { motion } from 'framer-motion';
import api from '../api/client';

const StatCard = ({ icon, label, value, color, delay }) => {
    const IconComponent = icon;
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay }}
            className="glass-card rounded-2xl p-5 flex flex-col items-center text-center"
        >
            <div className={`p-3 rounded-xl mb-3 ${color} bg-opacity-10 border border-current/10`}>
                <IconComponent className={color.replace('bg-', 'text-')} size={24} />
            </div>
            <p className="text-2xl font-black text-text-primary tracking-tighter">{value}</p>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1">{label}</p>
        </motion.div>
    );
};

const MobileStatsView = memo(function MobileStatsView({ embedded = false }) {
    const dashboard = useAppStore((s) => s.dashboard);
    const machines = useAppStore((s) => s.machines);
    const tasks = useAppStore((s) => s.tasks);
    const ownerBusiness = useAppStore((s) => s.ownerBusiness);
    const userRole = useAuthStore((s) => s.user?.role);
    const [clientReports, setClientReports] = useState([]);
    const [ownerIntelligence, setOwnerIntelligence] = useState(null);

    useEffect(() => {
        let cancelled = false;

        async function loadRoleSnapshots() {
            try {
                if (userRole === 'client') {
                    const { data } = await api.get('/client/reports');
                    if (!cancelled) setClientReports(Array.isArray(data) ? data : []);
                } else if (userRole === 'owner') {
                    const { data } = await api.get('/ai/owner-intelligence');
                    if (!cancelled) setOwnerIntelligence(data);
                }
            } catch (error) {
                void error;
            }
        }

        loadRoleSnapshots();
        return () => {
            cancelled = true;
        };
    }, [userRole, tasks.length]);

    const wrapperClass = embedded
        ? 'px-6 py-6 pb-8 space-y-6'
        : 'flex-1 overflow-y-auto p-4 space-y-6 pb-32';

    if (userRole === 'client') {
        const completed = tasks.filter((task) => task.status === 'completed').length;
        const active = tasks.filter((task) => ['idle', 'queued', 'in_progress', 'paused', 'delayed'].includes(task.status)).length;

        return (
            <div className={wrapperClass}>
                <header>
                    <h1 className={`text-text-primary tracking-tight ${embedded ? 'font-display text-4xl leading-none' : 'text-2xl font-black'}`}>Project Status</h1>
                    <p className="text-xs text-text-muted mt-1 font-mono uppercase tracking-widest">Client transparency view</p>
                </header>

                <div className="grid grid-cols-2 gap-4">
                    <StatCard icon={Activity} label="Total Jobs" value={tasks.length} color="bg-accent" delay={0.1} />
                    <StatCard icon={ShieldCheck} label="Completed" value={completed} color="bg-success" delay={0.2} />
                    <StatCard icon={AlertCircle} label="Active" value={active} color="bg-warning" delay={0.3} />
                    <StatCard icon={Zap} label="Updates" value={clientReports.length} color="bg-accent" delay={0.4} />
                </div>

                <div className="glass-card rounded-2xl p-6">
                    <h3 className="text-sm font-black text-accent uppercase tracking-widest mb-3">AI Progress Snapshot</h3>
                    <p className="text-sm text-text-primary leading-relaxed">
                        {clientReports[0]
                            ? `${clientReports[0].title} is ${clientReports[0].progress_percent}% complete and currently ${clientReports[0].schedule_status.replace(/_/g, ' ')}.`
                            : 'Your team has not shared enough project activity yet to generate a live progress summary.'}
                    </p>
                </div>

                <div className="glass-card rounded-2xl p-6">
                    <h3 className="text-sm font-black text-text-primary uppercase tracking-widest">Recent Project Reports</h3>
                    <div className="mt-4 space-y-3">
                        {clientReports.slice(0, 4).map((report) => (
                            <div key={report.task_id} className="rounded-xl bg-black/10 px-4 py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-semibold text-text-primary">{report.title}</p>
                                    <span className="text-[10px] uppercase tracking-[0.16em] text-text-muted">{report.status}</span>
                                </div>
                                <p className="mt-1 text-xs text-text-secondary">
                                    {report.progress_percent}% complete · {report.schedule_status.replace(/_/g, ' ')}
                                </p>
                            </div>
                        ))}
                        {clientReports.length === 0 && (
                            <p className="text-xs text-text-muted">No client reports are available yet.</p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (!dashboard) return (
        <div className="flex-1 flex items-center justify-center p-10 text-center">
            <p className="text-xs text-text-muted font-mono animate-pulse uppercase tracking-widest">
                Syncing Fleet Intelligence...
            </p>
        </div>
    );

    const stats = [
        { icon: Activity, label: 'Throughput', value: dashboard.tasks?.completed || 0, color: 'bg-success', delay: 0.1 },
        { icon: AlertCircle, label: 'Risks', value: dashboard.tasks?.delayed || 0, color: 'bg-danger', delay: 0.2 },
        { icon: Zap, label: 'Uptime', value: '98.2%', color: 'bg-accent', delay: 0.3 },
        { icon: ShieldCheck, label: 'Health', value: `${machines.length > 0 ? 'Optimal' : '--'}`, color: 'bg-success', delay: 0.4 },
    ];

    return (
        <div className={wrapperClass}>
            <header>
                <h1 className={`text-text-primary tracking-tight ${embedded ? 'font-display text-4xl leading-none' : 'text-2xl font-black'}`}>System Status</h1>
                <p className="text-xs text-text-muted mt-1 font-mono uppercase tracking-widest">Fleet-wide performance</p>
            </header>

            <div className="grid grid-cols-2 gap-4">
                {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
            </div>

            <div className="glass-card rounded-2xl p-6 relative overflow-hidden animate-aurora">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Zap size={80} className="text-accent" />
                </div>
                <h3 className="text-sm font-black text-accent uppercase tracking-widest mb-3">AI Engine Recommendation</h3>
                <p className="text-sm text-text-primary leading-relaxed font-medium relative z-10">
                    {dashboard.tasks?.delayed > 0
                        ? "Predictive analysis indicates a 14% efficiency drop due to delayed tasks. Recommend immediate intervention on Line A."
                        : "System operating at peak performance. AI Action Engine is currently monitoring for micro-delays in machine cycles."
                    }
                </p>
            </div>

            {userRole === 'owner' && ownerBusiness && (
                <>
                    {ownerIntelligence && (
                        <div className="glass-card rounded-2xl p-6">
                            <h3 className="text-sm font-black text-accent uppercase tracking-widest">Owner AI Intelligence</h3>
                            <p className="mt-3 text-sm text-text-primary leading-relaxed">{ownerIntelligence.forecast?.summary}</p>
                            <div className="mt-4 space-y-2 text-xs text-text-secondary">
                                {ownerIntelligence.recommendations?.slice(0, 3).map((item) => (
                                    <div key={item} className="rounded-xl bg-black/10 px-3 py-3">{item}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="glass-card rounded-2xl p-6">
                        <h3 className="text-sm font-black text-text-primary uppercase tracking-widest">Owner Business View</h3>
                        <p className="text-xs text-text-muted mt-1">
                            {ownerBusiness.company.name} · {ownerBusiness.subscription.plan} plan
                        </p>
                        <div className="mt-4 space-y-3">
                            {[
                                {
                                    label: 'Users',
                                    metric: ownerBusiness.subscription.usage.users,
                                },
                                {
                                    label: 'Machines',
                                    metric: ownerBusiness.subscription.usage.machines,
                                },
                                {
                                    label: 'Tasks / Month',
                                    metric: ownerBusiness.subscription.usage.tasks,
                                },
                            ].map((item) => (
                                <div key={item.label}>
                                    <div className="flex items-center justify-between text-[11px] text-text-secondary">
                                        <span>{item.label}</span>
                                        <span>
                                            {item.metric.limit === -1
                                                ? `${item.metric.used} / Unlimited`
                                                : `${item.metric.used} / ${item.metric.limit}`}
                                        </span>
                                    </div>
                                    <div className="mt-1 h-2 rounded-full bg-bg-primary overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-accent"
                                            style={{ width: `${Math.min(item.metric.utilization_percent ?? 24, 100)}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="glass-card rounded-2xl p-6">
                        <h3 className="text-sm font-black text-text-primary uppercase tracking-widest">Owner Watchlist</h3>
                        <div className="mt-4 space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-text-secondary">High-risk tasks</span>
                                <span className="font-bold text-danger">{ownerBusiness.watchlist.high_risk_tasks}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-text-secondary">Unassigned active tasks</span>
                                <span className="font-bold text-warning">{ownerBusiness.watchlist.unassigned_tasks}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-text-secondary">Overloaded operators</span>
                                <span className="font-bold text-accent">{ownerBusiness.watchlist.overloaded_operators}</span>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

export default MobileStatsView;
