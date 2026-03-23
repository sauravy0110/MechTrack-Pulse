import { memo } from 'react';
import useAuthStore from '../stores/authStore';
import useAppStore from '../stores/appStore';

const TopBar = memo(function TopBar() {
    const { user, logout } = useAuthStore();
    const dashboard = useAppStore((state) => state.dashboard);
    const wsStatus = useAppStore((state) => state.wsStatus);
    const taskFilter = useAppStore((state) => state.taskFilter);
    const taskSort = useAppStore((state) => state.taskSort);
    const setTaskFilter = useAppStore((state) => state.setTaskFilter);
    const setTaskSort = useAppStore((state) => state.setTaskSort);
    const openCreateTaskModal = useAppStore((state) => state.openCreateTaskModal);
    const openAddUserModal = useAppStore((state) => state.openAddUserModal);

    const canCreateTask = user?.role === 'owner' || user?.role === 'supervisor';
    const canManageUsers = user?.role === 'owner' || user?.role === 'supervisor';
    const canViewAnalytics = user?.role === 'owner' || user?.role === 'supervisor';
    const statusColor = wsStatus === 'connected' ? 'bg-success' : wsStatus === 'reconnecting' ? 'bg-warning animate-pulse' : 'bg-danger';
    const statusLabel = wsStatus === 'connected' ? 'Live' : wsStatus === 'reconnecting' ? 'Reconnecting' : 'Offline';

    return (
        <header className="min-h-12 bg-bg-secondary border-b border-border flex flex-wrap items-center justify-between gap-3 px-4 py-2 shrink-0">
            <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-accent rounded flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                </div>
                <span className="text-sm font-bold tracking-wide text-text-primary">MECHTRACK PULSE</span>
                <div className="flex items-center gap-1.5 ml-2" title={statusLabel}>
                    <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                    <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">{statusLabel}</span>
                </div>
            </div>

            {canViewAnalytics && dashboard ? (
                <div className="hidden xl:flex items-center gap-6 text-xs font-mono">
                    <span className="text-text-secondary">
                        TASKS <span className="text-text-primary font-bold ml-1">{dashboard.tasks?.total || 0}</span>
                    </span>
                    <span className="text-success">
                        ● DONE <span className="font-bold ml-1">{dashboard.tasks?.completed || 0}</span>
                    </span>
                    <span className="text-warning">
                        ● ACTIVE <span className="font-bold ml-1">{dashboard.tasks?.in_progress || 0}</span>
                    </span>
                    <span className="text-danger">
                        ● DELAYED <span className="font-bold ml-1">{dashboard.tasks?.delayed || 0}</span>
                    </span>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="hidden lg:flex items-center gap-2">
                    <select
                        value={taskFilter}
                        onChange={(event) => setTaskFilter(event.target.value)}
                        className="rounded-full border border-border bg-bg-card px-3 py-2 text-[11px] font-medium text-text-secondary outline-none transition focus:border-accent"
                    >
                        <option value="all">All Tasks</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="delayed">Delayed</option>
                    </select>

                    <select
                        value={taskSort}
                        onChange={(event) => setTaskSort(event.target.value)}
                        className="rounded-full border border-border bg-bg-card px-3 py-2 text-[11px] font-medium text-text-secondary outline-none transition focus:border-accent"
                    >
                        <option value="priority">Sort: Priority</option>
                        <option value="time">Sort: Time</option>
                    </select>
                </div>

                {canCreateTask ? (
                    <button
                        type="button"
                        onClick={() => openCreateTaskModal()}
                        className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)] transition hover:bg-accent-glow"
                    >
                        + Create Task
                    </button>
                ) : null}

                {canManageUsers ? (
                    <button
                        type="button"
                        onClick={openAddUserModal}
                        className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-text-primary shadow-[0_12px_24px_rgba(15,23,42,0.08)] transition hover:border-accent hover:text-accent"
                    >
                        + Add User
                    </button>
                ) : null}

                <div className="text-right hidden sm:block ml-1">
                    <p className="text-xs font-medium text-text-primary">{user?.full_name}</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">{user?.role}</p>
                </div>
                <button
                    onClick={logout}
                    className="px-3 py-1.5 text-xs bg-bg-card hover:bg-bg-hover border border-border rounded transition-colors cursor-pointer"
                >
                    Logout
                </button>
            </div>
        </header>
    );
});

export default TopBar;
