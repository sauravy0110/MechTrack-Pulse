import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Brain,
    ClipboardList,
    Factory,
    LayoutDashboard,
    LineChart,
    Plus,
    PlusCircle,
    ShieldUser,
    UserRound,
    Users,
} from 'lucide-react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import useWebSocket from '../hooks/useWebSocket';
import AddMachineModal from '../components/AddMachineModal';
import AddUserModal from '../components/AddUserModal';
import CreateTaskModal from '../components/CreateTaskModal';
import GlobalAIAssistantModal from '../components/GlobalAIAssistantModal';
import TopBar from '../components/TopBar';
import LeftPanel from '../components/LeftPanel';
import RightPanel from '../components/RightPanel';
import BottomTimeline from '../components/BottomTimeline';
import OperatorPanel from '../components/OperatorPanel';
import MobileBottomNav from '../components/MobileBottomNav';
import MobileTaskView from '../components/MobileTaskView';
import MobileStatsView from '../components/MobileStatsView';
import DashboardSectionMenu from '../components/DashboardSectionMenu';
import DashboardOverviewSection from '../components/DashboardOverviewSection';
import OwnerBusinessPanel from '../components/OwnerBusinessPanel';

const FactoryScene = lazy(() => import('../components/FactoryScene'));

const DESKTOP_SECTIONS = {
    owner: [
        { id: 'overview', label: 'Overview', description: 'Business snapshot and focus board', icon: LayoutDashboard },
        { id: 'operations', label: 'Operations', description: 'Factory floor, machines, and live control', icon: Factory },
        { id: 'tasks', label: 'Tasks', description: 'Dispatch, priority, and execution workspace', icon: ClipboardList },
        { id: 'team', label: 'Team', description: 'Users, workload, and access management', icon: Users },
        { id: 'business', label: 'Business', description: 'Reports, owner intelligence, and exports', icon: LineChart },
    ],
    supervisor: [
        { id: 'overview', label: 'Overview', description: 'Live command summary and key actions', icon: LayoutDashboard },
        { id: 'operations', label: 'Operations', description: 'Machine view, assignments, and monitoring', icon: Factory },
        { id: 'tasks', label: 'Tasks', description: 'Priority queue and execution controls', icon: ClipboardList },
        { id: 'team', label: 'Team', description: 'Operator workload and company access', icon: Users },
        { id: 'intelligence', label: 'Intelligence', description: 'AI signals, risk, and control insights', icon: Brain },
    ],
    operator: [
        { id: 'overview', label: 'Overview', description: 'Focused shift summary and quick actions', icon: LayoutDashboard },
        { id: 'tasks', label: 'Tasks', description: 'Assigned work, uploads, timer, and AI help', icon: ClipboardList },
        { id: 'team', label: 'Team', description: 'See availability and shift coverage', icon: Users },
        { id: 'profile', label: 'Profile', description: 'Account, role, and workspace health', icon: UserRound },
    ],
    client: [
        { id: 'overview', label: 'Overview', description: 'Project health without the clutter', icon: LayoutDashboard },
        { id: 'projects', label: 'Projects', description: 'Task progress, milestones, and status', icon: ClipboardList },
        { id: 'updates', label: 'Updates', description: 'AI summaries, reports, and transparency', icon: LineChart },
        { id: 'profile', label: 'Profile', description: 'Account and workspace access', icon: ShieldUser },
    ],
};

const MOBILE_TITLES = {
    factory: { title: 'Operations', description: 'Live factory floor and machines' },
    tasks: { title: 'Tasks', description: 'Assigned work and execution details' },
    stats: { title: 'Insights', description: 'Performance, AI, and business signals' },
    profile: { title: 'Profile', description: 'Account and workspace access' },
};

function LoadingFallback() {
    return (
        <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full border-2 border-accent/30 border-t-accent animate-spin-glow" />
                <p className="font-mono text-xs tracking-wider text-text-muted">INITIALIZING 3D ENGINE</p>
                <p className="mt-1 text-[10px] text-text-muted/60">Loading factory floor...</p>
            </div>
        </div>
    );
}

