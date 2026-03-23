import { memo, useMemo, useState } from 'react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';

const ROLE_SECTIONS = [
    { role: 'supervisor', title: 'Supervisors' },
    { role: 'operator', title: 'Operators' },
    { role: 'client', title: 'Clients' },
];

const STATUS_CONFIG = {
    available: { label: 'Available', dot: 'bg-success', text: 'text-success' },
    busy: { label: 'Busy', dot: 'bg-warning', text: 'text-warning' },
    offline: { label: 'Offline', dot: 'bg-idle', text: 'text-text-muted' },
    active: { label: 'Active', dot: 'bg-accent', text: 'text-accent' },
};

const MAX_TASKS = 5;

function getWorkloadColor(taskCount) {
    if (taskCount >= MAX_TASKS) {
        return 'bg-danger';
    }
    if (taskCount === 0) {
        return 'bg-success';
    }
    return 'bg-warning';
}

const OperatorPanel = memo(function OperatorPanel() {
    const users = useAppStore((state) => state.users);
    const operators = useAppStore((state) => state.operators);
    const loadingUsers = useAppStore((state) => state.loadingUsers);
    const toggleDuty = useAppStore((state) => state.toggleDuty);
    const togglingDuty = useAppStore((state) => state.togglingDuty);
    const openAddUserModal = useAppStore((state) => state.openAddUserModal);
    const currentUser = useAuthStore((state) => state.user);
    const [error, setError] = useState('');

    const canManageUsers = currentUser?.role === 'owner' || currentUser?.role === 'supervisor';
    const operatorById = useMemo(
        () => Object.fromEntries(operators.map((operator) => [operator.id, operator])),
        [operators]
    );

    const teamMembers = useMemo(() => {
        if (users.length > 0) {
            return users.filter((user) => user.role !== 'owner');
        }

        if (currentUser?.role === 'operator') {
            return operators.map((operator) => ({
                ...operator,
                role: 'operator',
                is_active: true,
            }));
        }

        return [];
    }, [users, operators, currentUser?.role]);

    const groupedMembers = useMemo(() => {
        return ROLE_SECTIONS.map((section) => {
            const members = teamMembers
                .filter((member) => member.role === section.role)
                .map((member) => {
                    if (member.role !== 'operator') {
                        return member;
                    }
                    const liveOperator = operatorById[member.id];
                    return {
                        ...member,
                        ...liveOperator,
                    };
                })
                .sort((a, b) => {
                    if (section.role === 'operator') {
                        const order = { available: 0, busy: 1, offline: 2 };
                        return (order[a.status] ?? 2) - (order[b.status] ?? 2);
                    }
                    return a.full_name.localeCompare(b.full_name);
                });

            return {
                ...section,
                members,
            };
        });
    }, [teamMembers, operatorById]);

    const counts = useMemo(() => ({
        supervisors: groupedMembers.find((group) => group.role === 'supervisor')?.members.length ?? 0,
        operators: groupedMembers.find((group) => group.role === 'operator')?.members.length ?? 0,
        clients: groupedMembers.find((group) => group.role === 'client')?.members.length ?? 0,
    }), [groupedMembers]);

    const currentOperator = useMemo(
        () => groupedMembers
            .find((group) => group.role === 'operator')
            ?.members.find((operator) => operator.id === currentUser?.id) || null,
        [groupedMembers, currentUser?.id]
    );

    const handleToggleDuty = async () => {
        if (!currentUser?.id) {
            return;
        }

        setError('');
        try {
            await toggleDuty(currentUser.id);
        } catch (toggleError) {
            setError(toggleError.message || 'Unable to toggle duty right now.');
        }
    };

    const totalMembers = teamMembers.length;

    return (
        <aside className="w-64 bg-bg-secondary border-l border-border flex flex-col shrink-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Team</h2>
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-text-muted">
                            <span>{counts.supervisors} supervisors</span>
                            <span>{counts.operators} operators</span>
                            <span>{counts.clients} clients</span>
                        </div>
                    </div>
                    {canManageUsers ? (
                        <button
                            type="button"
                            onClick={openAddUserModal}
                            className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_10px_18px_rgba(59,130,246,0.18)] transition hover:bg-accent-glow"
                        >
                            + Add User
                        </button>
                    ) : null}
                </div>

                {currentUser?.role === 'operator' ? (
                    <div className="mt-3 rounded-lg border border-border bg-bg-card px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">My Duty</p>
                                <p className="mt-1 text-xs font-medium text-text-primary">
                                    {currentOperator?.is_on_duty ? 'On duty' : 'Off duty'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleToggleDuty}
                                disabled={togglingDuty}
                                className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_10px_18px_rgba(59,130,246,0.18)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {togglingDuty ? 'Updating...' : currentOperator?.is_on_duty ? 'Go Off' : 'Go On'}
                            </button>
                        </div>
                        {error ? <p className="mt-2 text-[10px] text-danger">{error}</p> : null}
                    </div>
                ) : null}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-4">
                {groupedMembers.map((group) => (
                    group.members.length > 0 ? (
                        <section key={group.role}>
                            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                {group.title}
                            </p>
                            <div className="space-y-1">
                                {group.members.map((member) => {
                                    const isCurrentUser = member.id === currentUser?.id;
                                    const operatorStatus = member.role === 'operator'
                                        ? (member.status || 'offline')
                                        : (member.is_active ? 'active' : 'offline');
                                    const statusConfig = STATUS_CONFIG[operatorStatus] || STATUS_CONFIG.offline;
                                    const taskCount = member.current_task_count || 0;
                                    const workloadColor = getWorkloadColor(taskCount);

                                    return (
                                        <div
                                            key={member.id}
                                            className={`rounded-lg border px-3 py-2.5 transition-all duration-150 ${isCurrentUser
                                                ? 'border-accent/30 bg-accent/10'
                                                : 'border-transparent hover:bg-bg-hover'
                                                }`}
                                        >
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <div className={`w-2 h-2 rounded-full ${statusConfig.dot} ${operatorStatus === 'available' ? 'animate-pulse' : ''}`} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium text-text-primary truncate">{member.full_name}</p>
                                                    <p className="text-[10px] text-text-muted truncate">{member.email}</p>
                                                </div>
                                                <div className="text-right">
                                                    <span className={`text-[9px] font-mono uppercase tracking-wider ${statusConfig.text}`}>
                                                        {statusConfig.label}
                                                    </span>
                                                    {isCurrentUser ? (
                                                        <p className="mt-0.5 text-[9px] font-mono uppercase tracking-wider text-accent">You</p>
                                                    ) : null}
                                                </div>
                                            </div>

                                            {member.role === 'operator' ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-1 bg-bg-primary rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-300 ${workloadColor}`}
                                                            style={{ width: `${Math.min((taskCount / MAX_TASKS) * 100, 100)}%` }}
                                                        />
                                                    </div>
                                                    <span className={`text-[9px] font-mono ${taskCount >= MAX_TASKS ? 'text-danger' : taskCount === 0 ? 'text-success' : 'text-warning'}`}>
                                                        {taskCount}/{MAX_TASKS}
                                                    </span>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-text-muted capitalize">
                                                    {member.role} access
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null
                ))}

                {!loadingUsers && totalMembers === 0 ? (
                    <div className="px-3 py-8 text-center">
                        <p className="text-xs text-text-muted">No team members yet</p>
                        {canManageUsers ? (
                            <button
                                type="button"
                                onClick={openAddUserModal}
                                className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/15"
                            >
                                + Add User
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </aside>
    );
});

export default OperatorPanel;
