import { memo, useMemo, useState } from 'react';
import useAppStore, { filterTasks, sortTasks } from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import { Plus, X, Zap } from 'lucide-react';

const PRIORITY_COLORS = { critical: 'text-danger', high: 'text-warning', medium: 'text-accent', low: 'text-text-muted' };
const FILTER_OPTIONS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'delayed', label: 'Delayed' }];
const SORT_OPTIONS = [{ value: 'priority', label: 'Priority' }, { value: 'time', label: 'Time' }];

const WORKFLOW_ACTIONS = {
    idle: [{ label: 'Start', status: 'in_progress', tone: 'btn-primary' }],
    queued: [{ label: 'Start', status: 'in_progress', tone: 'btn-primary' }],
    paused: [{ label: 'Resume', status: 'in_progress', tone: 'btn-primary' }, { label: 'Complete', status: 'completed', tone: 'bg-success text-white' }],
    delayed: [{ label: 'Recover', status: 'in_progress', tone: 'btn-primary' }, { label: 'Complete', status: 'completed', tone: 'bg-success text-white' }],
    in_progress: [
        { label: 'Complete', status: 'completed', tone: 'bg-success text-white' },
        { label: 'Pause', status: 'paused', tone: 'btn-ghost' },
        { label: 'Delay', status: 'delayed', tone: 'bg-warning/10 text-warning border border-warning/20' },
    ],
    completed: [],
};

function formatStatus(status) { return status.replace('_', ' '); }

