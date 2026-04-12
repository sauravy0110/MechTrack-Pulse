import { memo, useMemo } from 'react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import { Plus, Cpu } from 'lucide-react';

const STATUS_COLORS = {
    completed: 'bg-success',
    in_progress: 'bg-warning',
    delayed: 'bg-danger animate-pulse-danger',
    idle: 'bg-idle',
};

const LeftPanel = memo(function LeftPanel({ embedded = false }) {
    const machines = useAppStore((s) => s.machines);
    const tasks = useAppStore((s) => s.tasks);
    const selectedMachine = useAppStore((s) => s.selectedMachine);
    const setSelectedMachine = useAppStore((s) => s.setSelectedMachine);
    const getMachineStatus = useAppStore((s) => s.getMachineStatus);
    const openAddMachineModal = useAppStore((s) => s.openAddMachineModal);
    const userRole = useAuthStore((s) => s.user?.role);
    const canCreateMachine = userRole === 'owner' || userRole === 'supervisor';

    const machinesWithStatus = useMemo(() => {
        return machines.map((m) => ({
            ...m,
            derivedStatus: getMachineStatus(m.id),
            taskCount: tasks.filter((t) => t.machine_id === m.id).length,
        }));
    }, [machines, tasks, getMachineStatus]);

    const shellClass = embedded
        ? 'premium-surface h-full w-[19rem] rounded-[28px] flex flex-col shrink-0 overflow-hidden'
        : 'w-64 glass border-r border-border flex flex-col shrink-0 overflow-hidden';

    return (
        <aside className={shellClass}>
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Machines</h2>
                        <p className="text-[10px] text-text-muted mt-0.5">{machines.length} registered</p>
                    </div>
                    {canCreateMachine && (
                        <button
                            type="button"
                            onClick={openAddMachineModal}
                            className="btn-primary rounded-full px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1"
                        >
                            <Plus size={10} /> Add
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {machinesWithStatus.map((m) => (
                    <button
                        key={m.id}
                        onClick={() => setSelectedMachine(m)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer group ${
                            selectedMachine?.id === m.id
                                ? 'glass-card border-accent/30 glow-accent'
                                : 'hover:bg-bg-hover border border-transparent'
                        }`}
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="relative">
                                <div className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[m.derivedStatus]}`} />
                                {m.derivedStatus === 'in_progress' && (
                                    <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${STATUS_COLORS[m.derivedStatus]} animate-ping opacity-30`} />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                                    {m.name}
                                </p>
                                <p className="text-[10px] text-text-muted">
                                    {m.machine_type || 'General'} · {m.taskCount} tasks
                                </p>
                            </div>
                        </div>
                    </button>
                ))}

                {machines.length === 0 && (
                    <div className="px-3 py-8 text-center">
                        <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mx-auto mb-3 border border-accent/20">
                            <Cpu size={18} className="text-accent" />
                        </div>
                        <p className="text-xs text-text-muted">No machines yet</p>
                        {canCreateMachine ? (
                            <button
                                type="button"
                                onClick={openAddMachineModal}
                                className="mt-4 btn-ghost rounded-xl px-4 py-3 text-xs font-semibold"
                            >
                                + Add Machine to start factory
                            </button>
                        ) : (
                            <p className="mt-4 text-[11px] leading-5 text-text-muted">
                                Owners and supervisors can add machines to this factory.
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="px-4 py-3 border-t border-border grid grid-cols-2 gap-2">
                <div className="text-center glass-card rounded-xl p-2">
                    <p className="text-lg font-bold text-text-primary">{machines.length}</p>
                    <p className="text-[10px] text-text-muted">Total</p>
                </div>
                <div className="text-center glass-card rounded-xl p-2">
                    <p className="text-lg font-bold text-success">
                        {machinesWithStatus.filter((m) => m.derivedStatus === 'in_progress').length}
                    </p>
                    <p className="text-[10px] text-text-muted">Active</p>
                </div>
            </div>
        </aside>
    );
});

export default LeftPanel;
