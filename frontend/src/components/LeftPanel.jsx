import { memo, useMemo } from 'react';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';

const STATUS_COLORS = {
    completed: 'bg-success',
    in_progress: 'bg-warning',
    delayed: 'bg-danger animate-pulse-danger',
    idle: 'bg-idle',
};

const LeftPanel = memo(function LeftPanel() {
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

    return (
        <aside className="w-64 bg-bg-secondary border-r border-border flex flex-col shrink-0 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Machines</h2>
                        <p className="text-[10px] text-text-muted mt-0.5">{machines.length} registered</p>
                    </div>
                    {canCreateMachine ? (
                        <button
                            type="button"
                            onClick={openAddMachineModal}
                            className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_10px_18px_rgba(59,130,246,0.18)] transition hover:bg-accent-glow"
                        >
                            + Add Machine
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Machine List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {machinesWithStatus.map((m) => (
                    <button
                        key={m.id}
                        onClick={() => setSelectedMachine(m)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150 cursor-pointer ${selectedMachine?.id === m.id
                                ? 'bg-accent/15 border border-accent/30'
                                : 'hover:bg-bg-hover border border-transparent'
                            }`}
                    >
                        <div className="flex items-center gap-2.5">
                            <div className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[m.derivedStatus]}`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate">{m.name}</p>
                                <p className="text-[10px] text-text-muted">
                                    {m.machine_type || 'General'} · {m.taskCount} tasks
                                </p>
                            </div>
                        </div>
                    </button>
                ))}

                {machines.length === 0 && (
                    <div className="px-3 py-8 text-center">
                        <p className="text-xs text-text-muted">No machines yet</p>
                        {canCreateMachine ? (
                            <button
                                type="button"
                                onClick={openAddMachineModal}
                                className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/15"
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

            {/* Stats Footer */}
            <div className="px-4 py-3 border-t border-border grid grid-cols-2 gap-2">
                <div className="text-center">
                    <p className="text-lg font-bold text-text-primary">{machines.length}</p>
                    <p className="text-[10px] text-text-muted">Total</p>
                </div>
                <div className="text-center">
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
