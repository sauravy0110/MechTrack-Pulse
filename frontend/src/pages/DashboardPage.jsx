import { useEffect, useState, lazy, Suspense } from 'react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import useWebSocket from '../hooks/useWebSocket';
import AddMachineModal from '../components/AddMachineModal';
import AddUserModal from '../components/AddUserModal';
import CreateTaskModal from '../components/CreateTaskModal';
import TopBar from '../components/TopBar';
import LeftPanel from '../components/LeftPanel';
import RightPanel from '../components/RightPanel';
import BottomTimeline from '../components/BottomTimeline';
import OperatorPanel from '../components/OperatorPanel';
import MobileBottomNav from '../components/MobileBottomNav';
import MobileTaskView from '../components/MobileTaskView';
import MobileStatsView from '../components/MobileStatsView';

// Lazy load 3D scene for performance
const FactoryScene = lazy(() => import('../components/FactoryScene'));

function LoadingFallback() {
    return (
        <div className="flex-1 flex items-center justify-center bg-bg-primary">
            <div className="text-center">
                <div className="w-10 h-10 border-2 border-accent/40 border-t-accent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-xs text-text-muted font-mono tracking-wider">INITIALIZING 3D ENGINE</p>
                <p className="text-[10px] text-text-muted/60 mt-1">Loading factory floor...</p>
            </div>
        </div>
    );
}

// ── Toast Container for Alerts ────────────────────────────
function ToastContainer() {
    const alerts = useAppStore(s => s.alerts);
    if (alerts.length === 0) return null;

    const toastStyles = {
        info: {
            container: 'border-accent/20 bg-white',
            dot: 'bg-accent',
        },
        success: {
            container: 'border-success/20 bg-white',
            dot: 'bg-success',
        },
        error: {
            container: 'border-danger/20 bg-white',
            dot: 'bg-danger',
        },
        warning: {
            container: 'border-warning/20 bg-white',
            dot: 'bg-warning',
        },
    };

    return (
        <div className="absolute top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
            {alerts.map(a => {
                const styles = toastStyles[a.type] || toastStyles.info;
                return (
                <div key={a.id} className={`${styles.container} rounded-lg px-4 py-3 shadow-2xl flex items-center gap-3 transition-opacity duration-300`}>
                    <div className={`w-2 h-2 rounded-full ${styles.dot} ${a.type === 'error' ? 'animate-pulse-danger' : ''}`} />
                    <p className="text-sm font-medium text-text-primary">{a.message}</p>
                </div>
                );
            })}
        </div>
    );
}

