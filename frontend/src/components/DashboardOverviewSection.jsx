import { useMemo } from 'react';
import {
    Activity,
    ArrowRight,
    BarChart3,
    Brain,
    ClipboardList,
    Factory,
    ShieldCheck,
    Sparkles,
    Users,
} from 'lucide-react';
import useAppStore, { ACTIVE_TASK_STATUSES, PRIORITY_ORDER } from '../stores/appStore';
import useAuthStore from '../stores/authStore';

function StatCard({ icon: Icon, label, value, tone }) {
    return (
        <div className="premium-surface rounded-[28px] p-5">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">{label}</p>
                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tone}`}>
                    <Icon size={16} />
                </div>
            </div>
            <p className="mt-4 text-3xl font-black tracking-tight text-text-primary">{value}</p>
        </div>
    );
}

function ActionButton({ label, description, onClick, icon: Icon, tone = 'btn-ghost' }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-[24px] px-4 py-4 text-left transition-all ${tone}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
                </div>
                <Icon size={16} />
            </div>
        </button>
    );
}

function FocusRow({ title, detail, tone }) {
    return (
        <div className="rounded-[22px] border border-border/70 bg-bg-hover/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-text-primary">{title}</p>
                <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${tone}`}>Priority</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-text-secondary">{detail}</p>
        </div>
    );
}