const RightPanel = memo(function RightPanel() {
    const selectedMachine = useAppStore((s) => s.selectedMachine);
    const selectedTask = useAppStore((s) => s.selectedTask);
    const tasks = useAppStore((s) => s.tasks);
    const taskFilter = useAppStore((s) => s.taskFilter);
    const taskSort = useAppStore((s) => s.taskSort);
    const setTaskFilter = useAppStore((s) => s.setTaskFilter);
    const setTaskSort = useAppStore((s) => s.setTaskSort);
    const insights = useAppStore((s) => s.insights);
    const dashboard = useAppStore((s) => s.dashboard);
    const operators = useAppStore((s) => s.operators);
    const clearSelection = useAppStore((s) => s.clearSelection);
    const setSelectedTask = useAppStore((s) => s.setSelectedTask);
    const setSelectedMachine = useAppStore((s) => s.setSelectedMachine);
    const assignTask = useAppStore((s) => s.assignTask);
    const updateTaskStatus = useAppStore((s) => s.updateTaskStatus);
    const openCreateTaskModal = useAppStore((s) => s.openCreateTaskModal);
    const userRole = useAuthStore((s) => s.user?.role);

    const canCreateTask = userRole === 'owner' || userRole === 'supervisor';
    const canAssignTask = userRole === 'owner' || userRole === 'supervisor';
    const canControlWorkflow = userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator';

    const [assigningTaskId, setAssigningTaskId] = useState('');
    const [assignmentErrors, setAssignmentErrors] = useState({});
    const [statusUpdating, setStatusUpdating] = useState('');
    const [statusError, setStatusError] = useState('');

    const visibleTasks = useMemo(() => sortTasks(filterTasks(tasks, taskFilter), taskSort), [tasks, taskFilter, taskSort]);

    const machineTasks = useMemo(() => {
        if (!selectedMachine) return [];
        return sortTasks(filterTasks(tasks.filter((t) => t.machine_id === selectedMachine.id), taskFilter), taskSort);
    }, [selectedMachine, tasks, taskFilter, taskSort]);

    const operatorById = useMemo(() => Object.fromEntries(operators.map((o) => [o.id, o])), [operators]);

    const recommendedOperatorId = useMemo(() => {
        return operators.filter((o) => o.is_on_duty && o.current_task_count < 5)
            .sort((a, b) => { const d = (a.current_task_count || 0) - (b.current_task_count || 0); return d !== 0 ? d : a.full_name.localeCompare(b.full_name); })[0]?.id || '';
    }, [operators]);

    const getOperatorOptions = (task) => {
        return [...operators].sort((a, b) => {
            const aA = a.is_on_duty && a.current_task_count < 5 ? 0 : 1;
            const bA = b.is_on_duty && b.current_task_count < 5 ? 0 : 1;
            if (aA !== bA) return aA - bA;
            const d = (a.current_task_count || 0) - (b.current_task_count || 0);
            return d !== 0 ? d : a.full_name.localeCompare(b.full_name);
        }).map((o) => {
            const isCurrentAssignee = task.assigned_to && o.id === task.assigned_to;
            const isAvailable = o.is_on_duty && o.current_task_count < 5;
            const disabled = !isCurrentAssignee && !isAvailable;
            const workload = `${o.current_task_count || 0}/5`;
            const recommendation = o.id === recommendedOperatorId && isAvailable ? ' ★' : '';
            const availabilityLabel = !o.is_on_duty ? ' Offline' : (o.current_task_count || 0) >= 5 ? ' Full' : o.status === 'available' ? ' Available' : ' Busy';
            return { ...o, disabled, label: `${o.full_name} (${workload})${availabilityLabel}${recommendation}` };
        });
    };

    const handleAssign = async (taskId, assigneeId) => {
        if (!assigneeId) return;
        setAssigningTaskId(taskId);
        setAssignmentErrors((c) => ({ ...c, [taskId]: '' }));
        try { await assignTask(taskId, assigneeId); }
        catch (error) { setAssignmentErrors((c) => ({ ...c, [taskId]: error.message || 'Unable to assign.' })); }
        finally { setAssigningTaskId(''); }
    };

    const handleStatusChange = async (taskId, nextStatus) => {
        setStatusUpdating(taskId);
        setStatusError('');
        try { await updateTaskStatus(taskId, nextStatus); }
        catch (error) { setStatusError(error.message || 'Unable to update.'); }
        finally { setStatusUpdating(''); }
    };

    if (selectedMachine) {
        return (
            <aside className="w-72 glass border-l border-border flex flex-col shrink-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Machine Detail</h2>
                        <p className="text-[10px] text-text-muted mt-1">{machineTasks.length} tasks · {taskFilter}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {canCreateTask && (
                            <button type="button" onClick={() => openCreateTaskModal(selectedMachine.id)}
                                className="btn-primary rounded-full px-3 py-1 text-[11px] font-semibold inline-flex items-center gap-1">
                                <Plus size={10} /> Task
                            </button>
                        )}
                        <button onClick={clearSelection} className="text-text-muted hover:text-text-primary transition-colors cursor-pointer p-1 rounded-full hover:bg-bg-hover">
                            <X size={14} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="glass-card rounded-xl p-3">
                        <p className="text-sm font-semibold text-text-primary">{selectedMachine.name}</p>
                        <p className="text-xs text-text-muted mt-1">{selectedMachine.machine_type || 'General'}</p>
                        <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                            <span>Grid: ({selectedMachine.grid_x}, {selectedMachine.grid_y})</span>
                            <span className="capitalize">{selectedMachine.status}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} className="input-glass rounded-lg px-3 py-2 text-xs">
                            {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <select value={taskSort} onChange={(e) => setTaskSort(e.target.value)} className="input-glass rounded-lg px-3 py-2 text-xs">
                            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>

                    <div>
                        <p className="text-xs font-bold text-text-secondary uppercase mb-2">Tasks ({machineTasks.length})</p>
                        <div className="space-y-2">
                            {machineTasks.map((task) => {
                                const operatorOptions = getOperatorOptions(task);
                                const assignedOperator = operatorById[task.assigned_to];
                                const hasAvailableOperator = operatorOptions.some((o) => !o.disabled);
                                return (
                                    <div key={task.id} className={`rounded-xl border p-3 transition-all ${
                                        selectedTask?.id === task.id ? 'glass-card border-accent/30 glow-accent' : 'glass-card'
                                    }`}>
                                        <button type="button" onClick={() => setSelectedTask(task)} className="w-full text-left cursor-pointer">
                                            <p className="text-xs font-medium text-text-primary truncate">{task.title}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[10px] font-mono uppercase ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                                                <span className={`text-[10px] capitalize status-${task.status.replace('_', '-')}`}>{formatStatus(task.status)}</span>
                                            </div>
                                        </button>
                                        {canAssignTask && (
                                            <div className="mt-3">
                                                <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">Assign</label>
                                                <select value={task.assigned_to || ''} onChange={(e) => handleAssign(task.id, e.target.value)}
                                                    disabled={assigningTaskId === task.id || !hasAvailableOperator}
                                                    className="input-glass w-full rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60">
                                                    <option value="">{hasAvailableOperator ? 'Select operator' : 'No available operators'}</option>
                                                    {operatorOptions.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>)}
                                                </select>
                                                <p className="mt-1 text-[10px] text-text-muted">{assignedOperator ? `Assigned to ${assignedOperator.full_name}` : 'On‑duty operators with capacity.'}</p>
                                                {assignmentErrors[task.id] && <p className="mt-1 text-[10px] text-danger">{assignmentErrors[task.id]}</p>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {machineTasks.length === 0 && (
                                <div className="rounded-xl border border-dashed border-border glass-card px-4 py-6 text-center">
                                    <p className="text-xs text-text-muted">No tasks assigned yet.</p>
                                    {canCreateTask && (
                                        <button type="button" onClick={() => openCreateTaskModal(selectedMachine.id)}
                                            className="mt-3 btn-primary rounded-xl px-4 py-2.5 text-xs font-semibold">+ Create Task</button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {selectedTask && (
                        <div className="glass-card rounded-xl p-3 border-accent/20 glow-accent">
                            <p className="text-xs font-bold text-accent uppercase mb-2">Task Detail</p>
                            <p className="text-sm font-medium text-text-primary">{selectedTask.title}</p>
                            {selectedTask.description && <p className="text-xs text-text-secondary mt-1">{selectedTask.description}</p>}
                            <div className="mt-3 space-y-1.5 text-xs text-text-secondary">
                                <div className="flex justify-between"><span>Status</span><span className={`capitalize status-${selectedTask.status.replace('_', '-')}`}>{formatStatus(selectedTask.status)}</span></div>
                                <div className="flex justify-between"><span>Priority</span><span className={PRIORITY_COLORS[selectedTask.priority]}>{selectedTask.priority}</span></div>
                                <div className="flex justify-between"><span>Operator</span><span className="text-text-primary">{operatorById[selectedTask.assigned_to]?.full_name || 'Unassigned'}</span></div>
                                {selectedTask.delay_probability != null && (
                                    <div className="flex justify-between"><span>Delay Risk</span><span className={selectedTask.delay_probability > 0.5 ? 'text-danger' : 'text-success'}>{(selectedTask.delay_probability * 100).toFixed(0)}%</span></div>
                                )}
                            </div>

                            {canAssignTask && (
                                <div className="mt-4 space-y-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Assign Operator</p>
                                    {(() => {
                                        const opts = getOperatorOptions(selectedTask);
                                        const hasAvailable = opts.some((o) => !o.disabled);
                                        return (
                                            <select value={selectedTask.assigned_to || ''} onChange={(e) => handleAssign(selectedTask.id, e.target.value)}
                                                disabled={assigningTaskId === selectedTask.id || !hasAvailable}
                                                className="input-glass w-full rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60">
                                                <option value="">{hasAvailable ? 'Select operator' : 'No available operators'}</option>
                                                {opts.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>)}
                                            </select>
                                        );
                                    })()}
                                    {assignmentErrors[selectedTask.id] && <p className="text-[10px] text-danger">{assignmentErrors[selectedTask.id]}</p>}
                                </div>
                            )}

                            {canControlWorkflow && (
                                <div className="mt-4 space-y-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Workflow</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {(WORKFLOW_ACTIONS[selectedTask.status] || []).map((action) => (
                                            <button key={action.status} type="button"
                                                onClick={() => handleStatusChange(selectedTask.id, action.status)}
                                                disabled={statusUpdating === selectedTask.id}
                                                className={`${action.tone} rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${action.status === 'completed' ? 'col-span-2' : ''}`}>
                                                {statusUpdating === selectedTask.id ? 'Updating...' : action.label}
                                            </button>
                                        ))}
                                    </div>
                                    {statusError && <p className="text-[10px] text-danger">{statusError}</p>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </aside>
        );
    }

    return (
        <aside className="w-72 glass border-l border-border flex flex-col shrink-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Overview</h2>
                    {canCreateTask && (
                        <button type="button" onClick={() => openCreateTaskModal()}
                            className="btn-primary rounded-full px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
                            <Plus size={10} /> Task
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                    <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} className="input-glass rounded-lg px-3 py-2 text-xs">
                        {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <select value={taskSort} onChange={(e) => setTaskSort(e.target.value)} className="input-glass rounded-lg px-3 py-2 text-xs">
                        {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>

                {dashboard && (
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { label: 'Tasks', value: dashboard.tasks?.total, color: 'text-text-primary' },
                            { label: 'Done', value: dashboard.tasks?.completed, color: 'text-success' },
                            { label: 'Active', value: dashboard.tasks?.in_progress, color: 'text-warning' },
                            { label: 'Delayed', value: dashboard.tasks?.delayed, color: 'text-danger' },
                            { label: 'Machines', value: dashboard.machines?.total, color: 'text-accent' },
                            { label: 'Operators', value: dashboard.users?.operators, color: 'text-text-primary' },
                        ].map((stat) => (
                            <div key={stat.label} className="glass-card rounded-xl p-2.5 text-center">
                                <p className={`text-lg font-bold ${stat.color}`}>{stat.value ?? 0}</p>
                                <p className="text-[10px] text-text-muted uppercase">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                )}

                <div>
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-text-secondary uppercase">Task Queue</p>
                        <span className="text-[10px] text-text-muted">{visibleTasks.length} visible</span>
                    </div>
                    <div className="space-y-1.5">
                        {visibleTasks.slice(0, 6).map((task) => (
                            <button key={task.id} type="button"
                                onClick={() => {
                                    setSelectedTask(task);
                                    const machine = task.machine_id ? useAppStore.getState().machines.find((i) => i.id === task.machine_id) : null;
                                    if (machine) setSelectedMachine(machine);
                                }}
                                className="w-full glass-card rounded-xl px-3 py-2 text-left transition">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-text-primary truncate">{task.title}</p>
                                    <span className={`text-[10px] font-mono uppercase ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                                </div>
                                <p className="mt-1 text-[10px] capitalize text-text-muted">{formatStatus(task.status)}</p>
                            </button>
                        ))}
                        {visibleTasks.length === 0 && (
                            <div className="rounded-xl border border-dashed border-border glass-card px-4 py-6 text-center">
                                <p className="text-xs text-text-muted">No tasks match the current filter.</p>
                                {canCreateTask && (
                                    <button type="button" onClick={() => openCreateTaskModal()}
                                        className="mt-3 btn-primary rounded-xl px-4 py-2.5 text-xs font-semibold">+ Create Task</button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <p className="text-xs font-bold text-text-secondary uppercase mb-2">AI Insights</p>
                    <div className="space-y-1.5">
                        {insights.slice(0, 5).map((insight) => (
                            <div key={insight.id}
                                className={`px-3 py-2 rounded-lg border text-xs glass-card ${
                                    insight.severity === 'critical' ? 'border-danger/30 text-danger glow-danger'
                                    : insight.severity === 'warning' ? 'border-warning/30 text-warning'
                                    : 'text-text-secondary'
                                }`}>
                                <div className="flex items-start gap-2">
                                    <Zap size={10} className="mt-0.5 shrink-0" />
                                    <span>{insight.message}</span>
                                </div>
                            </div>
                        ))}
                        {insights.length === 0 && <p className="text-xs text-text-muted text-center py-4">No insights yet</p>}
                    </div>
                </div>
            </div>
        </aside>
    );
});

export default RightPanel;
