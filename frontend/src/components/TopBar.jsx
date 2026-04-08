import { memo } from 'react';
import useAuthStore from '../stores/authStore';
import useAppStore from '../stores/appStore';
import ThemeToggle from './ThemeToggle';
import { Factory, LogOut, Plus, UserPlus } from 'lucide-react';

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
        <header className="min-h-12 glass-strong border-b border-border flex flex-wrap items-center justify-between gap-3 px-4 py-2 shrink-0">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center glow-accent">
                    <Factory size={14} className="text-white" />
                </div>
                <span className="text-sm font-bold tracking-wide text-text-primary">MECHTRACK PULSE</span>
                <div className="flex items-center gap-1.5 ml-2" title={statusLabel}>
                    <div className="relative">
                        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                        {wsStatus === 'connected' && (
                            <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-ping opacity-40" />
                        )}
                    </div>
                    <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">{statusLabel}</span>
                </div>
            </div>

            {canViewAnalytics && dashboard ? (
                <div className="hidden xl:flex items-center gap-5 text-xs font-mono">
                    {[
                        { label: 'TASKS', value: dashboard.tasks?.total || 0, color: 'text-text-primary' },
                        { label: 'DONE', value: dashboard.tasks?.completed || 0, color: 'text-success', dot: 'bg-success' },
                        { label: 'ACTIVE', value: dashboard.tasks?.in_progress || 0, color: 'text-warning', dot: 'bg-warning' },
                        { label: 'DELAYED', value: dashboard.tasks?.delayed || 0, color: 'text-danger', dot: 'bg-danger' },
                    ].map((stat) => (
                        <span key={stat.label} className={stat.color}>
                            {stat.dot && <span className={`inline-block w-1.5 h-1.5 rounded-full ${stat.dot} mr-1`} />}
                            {stat.label} <span className="font-bold ml-0.5">{stat.value}</span>
                        </span>
                    ))}
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="hidden lg:flex items-center gap-2">
                    <select
                        value={taskFilter}
                        onChange={(event) => setTaskFilter(event.target.value)}
                        className="input-glass rounded-full px-3 py-1.5 text-[11px] font-medium"
                    >
                        <option value="all">All Tasks</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="delayed">Delayed</option>
                    </select>
                    <select
                        value={taskSort}
                        onChange={(event) => setTaskSort(event.target.value)}
                        className="input-glass rounded-full px-3 py-1.5 text-[11px] font-medium"
                    >
                        <option value="priority">Sort: Priority</option>
                        <option value="time">Sort: Time</option>
                    </select>
                </div>

                {canCreateTask && (
                    <button
                        type="button"
                        onClick={() => openCreateTaskModal()}
                        className="btn-primary rounded-full px-4 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                        <Plus size={12} /> Create Task
                    </button>
                )}

                {canManageUsers && (
                    <button
                        type="button"
                        onClick={openAddUserModal}
                        className="btn-ghost rounded-full px-4 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                        <UserPlus size={12} /> Add User
                    </button>
                )}

                <ThemeToggle />

                <div className="text-right hidden sm:block ml-1">
                    <p className="text-xs font-medium text-text-primary">{user?.full_name}</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">{user?.role}</p>
                </div>
                <button
                    onClick={logout}
                    className="btn-ghost rounded-lg px-3 py-1.5 text-xs inline-flex items-center gap-1.5 cursor-pointer"
                >
                    <LogOut size={12} /> Logout
                </button>
            </div>
        </header>
    );
});

export default TopBar;