// ── First-Time User Hint ──────────────────────────────────
function FirstTimeHint() {
    const machines = useAppStore(s => s.machines);
    const tasks = useAppStore(s => s.tasks);
    const openAddMachineModal = useAppStore(s => s.openAddMachineModal);
    const openAddUserModal = useAppStore(s => s.openAddUserModal);
    const users = useAppStore(s => s.users);
    const userRole = useAuthStore((s) => s.user?.role);
    const canCreateMachine = userRole === 'owner' || userRole === 'supervisor';
    const canCreateUser = userRole === 'owner' || userRole === 'supervisor';
    const teamCount = users.filter((user) => user.role !== 'owner').length;

    if (machines.length > 0 || tasks.length > 0 || teamCount > 0) return null;

    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-bg-panel/95 backdrop-blur-md border border-border rounded-2xl p-8 max-w-sm text-center pointer-events-auto shadow-2xl animate-in fade-in zoom-in duration-500">
                <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <h3 className="text-sm font-bold text-text-primary mb-2">Welcome to MechTrack Pulse</h3>
                <p className="text-xs text-text-muted leading-relaxed mb-4">
                    Start by adding your first team member or machine to bring the control system online.
                </p>
                <div className="flex flex-col gap-3">
                    {canCreateUser ? (
                        <button
                            type="button"
                            onClick={openAddUserModal}
                            className="pointer-events-auto rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/15"
                        >
                            + Add User
                        </button>
                    ) : null}
                    {canCreateMachine ? (
                        <button
                            type="button"
                            onClick={openAddMachineModal}
                            className="pointer-events-auto rounded-2xl bg-accent px-4 py-3 text-xs font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.22)] transition hover:bg-accent-glow"
                        >
                            + Add Machine to start factory
                        </button>
                    ) : null}
                    {!canCreateMachine && !canCreateUser ? (
                        <div className="flex items-center justify-center gap-2 text-[10px] text-text-muted font-mono">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                            Waiting for workspace setup...
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export default function DashboardPage() {
    const user = useAuthStore((s) => s.user);
    const selectedMachine = useAppStore((s) => s.selectedMachine);
    const isAddMachineModalOpen = useAppStore((s) => s.isAddMachineModalOpen);
    const isCreateTaskModalOpen = useAppStore((s) => s.isCreateTaskModalOpen);
    const isAddUserModalOpen = useAppStore((s) => s.isAddUserModalOpen);
    const createTaskMachineId = useAppStore((s) => s.createTaskMachineId);
    const [isTablet, setIsTablet] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [activeTab, setActiveTab] = useState('factory');
    const userRole = user?.role;
    const isOperatorView = userRole === 'operator';
    const isClientView = userRole === 'client';

    // Responsive breakpoints
    useEffect(() => {
        const check = () => {
            setIsMobile(window.innerWidth < 768);
            setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
        };
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    // Connect WebSocket
    useWebSocket(user?.company_id);

    // Initial data fetch
    useEffect(() => {
        const store = useAppStore.getState();
        store.fetchTasks();
        store.fetchMachines();

        if (userRole === 'owner' || userRole === 'supervisor') {
            store.fetchUsers();
            store.fetchOperators();
            store.fetchDashboard();
            store.fetchInsights();
        } else if (userRole === 'operator') {
            store.fetchOperators();
        }

        // Periodic dashboard refresh every 30s
        const interval = setInterval(() => {
            const state = useAppStore.getState();
            if (userRole === 'owner' || userRole === 'supervisor') {
                state.fetchDashboard();
                state.fetchInsights();
            }
            if (userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator') {
                state.fetchOperators();
            }
        }, 30000);

        return () => clearInterval(interval);
    }, [userRole]);

    return (
        <div className="h-screen flex flex-col overflow-hidden relative">
            <TopBar />
            <ToastContainer />
            <FirstTimeHint />
            {isAddMachineModalOpen ? <AddMachineModal /> : null}
            {isAddUserModalOpen ? <AddUserModal /> : null}
            {isCreateTaskModalOpen ? <CreateTaskModal key={createTaskMachineId || 'new-task'} /> : null}

            <div className="flex-1 flex overflow-hidden">
                {/* Mobile Views */}
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
                            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-bg-primary/40">
                                <div className="p-4 bg-accent/20 rounded-full mb-4">
                                    <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center text-3xl font-black text-bg-primary uppercase">
                                        {user?.full_name?.charAt(0)}
                                    </div>
                                </div>
                                <h1 className="text-xl font-bold text-text-primary capitalize">{user?.full_name}</h1>
                                <p className="text-xs text-text-muted font-mono uppercase tracking-widest mt-1">{user?.role} · {user?.email}</p>
                                <button
                                    onClick={() => useAuthStore.getState().logout()}
                                    className="mt-8 px-8 py-3 bg-danger text-white rounded-xl font-bold text-xs uppercase tracking-widest active:scale-95 transition-transform"
                                >
                                    Sign Out
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        {isOperatorView ? (
                            <>
                                <MobileTaskView />
                                <OperatorPanel />
                            </>
                        ) : isClientView ? (
                            <MobileTaskView />
                        ) : (
                            <>
                                <LeftPanel />
                                <Suspense fallback={<LoadingFallback />}>
                                    <FactoryScene />
                                </Suspense>
                                {(!isTablet || selectedMachine) && <RightPanel />}
                                <OperatorPanel />
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Bottom Section */}
            {isMobile ? (
                <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
            ) : !isOperatorView && !isClientView ? (
                <BottomTimeline />
            ) : null}
        </div>
    );
}