function ToastContainer() {
    const alerts = useAppStore((state) => state.alerts);
    if (alerts.length === 0) return null;

    const toastStyles = {
        info: 'border-accent/20 text-accent',
        success: 'border-success/20 text-success',
        error: 'border-danger/20 text-danger',
        warning: 'border-warning/20 text-warning',
    };

    return (
        <div className="pointer-events-none absolute right-4 top-20 z-50 flex flex-col gap-2">
            <AnimatePresence>
                {alerts.map((alert) => (
                    <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, x: 60 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 60 }}
                        className={`glass-strong flex items-center gap-3 rounded-xl px-4 py-3 shadow-2xl ${toastStyles[alert.type] || toastStyles.info}`}
                    >
                        <div className={`h-2 w-2 rounded-full bg-current ${alert.type === 'error' ? 'animate-pulse-danger' : ''}`} />
                        <p className="text-sm font-medium text-text-primary">{alert.message}</p>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

function FirstTimeHint() {
    const machines = useAppStore((state) => state.machines);
    const tasks = useAppStore((state) => state.tasks);
    const users = useAppStore((state) => state.users);
    const openAddMachineModal = useAppStore((state) => state.openAddMachineModal);
    const openAddUserModal = useAppStore((state) => state.openAddUserModal);
    const userRole = useAuthStore((state) => state.user?.role);
    const canCreateMachine = userRole === 'owner' || userRole === 'supervisor';
    const canCreateUser = userRole === 'owner' || userRole === 'supervisor';
    const teamCount = users.filter((user) => user.role !== 'owner').length;

    if (machines.length > 0 || tasks.length > 0 || teamCount > 0) return null;

    return (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                className="glass-strong pointer-events-auto max-w-sm rounded-2xl p-8 text-center shadow-2xl animate-glow-breathe"
            >
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/20 bg-accent/10">
                    <LineChart size={22} className="text-accent" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">Welcome to MechTrack Pulse</h3>
                <p className="mb-5 mt-2 text-xs leading-relaxed text-text-muted">
                    Start by adding your first team member or machine to bring the control system online.
                </p>
                <div className="flex flex-col gap-3">
                    {canCreateUser && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={openAddUserModal}
                            className="btn-ghost inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold"
                        >
                            <PlusCircle size={14} /> Add User
                        </motion.button>
                    )}
                    {canCreateMachine && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={openAddMachineModal}
                            className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold"
                        >
                            <Plus size={14} /> Add Machine to start factory
                        </motion.button>
                    )}
                    {!canCreateMachine && !canCreateUser && (
                        <div className="flex items-center justify-center gap-2 font-mono text-[10px] text-text-muted">
                            <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                            Waiting for workspace setup...
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

function OperationsEmptyState() {
    const machines = useAppStore((state) => state.machines);
    const openAddMachineModal = useAppStore((state) => state.openAddMachineModal);
    const openCreateTaskModal = useAppStore((state) => state.openCreateTaskModal);
    const userRole = useAuthStore((state) => state.user?.role);
    const canManageFactory = userRole === 'owner' || userRole === 'supervisor';

    return (
        <div className="premium-surface flex h-full min-h-[18rem] flex-col justify-between rounded-[32px] p-6">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Operations detail</p>
                <h3 className="font-display mt-3 text-3xl leading-none text-text-primary">
                    {machines.length === 0 ? 'Build the floor first' : 'Select a machine to inspect'}
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-secondary">
                    {machines.length === 0
                        ? 'Machines, assignments, and task detail open here once the factory is configured.'
                        : 'Choose a machine from the left rail to open its task queue, assignments, and workspace detail.'}
                </p>
            </div>
            {canManageFactory && (
                <div className="mt-6 flex flex-wrap gap-3">
                    {machines.length === 0 ? (
                        <button type="button" onClick={openAddMachineModal} className="btn-primary rounded-full px-5 py-3 text-xs font-semibold">
                            Add Machine
                        </button>
                    ) : (
                        <button type="button" onClick={() => openCreateTaskModal()} className="btn-primary rounded-full px-5 py-3 text-xs font-semibold">
                            Create Task
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function ProfileSection({ onSectionSelect }) {
    const user = useAuthStore((state) => state.user);
    const logout = useAuthStore((state) => state.logout);
    const aiProviderStatus = useAppStore((state) => state.aiProviderStatus);
    const wsStatus = useAppStore((state) => state.wsStatus);
    const tasks = useAppStore((state) => state.tasks);
    const machines = useAppStore((state) => state.machines);
    const ownerBusiness = useAppStore((state) => state.ownerBusiness);

    const cards = [
        { label: 'Projects', value: tasks.length },
        { label: 'Machines', value: machines.length },
        { label: 'AI', value: aiProviderStatus?.enabled ? 'On' : 'Off' },
        { label: 'Live', value: wsStatus === 'connected' ? 'Sync' : 'Retry' },
    ];

    return (
        <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1.15fr)_380px]">
            <div className="space-y-4 overflow-y-auto pr-1">
                <section className="premium-surface rounded-[32px] p-6 lg:p-7">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Account</p>
                    <h3 className="font-display mt-3 text-4xl leading-none text-text-primary">{user?.full_name}</h3>
                    <p className="mt-3 text-sm leading-6 text-text-secondary">
                        {user?.role} access is active in this workspace. This section keeps account details, connection state, and role context away from the main execution screens so the rest of the dashboard stays clean.
                    </p>

                    <div className="mt-6 grid gap-3 md:grid-cols-2">
                        <div className="rounded-[24px] border border-border/70 bg-bg-hover/70 px-4 py-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Email</p>
                            <p className="mt-2 text-sm font-semibold text-text-primary">{user?.email}</p>
                        </div>
                        <div className="rounded-[24px] border border-border/70 bg-bg-hover/70 px-4 py-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Company</p>
                            <p className="mt-2 text-sm font-semibold text-text-primary">{ownerBusiness?.company?.name || 'MechTrack workspace'}</p>
                        </div>
                    </div>
                </section>

                <section className="premium-surface rounded-[32px] p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">Jump back in</p>
                            <h4 className="mt-2 text-lg font-semibold text-text-primary">Return to the right workspace fast</h4>
                        </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {[
                            { label: 'Open Overview', description: 'Back to your calmer control summary.', target: 'overview' },
                            { label: user?.role === 'client' ? 'Open Projects' : 'Open Tasks', description: 'Go directly to active work and detail.', target: user?.role === 'client' ? 'projects' : 'tasks' },
                            { label: user?.role === 'client' ? 'Open Updates' : 'Open Team', description: 'Access the next section without clutter.', target: user?.role === 'client' ? 'updates' : 'team' },
                        ].map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                onClick={() => onSectionSelect(item.target)}
                                className="btn-ghost rounded-[24px] px-4 py-4 text-left"
                            >
                                <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                                <p className="mt-1 text-xs leading-5 text-text-muted">{item.description}</p>
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={logout}
                            className="rounded-[24px] border border-danger/25 bg-danger/8 px-4 py-4 text-left text-danger"
                        >
                            <p className="text-sm font-semibold">Sign out securely</p>
                            <p className="mt-1 text-xs leading-5 text-danger/80">Leave the workspace from a dedicated section instead of a crowded panel.</p>
                        </button>
                    </div>
                </section>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
                <section className="premium-surface rounded-[32px] p-6">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">Workspace health</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {cards.map((card) => (
                            <div key={card.label} className="rounded-[24px] border border-border/70 bg-bg-hover/70 px-4 py-4 text-center">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">{card.label}</p>
                                <p className="mt-3 text-2xl font-black tracking-tight text-text-primary">{card.value}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="premium-surface rounded-[32px] p-6">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">Status</p>
                    <div className="mt-4 space-y-3">
                        <div className={`rounded-[22px] border px-4 py-3 ${aiProviderStatus?.enabled ? 'border-success/30 bg-success/8 text-success' : 'border-danger/30 bg-danger/8 text-danger'}`}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">AI</p>
                            <p className="mt-1 text-sm font-semibold">{aiProviderStatus?.enabled ? 'AI Connected' : 'AI Unavailable'}</p>
                        </div>
                        <div className={`rounded-[22px] border px-4 py-3 ${wsStatus === 'connected' ? 'border-success/30 bg-success/8 text-success' : 'border-warning/30 bg-warning/8 text-warning'}`}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">Realtime</p>
                            <p className="mt-1 text-sm font-semibold">{wsStatus === 'connected' ? 'Live sync is healthy' : 'Live sync is reconnecting'}</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

function IntelligenceSection({ mode = 'supervisor' }) {
    const insights = useAppStore((state) => state.insights);
    const title = mode === 'client' ? 'Client update rail' : 'Supervisor signals';
    const emptyMessage = mode === 'client'
        ? 'Project updates, progress notes, and summary insights will appear here as new client-facing activity is generated.'
        : 'Insight cards will appear here as the AI engine detects delays, overload, or efficiency opportunities.';

    return (
        <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <div className="premium-surface h-full overflow-hidden rounded-[32px]">
                <MobileStatsView embedded />
            </div>
            <div className="premium-surface h-full overflow-y-auto rounded-[32px] p-6">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">AI insight rail</p>
                        <h3 className="mt-2 text-lg font-semibold text-text-primary">{title}</h3>
                    </div>
                    <Brain size={16} className="text-accent" />
                </div>
                <div className="mt-4 space-y-3">
                    {insights.length > 0 ? (
                        insights.slice(0, 8).map((insight) => (
                            <div key={insight.id || insight.message} className="rounded-[22px] border border-border/70 bg-bg-hover/70 px-4 py-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{insight.type?.replace(/_/g, ' ') || 'Insight'}</p>
                                    <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                        insight.severity === 'critical'
                                            ? 'text-danger'
                                            : insight.severity === 'warning'
                                                ? 'text-warning'
                                                : 'text-accent'
                                    }`}>
                                        {insight.severity || 'info'}
                                    </span>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-text-primary">{insight.message}</p>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm leading-6 text-text-muted">
                            {emptyMessage}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function DashboardPage() {
    const user = useAuthStore((state) => state.user);
    const selectedMachine = useAppStore((state) => state.selectedMachine);
    const isAddMachineModalOpen = useAppStore((state) => state.isAddMachineModalOpen);
    const isCreateTaskModalOpen = useAppStore((state) => state.isCreateTaskModalOpen);
    const isAddUserModalOpen = useAppStore((state) => state.isAddUserModalOpen);
    const isGlobalAIModalOpen = useAppStore((state) => state.isGlobalAIModalOpen);
    const createTaskMachineId = useAppStore((state) => state.createTaskMachineId);
    const wsStatus = useAppStore((state) => state.wsStatus);
    const aiProviderStatus = useAppStore((state) => state.aiProviderStatus);
    const [isMobile, setIsMobile] = useState(false);
    const userRole = user?.role;
    const [activeTab, setActiveTab] = useState(() => (userRole === 'owner' || userRole === 'supervisor' ? 'factory' : 'tasks'));
    const sections = useMemo(() => DESKTOP_SECTIONS[userRole] || DESKTOP_SECTIONS.owner, [userRole]);
    const [activeSection, setActiveSection] = useState('overview');

    useEffect(() => {
        const check = () => {
            setIsMobile(window.innerWidth < 768);
        };
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    useEffect(() => {
        setActiveTab(userRole === 'owner' || userRole === 'supervisor' ? 'factory' : 'tasks');
    }, [userRole]);

    useEffect(() => {
        if (!sections.some((section) => section.id === activeSection)) {
            setActiveSection(sections[0]?.id || 'overview');
        }
    }, [sections, activeSection]);

    useWebSocket(user?.company_id);

    useEffect(() => {
        const store = useAppStore.getState();
        store.fetchTasks();
        store.fetchMachines();
        store.fetchAIProviderStatus();
        if (userRole === 'owner' || userRole === 'supervisor') {
            store.fetchUsers();
            store.fetchOperators();
            store.fetchDashboard();
            store.fetchInsights();
            if (userRole === 'owner') {
                store.fetchOwnerBusinessOverview();
                store.fetchReports();
            }
        } else if (userRole === 'operator') {
            store.fetchOperators();
        }
        const interval = setInterval(() => {
            const state = useAppStore.getState();
            state.fetchAIProviderStatus();
            if (userRole === 'owner' || userRole === 'supervisor') {
                state.fetchDashboard();
                state.fetchInsights();
                if (userRole === 'owner') {
                    state.fetchOwnerBusinessOverview();
                    state.fetchReports();
                }
            }
            if (userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator') {
                state.fetchOperators();
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [userRole]);

    const currentSection = sections.find((section) => section.id === activeSection) || sections[0];
    const mobileHeader = MOBILE_TITLES[activeTab] || { title: 'Dashboard', description: 'Workspace' };
    const headerTitle = isMobile ? mobileHeader.title : currentSection?.label || 'Dashboard';
    const headerDescription = isMobile ? mobileHeader.description : currentSection?.description || 'Focused workspace';

    const renderDesktopSection = () => {
        switch (activeSection) {
            case 'overview':
                return <DashboardOverviewSection onSectionSelect={setActiveSection} />;
            case 'operations':
                return (
                    <div className="flex h-full min-h-0 flex-col gap-4">
                        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18.5rem_minmax(0,1fr)] 2xl:grid-cols-[18.5rem_minmax(0,1fr)_22rem]">
                            <LeftPanel embedded />
                            <div className="flex min-h-0 flex-col gap-4">
                                <div className="premium-surface min-h-[24rem] flex-1 overflow-hidden rounded-[32px]">
                                    <Suspense fallback={<LoadingFallback />}>
                                        <FactoryScene />
                                    </Suspense>
                                </div>
                                <div className="2xl:hidden">
                                    {selectedMachine ? <RightPanel embedded /> : <OperationsEmptyState />}
                                </div>
                            </div>
                            <div className="hidden min-h-0 2xl:block">
                                {selectedMachine ? <RightPanel embedded /> : <OperationsEmptyState />}
                            </div>
                        </div>
                        <div className="overflow-hidden rounded-[28px]">
                            <BottomTimeline />
                        </div>
                    </div>
                );
            case 'tasks':
            case 'projects':
                return (
                    <div className="premium-surface h-full overflow-hidden rounded-[32px]">
                        <MobileTaskView embedded />
                    </div>
                );
            case 'team':
                return <OperatorPanel embedded />;
            case 'business':
                return <OwnerBusinessPanel embedded />;
            case 'intelligence':
                return <IntelligenceSection />;
            case 'updates':
                return <IntelligenceSection mode="client" />;
            case 'profile':
                return <ProfileSection onSectionSelect={setActiveSection} />;
            default:
                return <DashboardOverviewSection onSectionSelect={setActiveSection} />;
        }
    };

    return (
        <div className="relative flex h-screen flex-col overflow-hidden bg-bg-primary">
            <TopBar sectionTitle={headerTitle} sectionDescription={headerDescription} />
            <ToastContainer />
            <FirstTimeHint />

            <AnimatePresence>
                {isAddMachineModalOpen && <AddMachineModal />}
                {isAddUserModalOpen && <AddUserModal />}
                {isCreateTaskModalOpen && <CreateTaskModal key={createTaskMachineId || 'new-task'} />}
                {isGlobalAIModalOpen && <GlobalAIAssistantModal />}
            </AnimatePresence>

            <div className="flex flex-1 overflow-hidden">
                {isMobile ? (
                    <>
                        {activeTab === 'factory' && (
                            <Suspense fallback={<LoadingFallback />}>
                                <FactoryScene />
                            </Suspense>
                        )}
                        {activeTab === 'tasks' && <MobileTaskView />}
                        {activeTab === 'stats' && <MobileStatsView />}
                        {activeTab === 'profile' && (
                            <div className="page-backdrop flex flex-1 flex-col overflow-y-auto p-4 pb-32">
                                <div className="premium-surface rounded-[32px] p-6">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Profile</p>
                                    <h1 className="font-display mt-3 text-4xl leading-none text-text-primary">{user?.full_name}</h1>
                                    <p className="mt-3 text-sm leading-6 text-text-secondary">
                                        {user?.role} access is active. This profile screen keeps account details out of the busy task and operations views.
                                    </p>

                                    <div className="mt-6 grid gap-3">
                                        <div className="rounded-[24px] border border-border/70 bg-bg-hover/70 px-4 py-4">
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Email</p>
                                            <p className="mt-2 text-sm font-semibold text-text-primary">{user?.email}</p>
                                        </div>
                                        <div className={`rounded-[24px] border px-4 py-4 ${aiProviderStatus?.enabled ? 'border-success/30 bg-success/8 text-success' : 'border-danger/30 bg-danger/8 text-danger'}`}>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">AI</p>
                                            <p className="mt-2 text-sm font-semibold">{aiProviderStatus?.enabled ? 'AI Connected' : 'AI Unavailable'}</p>
                                        </div>
                                        <div className={`rounded-[24px] border px-4 py-4 ${wsStatus === 'connected' ? 'border-success/30 bg-success/8 text-success' : 'border-warning/30 bg-warning/8 text-warning'}`}>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">Realtime</p>
                                            <p className="mt-2 text-sm font-semibold">{wsStatus === 'connected' ? 'Live sync is healthy' : 'Reconnecting to live updates'}</p>
                                        </div>
                                        <button
                                            onClick={() => useAuthStore.getState().logout()}
                                            className="rounded-[24px] bg-danger px-8 py-4 text-xs font-bold uppercase tracking-[0.18em] text-white transition-transform active:scale-95"
                                        >
                                            Sign Out
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="page-backdrop flex-1 overflow-hidden p-3 sm:p-4 lg:p-5">
                        <div className="dashboard-shell grid h-full gap-4 rounded-[36px] p-3 sm:p-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:p-5">
                            <div className="hidden min-h-0 lg:block">
                                <DashboardSectionMenu
                                    activeSection={activeSection}
                                    sections={sections}
                                    onChange={setActiveSection}
                                    user={user}
                                    wsStatus={wsStatus}
                                    aiProviderStatus={aiProviderStatus}
                                />
                            </div>

                            <div className="min-h-0 flex flex-col gap-4">
                                <div className="overflow-x-auto lg:hidden">
                                    <div className="flex gap-2 pb-1">
                                        {sections.map((section) => (
                                            <button
                                                key={section.id}
                                                type="button"
                                                onClick={() => setActiveSection(section.id)}
                                                className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${
                                                    activeSection === section.id ? 'section-pill-active' : 'section-pill'
                                                }`}
                                            >
                                                {section.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="premium-surface rounded-[32px] px-6 py-5">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                        <div>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Focused section</p>
                                            <h2 className="panel-title mt-3 text-text-primary">{currentSection?.label || 'Dashboard'}</h2>
                                            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">{currentSection?.description || 'Open one business area at a time for a cleaner experience.'}</p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {sections.map((section) => (
                                                <button
                                                    key={section.id}
                                                    type="button"
                                                    onClick={() => setActiveSection(section.id)}
                                                    className={`rounded-full px-4 py-2 text-[11px] font-semibold ${
                                                        activeSection === section.id ? 'section-pill-active' : 'section-pill'
                                                    }`}
                                                >
                                                    {section.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={`${userRole}-${activeSection}`}
                                        initial={{ opacity: 0, y: 14 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                        className="min-h-0 flex-1"
                                    >
                                        {renderDesktopSection()}
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {isMobile ? (
                <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
            ) : null}
        </div>
    );
}