export default function DashboardOverviewSection({ onSectionSelect }) {
    const dashboard = useAppStore((state) => state.dashboard);
    const ownerBusiness = useAppStore((state) => state.ownerBusiness);
    const tasks = useAppStore((state) => state.tasks);
    const machines = useAppStore((state) => state.machines);
    const operators = useAppStore((state) => state.operators);
    const insights = useAppStore((state) => state.insights);
    const aiProviderStatus = useAppStore((state) => state.aiProviderStatus);
    const openJobCreationModal = useAppStore((state) => state.openJobCreationModal);
    const openAddMachineModal = useAppStore((state) => state.openAddMachineModal);
    const openAddUserModal = useAppStore((state) => state.openAddUserModal);
    const openGlobalAIModal = useAppStore((state) => state.openGlobalAIModal);
    const user = useAuthStore((state) => state.user);

    const activeTasks = useMemo(
        () => tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status) || task.status === 'delayed').length,
        [tasks]
    );
    const completedTasks = useMemo(() => tasks.filter((task) => task.status === 'completed').length, [tasks]);
    const delayedTasks = useMemo(() => tasks.filter((task) => task.status === 'delayed').length, [tasks]);
    const availableOperators = useMemo(
        () => operators.filter((operator) => operator.is_on_duty && (operator.current_task_count || 0) < 5).length,
        [operators]
    );
    const priorityQueue = useMemo(() => {
        return [...tasks]
            .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99))
            .slice(0, 4);
    }, [tasks]);

    const cards = useMemo(() => {
        if (user?.role === 'operator') {
            return [
                { label: 'Work Queue', value: activeTasks, icon: ClipboardList, tone: 'bg-accent/12 text-accent' },
                { label: 'Completed', value: completedTasks, icon: ShieldCheck, tone: 'bg-success/12 text-success' },
                { label: 'Team Available', value: availableOperators, icon: Users, tone: 'bg-gold/12 text-gold' },
                { label: 'Issues', value: delayedTasks, icon: Activity, tone: 'bg-danger/12 text-danger' },
            ];
        }
        if (user?.role === 'client') {
            return [
                { label: 'Projects', value: tasks.length, icon: ClipboardList, tone: 'bg-accent/12 text-accent' },
                { label: 'Completed', value: completedTasks, icon: ShieldCheck, tone: 'bg-success/12 text-success' },
                { label: 'In Flight', value: activeTasks, icon: Factory, tone: 'bg-gold/12 text-gold' },
                { label: 'Updates', value: Math.min(tasks.length, 9), icon: BarChart3, tone: 'bg-danger/12 text-danger' },
            ];
        }
        return [
            { label: 'Total Tasks', value: dashboard?.tasks?.total ?? tasks.length, icon: ClipboardList, tone: 'bg-accent/12 text-accent' },
            { label: 'Completion', value: `${dashboard?.tasks?.completion_rate ?? ownerBusiness?.tasks?.completion_rate ?? 0}%`, icon: ShieldCheck, tone: 'bg-success/12 text-success' },
            { label: 'Machines', value: dashboard?.machines?.total ?? machines.length, icon: Factory, tone: 'bg-gold/12 text-gold' },
            { label: 'Delayed', value: dashboard?.tasks?.delayed ?? delayedTasks, icon: Activity, tone: 'bg-danger/12 text-danger' },
        ];
    }, [dashboard, delayedTasks, activeTasks, completedTasks, machines.length, ownerBusiness?.tasks?.completion_rate, tasks.length, availableOperators, user?.role]);

    const focusItems = useMemo(() => {
        if (user?.role === 'owner' && ownerBusiness) {
            return [
                {
                    title: 'Watch the current risk queue',
                    detail: `${ownerBusiness.watchlist.high_risk_tasks} high-risk tasks and ${ownerBusiness.watchlist.overloaded_operators} overloaded operators need attention.`,
                    tone: 'text-danger',
                },
                {
                    title: 'Push team capacity where it matters',
                    detail: `${ownerBusiness.team.active_operators} active operators are currently carrying execution across ${ownerBusiness.machines.total} machines.`,
                    tone: 'text-accent',
                },
                {
                    title: 'Keep reporting tight',
                    detail: `${ownerBusiness.reports?.total_reports ?? 0} reports already generated in this workspace.`,
                    tone: 'text-gold',
                },
            ];
        }

        if (insights.length > 0) {
            return insights.slice(0, 3).map((item, index) => ({
                title: item.type ? item.type.replace(/_/g, ' ') : `Insight ${index + 1}`,
                detail: item.message,
                tone: item.severity === 'critical' ? 'text-danger' : item.severity === 'warning' ? 'text-warning' : 'text-accent',
            }));
        }

        return priorityQueue.map((task, index) => ({
            title: task.title,
            detail: task.description || `Priority ${task.priority} task waiting in the queue.`,
            tone: index === 0 ? 'text-danger' : 'text-accent',
        }));
    }, [insights, ownerBusiness, priorityQueue, user?.role]);

    const actions = useMemo(() => {
        if (user?.role === 'owner') {
            return [
                { label: 'Open Operations', description: 'Jump into the live floor and machine control room.', icon: Factory, onClick: () => onSectionSelect('operations'), tone: 'btn-primary text-white' },
                { label: 'Launch AI Assistant', description: 'Ask about delays, output, or operator efficiency.', icon: Brain, onClick: openGlobalAIModal },
                { label: 'Create Job', description: 'Run the locked CNC job flow with client, drawing, AI verification, and lock.', icon: ClipboardList, onClick: () => openJobCreationModal() },
                { label: 'Grow Team', description: 'Add users and manage coverage without leaving the dashboard.', icon: Users, onClick: openAddUserModal },
            ];
        }
        if (user?.role === 'supervisor') {
            return [
                { label: 'Control Operations', description: 'Focus on machine activity and live task progress.', icon: Factory, onClick: () => onSectionSelect('operations'), tone: 'btn-primary text-white' },
                { label: 'Create Job', description: 'Run the locked CNC job flow with client, drawing, AI verification, and lock.', icon: ClipboardList, onClick: () => openJobCreationModal() },
                { label: 'Manage Team', description: 'See workloads and shift assignment decisions into one place.', icon: Users, onClick: () => onSectionSelect('team') },
                { label: 'Ask AI', description: 'Get smart assignment, delay, and bottleneck suggestions.', icon: Brain, onClick: openGlobalAIModal },
            ];
        }
        if (user?.role === 'operator') {
            return [
                { label: 'Open Work Queue', description: 'See assigned jobs, timers, uploads, and AI guidance.', icon: ClipboardList, onClick: () => onSectionSelect('tasks'), tone: 'btn-primary text-white' },
                { label: 'Talk to AI', description: 'Use the assistant for task clarity and next-step guidance.', icon: Brain, onClick: openGlobalAIModal },
                { label: 'See Team', description: 'Check who is available and who is carrying workload.', icon: Users, onClick: () => onSectionSelect('team') },
                { label: 'Review Profile', description: 'Keep your access, role, and workspace details in view.', icon: ShieldCheck, onClick: () => onSectionSelect('profile') },
            ];
        }
        return [
            { label: 'Track Projects', description: 'Open delivery progress, updates, and milestone visibility.', icon: ClipboardList, onClick: () => onSectionSelect('projects'), tone: 'btn-primary text-white' },
            { label: 'Open Updates', description: 'Read the latest progress summaries and delivery signals.', icon: BarChart3, onClick: () => onSectionSelect('updates') },
            { label: 'Ask AI', description: 'Get a readable progress summary or explanation instantly.', icon: Brain, onClick: openGlobalAIModal },
            { label: 'View Profile', description: 'Check account and company access in a calmer workspace.', icon: ShieldCheck, onClick: () => onSectionSelect('profile') },
        ];
    }, [onSectionSelect, openAddUserModal, openGlobalAIModal, openJobCreationModal, user?.role]);

    return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.95fr)]">
            <div className="space-y-4">
                <section className="premium-surface rounded-[32px] p-6 lg:p-7">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Premium workspace</p>
                            <h3 className="mt-2 font-display text-4xl leading-none text-text-primary">
                                {user?.role === 'owner'
                                    ? 'Business at a glance'
                                    : user?.role === 'supervisor'
                                        ? 'Command everything clearly'
                                        : user?.role === 'operator'
                                            ? 'Stay focused on execution'
                                            : 'Track work without the noise'}
                            </h3>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
                                The dashboard is now organized into dedicated sections so each business area opens with its own complete toolset instead of competing for the same screen.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onSectionSelect(user?.role === 'client' ? 'projects' : 'operations')}
                            className="btn-ghost inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]"
                        >
                            Open live section <ArrowRight size={14} />
                        </button>
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                    {cards.map((card) => (
                        <StatCard key={card.label} {...card} />
                    ))}
                </section>

                <section className="premium-surface rounded-[32px] p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">Quick actions</p>
                            <h4 className="mt-2 text-lg font-semibold text-text-primary">Start from what matters now</h4>
                        </div>
                        {(user?.role === 'owner' || user?.role === 'supervisor') && (
                            <button
                                type="button"
                                onClick={openAddMachineModal}
                                className="btn-ghost rounded-full px-4 py-2 text-xs font-semibold"
                            >
                                Add Machine
                            </button>
                        )}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {actions.map((action) => (
                            <ActionButton key={action.label} {...action} />
                        ))}
                    </div>
                </section>
            </div>

            <div className="space-y-4">
                <section className="premium-surface rounded-[32px] p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">Focus board</p>
                            <h4 className="mt-2 text-lg font-semibold text-text-primary">What deserves attention</h4>
                        </div>
                        <Sparkles size={16} className="text-accent" />
                    </div>
                    <div className="mt-4 space-y-3">
                        {focusItems.length > 0 ? (
                            focusItems.map((item) => <FocusRow key={`${item.title}-${item.detail}`} {...item} />)
                        ) : (
                            <p className="text-sm text-text-muted">Everything looks clean right now. No urgent focus areas.</p>
                        )}
                    </div>
                </section>

                <section className="premium-surface rounded-[32px] p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">System health</p>
                            <h4 className="mt-2 text-lg font-semibold text-text-primary">Connection and AI readiness</h4>
                        </div>
                        <Brain size={16} className={aiProviderStatus?.enabled ? 'text-success' : 'text-danger'} />
                    </div>

                    <div className="mt-4 grid gap-3">
                        <div className={`rounded-[22px] border px-4 py-3 ${aiProviderStatus?.enabled ? 'border-success/25 bg-success/8 text-success' : 'border-danger/25 bg-danger/8 text-danger'}`}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">AI</p>
                            <p className="mt-1 text-sm font-semibold">
                                {aiProviderStatus?.enabled ? 'OpenRouter is active and ready.' : 'AI is unavailable right now.'}
                            </p>
                        </div>
                        <div className="rounded-[22px] border border-border/70 bg-bg-hover/70 px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Production load</p>
                            <p className="mt-1 text-sm font-semibold text-text-primary">
                                {activeTasks} live tasks across {machines.length} machines
                            </p>
                            <p className="mt-1 text-xs text-text-secondary">
                                {availableOperators} operators currently have room for more work.
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
