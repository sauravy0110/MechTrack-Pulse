import { memo } from 'react';
import useAuthStore from '../stores/authStore';
import useAppStore from '../stores/appStore';
import ThemeToggle from './ThemeToggle';
import BrandLogo from './BrandLogo';
import { Brain, LogOut, Plus, RadioTower, UserPlus } from 'lucide-react';

const TopBar = memo(function TopBar({
    sectionTitle = 'Control Center',
    sectionDescription = 'Focused workspace',
    activeSection = 'overview',
}) {
    const { user, logout } = useAuthStore();
    const wsStatus = useAppStore((state) => state.wsStatus);
    const aiProviderStatus = useAppStore((state) => state.aiProviderStatus);
    const openJobCreationModal = useAppStore((state) => state.openJobCreationModal);
    const openAddUserModal = useAppStore((state) => state.openAddUserModal);
    const openGlobalAIModal = useAppStore((state) => state.openGlobalAIModal);

    const canCreateJob = user?.role === 'owner' || user?.role === 'supervisor';
    const canManageUsers = user?.role === 'owner' || user?.role === 'supervisor';
    const showCreateTask = canCreateJob && (activeSection === 'operations' || activeSection === 'tasks');
    const showAddUser = canManageUsers && activeSection === 'team';
    const statusColor = wsStatus === 'connected' ? 'bg-success' : wsStatus === 'reconnecting' ? 'bg-warning animate-pulse' : 'bg-danger';
    const statusLabel = wsStatus === 'connected' ? 'Live' : wsStatus === 'reconnecting' ? 'Reconnecting' : 'Offline';
    const aiConnected = aiProviderStatus?.enabled === true;
    const aiLabel = aiConnected ? 'AI Connected' : 'AI Unavailable';
    const aiColor = aiConnected ? 'text-success' : 'text-danger';
    const aiDot = aiConnected ? 'bg-success' : 'bg-danger';

    return (
        <header className="dashboard-shell sticky top-0 z-40 shrink-0 border-b border-border/70 px-4 py-3 sm:px-5 lg:px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <div className="lg:hidden">
                        <BrandLogo
                            size="sm"
                            title="MechTrackPulse"
                            subtitle="Precision. Progress. Performance."
                            className="min-w-0"
                            titleClassName="text-xl"
                        />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Workspace</p>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="font-display truncate text-2xl text-text-primary">{sectionTitle}</h1>
                            <p className="hidden text-sm text-text-secondary lg:block">{sectionDescription}</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="hidden items-center gap-2 xl:flex">
                        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-bg-hover/70 px-3 py-2" title={statusLabel}>
                            <div className="relative">
                                <RadioTower size={13} className="text-text-secondary" />
                                <div className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${statusColor}`} />
                            </div>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">{statusLabel}</span>
                        </div>
                        <div className={`flex items-center gap-2 rounded-full border px-3 py-2 ${aiConnected ? 'border-success/30 bg-success/6' : 'border-danger/30 bg-danger/6'}`} title={aiProviderStatus?.error || aiLabel}>
                            <div className="relative">
                                <Brain size={13} className={aiColor} />
                                <div className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${aiDot}`} />
                            </div>
                            <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${aiColor}`}>
                                {aiLabel}
                            </span>
                        </div>
                    </div>

                    {showCreateTask && (
                        <button
                            type="button"
                            onClick={openJobCreationModal}
                            className="btn-primary rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                            <Plus size={12} /> Create Job
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={openGlobalAIModal}
                        className={`rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 border ${
                            aiConnected ? 'border-success/30 bg-success/6 text-success' : 'border-danger/30 bg-danger/6 text-danger'
                        }`}
                    >
                        <Brain size={12} /> AI Assistant
                    </button>

                    {showAddUser && (
                        <button
                            type="button"
                            onClick={openAddUserModal}
                            className="btn-ghost rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                            <UserPlus size={12} /> Add User
                        </button>
                    )}

                    <ThemeToggle />

                    <div className="hidden rounded-full border border-border/70 bg-bg-hover/70 px-3 py-2 text-right sm:block">
                        <p className="text-xs font-medium text-text-primary">{user?.full_name}</p>
                        <p className="text-[10px] text-text-muted uppercase tracking-wider">{user?.role}</p>
                    </div>
                    <button
                        onClick={logout}
                        className="btn-ghost rounded-full px-4 py-2 text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                        <LogOut size={12} /> Logout
                    </button>
                </div>
            </div>
        </header>
    );
});

export default TopBar;
