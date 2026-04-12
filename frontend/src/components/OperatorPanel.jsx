import { memo, useMemo, useState } from 'react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import { UserPlus, Users, UserMinus } from 'lucide-react';

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
    if (taskCount >= MAX_TASKS) return 'bg-danger';
    if (taskCount === 0) return 'bg-success';
    return 'bg-warning';
}

const OperatorPanel = memo(function OperatorPanel({ embedded = false }) {
    const users = useAppStore((state) => state.users);
    const operators = useAppStore((state) => state.operators);
    const loadingUsers = useAppStore((state) => state.loadingUsers);
    const toggleDuty = useAppStore((state) => state.toggleDuty);
    const togglingDuty = useAppStore((state) => state.togglingDuty);
    const openAddUserModal = useAppStore((state) => state.openAddUserModal);
    const deactivateUser = useAppStore((state) => state.deactivateUser);
    const currentUser = useAuthStore((state) => state.user);
    const [error, setError] = useState('');
    const [deactivatingId, setDeactivatingId] = useState('');

    const canManageUsers = currentUser?.role === 'owner' || currentUser?.role === 'supervisor';
    const operatorById = useMemo(() => Object.fromEntries(operators.map((o) => [o.id, o])), [operators]);

    const teamMembers = useMemo(() => {
        if (users.length > 0) return users.filter((u) => u.role !== 'owner');
        if (currentUser?.role === 'operator') return operators.map((o) => ({ ...o, role: 'operator', is_active: true }));
        return [];
    }, [users, operators, currentUser?.role]);

    const groupedMembers = useMemo(() => {
        return ROLE_SECTIONS.map((section) => {
            const members = teamMembers
                .filter((m) => m.role === section.role)
                .map((m) => m.role !== 'operator' ? m : { ...m, ...operatorById[m.id] })
                .sort((a, b) => {
                    if (section.role === 'operator') { const o = { available: 0, busy: 1, offline: 2 }; return (o[a.status] ?? 2) - (o[b.status] ?? 2); }
                    return a.full_name.localeCompare(b.full_name);
                });
            return { ...section, members };
        });
    }, [teamMembers, operatorById]);

    const handleDeactivate = async (id, e) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to remove this user from the company?')) return;
        setDeactivatingId(id);
        try {
            await deactivateUser(id);
        } finally {
            setDeactivatingId('');
        }
    };

    const counts = useMemo(() => ({
        supervisors: groupedMembers.find((g) => g.role === 'supervisor')?.members.length ?? 0,
        operators: groupedMembers.find((g) => g.role === 'operator')?.members.length ?? 0,
        clients: groupedMembers.find((g) => g.role === 'client')?.members.length ?? 0,
    }), [groupedMembers]);

    const currentOperator = useMemo(
        () => groupedMembers.find((g) => g.role === 'operator')?.members.find((o) => o.id === currentUser?.id) || null,
        [groupedMembers, currentUser?.id]
    );

    const handleToggleDuty = async () => {
        if (!currentUser?.id) return;
        setError('');
        try { await toggleDuty(currentUser.id); }
        catch (e) { setError(e.message || 'Unable to toggle duty.'); }
    };

    const totalMembers = teamMembers.length;

    const shellClass = embedded
        ? 'premium-surface rounded-[28px] flex flex-col overflow-hidden'
        : 'w-64 glass border-l border-border flex flex-col shrink-0 overflow-hidden';
    const contentClass = embedded ? 'p-2 space-y-4' : 'flex-1 overflow-y-auto p-2 space-y-4';

    return (
        <aside className={shellClass}>
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Team</h2>
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-text-muted">
                            <span>{counts.supervisors} sup</span>
                            <span>{counts.operators} ops</span>
                            <span>{counts.clients} cli</span>
                        </div>
                    </div>
                    {canManageUsers && (
                        <button type="button" onClick={openAddUserModal}
                            className="btn-primary rounded-full px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
                            <UserPlus size={10} /> Add
                        </button>
                    )}
                </div>

                {currentUser?.role === 'operator' && (
                    <div className="mt-3 glass-card rounded-xl px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">My Duty</p>
                                <p className="mt-1 text-xs font-medium text-text-primary">
                                    {currentOperator?.is_on_duty ? 'On duty' : 'Off duty'}
                                </p>
                            </div>
                            <button type="button" onClick={handleToggleDuty} disabled={togglingDuty}
                                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-60 ${
                                    currentOperator?.is_on_duty ? 'btn-ghost' : 'btn-primary'
                                }`}>
                                {togglingDuty ? 'Updating...' : currentOperator?.is_on_duty ? 'Go Off' : 'Go On'}
                            </button>
                        </div>
                        {error && <p className="mt-2 text-[10px] text-danger">{error}</p>}
                    </div>
                )}
            </div>

            <div className={contentClass}>
                {groupedMembers.map((group) => (
                    group.members.length > 0 ? (
                        <section key={group.role}>
                            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">{group.title}</p>
                            <div className="space-y-1">
                                {group.members.map((member) => {
                                    const isMe = member.id === currentUser?.id;
                                    const operatorStatus = member.role === 'operator' ? (member.status || 'offline') : (member.is_active ? 'active' : 'offline');
                                    const sc = STATUS_CONFIG[operatorStatus] || STATUS_CONFIG.offline;
                                    const taskCount = member.current_task_count || 0;
                                    const wc = getWorkloadColor(taskCount);

                                    return (
                                        <div key={member.id} className={`rounded-xl border px-3 py-2.5 transition-all ${
                                            isMe ? 'glass-card border-accent/30' : 'border-transparent hover:bg-bg-hover'
                                        }`}>
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <div className="relative">
                                                    <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
                                                    {operatorStatus === 'available' && (
                                                        <div className={`absolute inset-0 w-2 h-2 rounded-full ${sc.dot} animate-ping opacity-30`} />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium text-text-primary truncate">{member.full_name}</p>
                                                    <p className="text-[10px] text-text-muted truncate">{member.email}</p>
                                                </div>
                                                <div className="text-right flex items-start justify-end gap-2">
                                                    <div>
                                                        <span className={`text-[9px] font-mono uppercase tracking-wider ${sc.text}`}>{sc.label}</span>
                                                        {isMe && <p className="mt-0.5 text-[9px] font-mono uppercase tracking-wider text-accent">You</p>}
                                                    </div>
                                                    {canManageUsers && !isMe && (
                                                        <button 
                                                            type="button" 
                                                            onClick={(e) => handleDeactivate(member.id, e)}
                                                            disabled={deactivatingId === member.id}
                                                            className="text-text-muted hover:text-danger hover:bg-danger/10 p-1.5 rounded-lg transition-all opacity-50 hover:opacity-100"
                                                            title="Remove User"
                                                        >
                                                            <UserMinus size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            {member.role === 'operator' ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-1 bg-bg-primary rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full transition-all duration-300 ${wc}`}
                                                            style={{ width: `${Math.min((taskCount / MAX_TASKS) * 100, 100)}%` }} />
                                                    </div>
                                                    <span className={`text-[9px] font-mono ${taskCount >= MAX_TASKS ? 'text-danger' : taskCount === 0 ? 'text-success' : 'text-warning'}`}>
                                                        {taskCount}/{MAX_TASKS}
                                                    </span>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-text-muted capitalize">{member.role} access</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null
                ))}

                {!loadingUsers && totalMembers === 0 && (
                    <div className="px-3 py-8 text-center">
                        <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mx-auto mb-3 border border-accent/20">
                            <Users size={18} className="text-accent" />
                        </div>
                        <p className="text-xs text-text-muted">No team members yet</p>
                        {canManageUsers && (
                            <button type="button" onClick={openAddUserModal}
                                className="mt-4 btn-ghost rounded-xl px-4 py-3 text-xs font-semibold">+ Add User</button>
                        )}
                    </div>
                )}
            </div>
        </aside>
    );
});

export default OperatorPanel;
