import { useEffect, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { Loader, Sparkles, Plus, PlusCircle } from 'lucide-react';

const FactoryScene = lazy(() => import('../components/FactoryScene'));

function LoadingFallback() {
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
                <div className="w-12 h-12 border-2 border-accent/30 border-t-accent rounded-full animate-spin-glow mx-auto mb-4" />
                <p className="text-xs text-text-muted font-mono tracking-wider">INITIALIZING 3D ENGINE</p>
                <p className="text-[10px] text-text-muted/60 mt-1">Loading factory floor...</p>
            </div>
        </div>
    );
}

function ToastContainer() {
    const alerts = useAppStore((s) => s.alerts);
    if (alerts.length === 0) return null;

    const toastStyles = {
        info: 'border-accent/20 text-accent',
        success: 'border-success/20 text-success',
        error: 'border-danger/20 text-danger',
        warning: 'border-warning/20 text-warning',
    };

    return (
        <div className="absolute top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
            <AnimatePresence>
                {alerts.map((a) => (
                    <motion.div
                        key={a.id}
                        initial={{ opacity: 0, x: 60 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 60 }}
                        className={`glass-strong rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 ${toastStyles[a.type] || toastStyles.info}`}
                    >
                        <div className={`w-2 h-2 rounded-full bg-current ${a.type === 'error' ? 'animate-pulse-danger' : ''}`} />
                        <p className="text-sm font-medium text-text-primary">{a.message}</p>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

function FirstTimeHint() {
    const machines = useAppStore((s) => s.machines);
    const tasks = useAppStore((s) => s.tasks);
    const openAddMachineModal = useAppStore((s) => s.openAddMachineModal);
    const openAddUserModal = useAppStore((s) => s.openAddUserModal);
    const users = useAppStore((s) => s.users);
    const userRole = useAuthStore((s) => s.user?.role);
    const canCreateMachine = userRole === 'owner' || userRole === 'supervisor';
    const canCreateUser = userRole === 'owner' || userRole === 'supervisor';
    const teamCount = users.filter((user) => user.role !== 'owner').length;

    if (machines.length > 0 || tasks.length > 0 || teamCount > 0) return null;

    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                className="glass-strong rounded-2xl p-8 max-w-sm text-center pointer-events-auto shadow-2xl animate-glow-breathe"
            >
                <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center mx-auto mb-4 border border-accent/20">
                    <Sparkles size={22} className="text-accent" />
                </div>
                <h3 className="text-sm font-bold text-text-primary mb-2">Welcome to MechTrack Pulse</h3>
                <p className="text-xs text-text-muted leading-relaxed mb-5">
                    Start by adding your first team member or machine to bring the control system online.
                </p>
                <div className="flex flex-col gap-3">
                    {canCreateUser && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={openAddUserModal}
                            className="btn-ghost rounded-xl px-4 py-3 text-xs font-semibold inline-flex items-center justify-center gap-2"
                        >
                            <PlusCircle size={14} /> Add User
                        </motion.button>
                    )}
                    {canCreateMachine && (
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={openAddMachineModal}
                            className="btn-primary rounded-xl px-4 py-3 text-xs font-semibold inline-flex items-center justify-center gap-2"
                        >
                            <Plus size={14} /> Add Machine to start factory
                        </motion.button>
                    )}
                    {!canCreateMachine && !canCreateUser && (
                        <div className="flex items-center justify-center gap-2 text-[10px] text-text-muted font-mono">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                            Waiting for workspace setup...
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

export default function DashboardPage() {
    const user = useAuthStore((s) => s.user);
    const selectedMachine = useAppStore((s) => s.selectedMachine);
    const isAddMachineModalOpen = useAppStore((s) => s.isAddMachineModalOpen);
    const isCreateTaskModalOpen = useAppStore((s) => s.isCreateTaskModalOpen);
    const isAddUserModalOpen = useAppStore((s) => s.isAddUserModalOpen);
    const isGlobalAIModalOpen = useAppStore((s) => s.isGlobalAIModalOpen);
    const createTaskMachineId = useAppStore((s) => s.createTaskMachineId);
    const [isTablet, setIsTablet] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [activeTab, setActiveTab] = useState('factory');
    const userRole = user?.role;
    const isOperatorView = userRole === 'operator';
    const isClientView = userRole === 'client';

    useEffect(() => {
        const check = () => {
            setIsMobile(window.innerWidth < 768);
            setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
        };
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

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

    return (
        <div className="h-screen flex flex-col overflow-hidden relative bg-bg-primary">
            <TopBar />
            <ToastContainer />
            <FirstTimeHint />

            <AnimatePresence>
                {isAddMachineModalOpen && <AddMachineModal />}
                {isAddUserModalOpen && <AddUserModal />}
                {isCreateTaskModalOpen && <CreateTaskModal key={createTaskMachineId || 'new-task'} />}
                {isGlobalAIModalOpen && <GlobalAIAssistantModal />}
            </AnimatePresence>

            <div className="flex-1 flex overflow-hidden">
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
                            <div className="flex-1 flex flex-col items-center justify-center p-8">
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center"
                                >
                                    <div className="p-4 bg-accent/20 rounded-full mb-4 inline-flex">
                                        <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center text-3xl font-black text-white uppercase">
                                            {user?.full_name?.charAt(0)}
                                        </div>
                                    </div>
                                    <h1 className="text-xl font-bold text-text-primary capitalize">{user?.full_name}</h1>
                                    <p className="text-xs text-text-muted font-mono uppercase tracking-widest mt-1">
                                        {user?.role} · {user?.email}
                                    </p>
                                    <button
                                        onClick={() => useAuthStore.getState().logout()}
                                        className="mt-8 px-8 py-3 bg-danger text-white rounded-xl font-bold text-xs uppercase tracking-widest active:scale-95 transition-transform"
                                    >
                                        Sign Out
                                    </button>
                                </motion.div>
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

            {isMobile ? (
                <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
            ) : !isOperatorView && !isClientView ? (
                <BottomTimeline />
            ) : null}
        </div>
    );
}
