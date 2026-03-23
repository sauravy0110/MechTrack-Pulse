import { memo, useMemo, useState } from 'react';
import useAppStore, { filterTasks, sortTasks } from '../stores/appStore';
import useAuthStore from '../stores/authStore';

const PRIORITY_COLORS = {
    critical: 'text-danger',
    high: 'text-warning',
    medium: 'text-accent',
    low: 'text-text-muted',
};

const FILTER_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
    { value: 'delayed', label: 'Delayed' },
];

const SORT_OPTIONS = [
    { value: 'priority', label: 'Priority' },
    { value: 'time', label: 'Time' },
];

const WORKFLOW_ACTIONS = {
    idle: [{ label: 'Start', status: 'in_progress', tone: 'bg-accent text-white' }],
    queued: [{ label: 'Start', status: 'in_progress', tone: 'bg-accent text-white' }],
    paused: [
        { label: 'Resume', status: 'in_progress', tone: 'bg-accent text-white' },
        { label: 'Complete', status: 'completed', tone: 'bg-success text-white' },
    ],
    delayed: [
        { label: 'Recover', status: 'in_progress', tone: 'bg-accent text-white' },
        { label: 'Complete', status: 'completed', tone: 'bg-success text-white' },
    ],
    in_progress: [
        { label: 'Complete', status: 'completed', tone: 'bg-success text-white' },
        { label: 'Pause', status: 'paused', tone: 'bg-bg-card text-text-primary border border-border' },
        { label: 'Delay', status: 'delayed', tone: 'bg-bg-card text-warning border border-warning/20' },
    ],
    completed: [],
};

function formatStatus(status) {
    return status.replace('_', ' ');
}

const RightPanel = memo(function RightPanel() {
    const selectedMachine = useAppStore((state) => state.selectedMachine);
    const selectedTask = useAppStore((state) => state.selectedTask);
    const tasks = useAppStore((state) => state.tasks);
    const taskFilter = useAppStore((state) => state.taskFilter);
    const taskSort = useAppStore((state) => state.taskSort);
    const setTaskFilter = useAppStore((state) => state.setTaskFilter);
    const setTaskSort = useAppStore((state) => state.setTaskSort);
    const insights = useAppStore((state) => state.insights);
    const dashboard = useAppStore((state) => state.dashboard);
    const operators = useAppStore((state) => state.operators);
    const clearSelection = useAppStore((state) => state.clearSelection);
    const setSelectedTask = useAppStore((state) => state.setSelectedTask);
    const setSelectedMachine = useAppStore((state) => state.setSelectedMachine);
    const assignTask = useAppStore((state) => state.assignTask);
    const updateTaskStatus = useAppStore((state) => state.updateTaskStatus);
    const openCreateTaskModal = useAppStore((state) => state.openCreateTaskModal);
    const userRole = useAuthStore((state) => state.user?.role);

    const canCreateTask = userRole === 'owner' || userRole === 'supervisor';
    const canAssignTask = userRole === 'owner' || userRole === 'supervisor';
    const canControlWorkflow = userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator';

    const [assigningTaskId, setAssigningTaskId] = useState('');
    const [assignmentErrors, setAssignmentErrors] = useState({});
    const [statusUpdating, setStatusUpdating] = useState('');
    const [statusError, setStatusError] = useState('');

    const visibleTasks = useMemo(
        () => sortTasks(filterTasks(tasks, taskFilter), taskSort),
        [tasks, taskFilter, taskSort]
    );

    const machineTasks = useMemo(() => {
        if (!selectedMachine) {
            return [];
        }

        return sortTasks(
            filterTasks(
                tasks.filter((task) => task.machine_id === selectedMachine.id),
                taskFilter
            ),
            taskSort
        );
    }, [selectedMachine, tasks, taskFilter, taskSort]);

    const operatorById = useMemo(
        () => Object.fromEntries(operators.map((operator) => [operator.id, operator])),
        [operators]
    );

    const recommendedOperatorId = useMemo(() => {
        return operators
            .filter((operator) => operator.is_on_duty && operator.current_task_count < 5)
            .sort((a, b) => {
                const loadDiff = (a.current_task_count || 0) - (b.current_task_count || 0);
                if (loadDiff !== 0) {
                    return loadDiff;
                }
                return a.full_name.localeCompare(b.full_name);
            })[0]?.id || '';
    }, [operators]);

    const getOperatorOptions = (task) => {
        return [...operators].sort((a, b) => {
            const availabilityA = a.is_on_duty && a.current_task_count < 5 ? 0 : 1;
            const availabilityB = b.is_on_duty && b.current_task_count < 5 ? 0 : 1;
            if (availabilityA !== availabilityB) {
                return availabilityA - availabilityB;
            }

            const loadDiff = (a.current_task_count || 0) - (b.current_task_count || 0);
            if (loadDiff !== 0) {
                return loadDiff;
            }

            return a.full_name.localeCompare(b.full_name);
        }).map((operator) => {
            const isCurrentAssignee = task.assigned_to && operator.id === task.assigned_to;
            const isAvailable = operator.is_on_duty && operator.current_task_count < 5;
            const disabled = !isCurrentAssignee && !isAvailable;
            const workload = `${operator.current_task_count || 0}/5`;
            const recommendation = operator.id === recommendedOperatorId && isAvailable ? ' Recommended' : '';
            const availabilityLabel = !operator.is_on_duty
                ? ' Offline'
                : (operator.current_task_count || 0) >= 5
                    ? ' Full'
                    : operator.status === 'available'
                        ? ' Available'
                        : ' Busy';

            return {
                ...operator,
                disabled,
                label: `${operator.full_name} (${workload})${availabilityLabel}${recommendation}`,
            };
        });
    };

    const handleAssign = async (taskId, assigneeId) => {
        if (!assigneeId) {
            return;
        }

        setAssigningTaskId(taskId);
        setAssignmentErrors((current) => ({ ...current, [taskId]: '' }));

        try {
            await assignTask(taskId, assigneeId);
        } catch (error) {
            setAssignmentErrors((current) => ({
                ...current,
                [taskId]: error.message || 'Unable to assign operator.',
            }));
        } finally {
            setAssigningTaskId('');
        }
    };

    const handleStatusChange = async (taskId, nextStatus) => {
        setStatusUpdating(taskId);
        setStatusError('');

        try {
            await updateTaskStatus(taskId, nextStatus);
        } catch (error) {
            setStatusError(error.message || 'Unable to update workflow.');
        } finally {
            setStatusUpdating('');
        }
    };

    if (selectedMachine) {
        return (
            <aside className="w-72 bg-bg-secondary border-l border-border flex flex-col shrink-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Machine Detail</h2>
                        <p className="text-[10px] text-text-muted mt-1">
                            {machineTasks.length} visible tasks · {taskFilter} filter
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {canCreateTask ? (
                            <button
                                type="button"
                                onClick={() => openCreateTaskModal(selectedMachine.id)}
                                className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_10px_18px_rgba(59,130,246,0.18)] transition hover:bg-accent-glow"
                            >
                                + Task
                            </button>
                        ) : null}
                        <button onClick={clearSelection} className="text-text-muted hover:text-text-primary text-lg cursor-pointer">×</button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="bg-bg-card rounded-lg p-3 border border-border">
                        <p className="text-sm font-semibold text-text-primary">{selectedMachine.name}</p>
                        <p className="text-xs text-text-muted mt-1">{selectedMachine.machine_type || 'General'}</p>
                        <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                            <span>Grid: ({selectedMachine.grid_x}, {selectedMachine.grid_y})</span>
                            <span className="capitalize">{selectedMachine.status}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <select
                            value={taskFilter}
                            onChange={(event) => setTaskFilter(event.target.value)}
                            className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-secondary outline-none transition focus:border-accent"
                        >
                            {FILTER_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <select
                            value={taskSort}
                            onChange={(event) => setTaskSort(event.target.value)}
                            className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-secondary outline-none transition focus:border-accent"
                        >
                            {SORT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <p className="text-xs font-bold text-text-secondary uppercase mb-2">
                            Tasks ({machineTasks.length})
                        </p>
                        <div className="space-y-2">
                            {machineTasks.map((task) => {
                                const operatorOptions = getOperatorOptions(task);
                                const assignedOperator = operatorById[task.assigned_to];
                                const hasAvailableOperator = operatorOptions.some((operator) => !operator.disabled);

                                return (
                                    <div
                                        key={task.id}
                                        className={`rounded-lg border p-3 transition-colors ${selectedTask?.id === task.id
                                            ? 'bg-accent/10 border-accent/30'
                                            : 'bg-bg-card border-border hover:bg-bg-hover'
                                            }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setSelectedTask(task)}
                                            className="w-full text-left cursor-pointer"
                                        >
                                            <p className="text-xs font-medium text-text-primary truncate">{task.title}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[10px] font-mono uppercase ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                                                <span className={`text-[10px] capitalize status-${task.status.replace('_', '-')}`}>{formatStatus(task.status)}</span>
                                            </div>
                                        </button>

                                        {canAssignTask ? (
                                            <div className="mt-3">
                                                <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">
                                                    Assign Operator
                                                </label>
                                                <select
                                                    value={task.assigned_to || ''}
                                                    onChange={(event) => handleAssign(task.id, event.target.value)}
                                                    disabled={assigningTaskId === task.id || !hasAvailableOperator}
                                                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-primary outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <option value="">
                                                        {hasAvailableOperator ? 'Select operator' : 'No available operators'}
                                                    </option>
                                                    {operatorOptions.map((operator) => (
                                                        <option key={operator.id} value={operator.id} disabled={operator.disabled}>
                                                            {operator.label}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="mt-1 text-[10px] text-text-muted">
                                                    {assignedOperator
                                                        ? `Assigned to ${assignedOperator.full_name}`
                                                        : 'Only on-duty operators with capacity can take a new task.'}
                                                </p>
                                                {assignmentErrors[task.id] ? (
                                                    <p className="mt-1 text-[10px] text-danger">{assignmentErrors[task.id]}</p>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}

                            {machineTasks.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-6 text-center">
                                    <p className="text-xs text-text-muted">No tasks assigned to this machine yet.</p>
                                    {canCreateTask ? (
                                        <button
                                            type="button"
                                            onClick={() => openCreateTaskModal(selectedMachine.id)}
                                            className="mt-3 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.22)] transition hover:bg-accent-glow"
                                        >
                                            + Create Task
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {selectedTask ? (
                        <div className="bg-bg-card rounded-lg p-3 border border-accent/20">
                            <p className="text-xs font-bold text-accent uppercase mb-2">Task Detail</p>
                            <p className="text-sm font-medium text-text-primary">{selectedTask.title}</p>
                            {selectedTask.description ? (
                                <p className="text-xs text-text-secondary mt-1">{selectedTask.description}</p>
                            ) : null}
                            <div className="mt-3 space-y-1.5 text-xs text-text-secondary">
                                <div className="flex justify-between">
                                    <span>Status</span>
                                    <span className={`capitalize status-${selectedTask.status.replace('_', '-')}`}>
                                        {formatStatus(selectedTask.status)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Priority</span>
                                    <span className={PRIORITY_COLORS[selectedTask.priority]}>{selectedTask.priority}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Operator</span>
                                    <span className="text-text-primary">{operatorById[selectedTask.assigned_to]?.full_name || 'Unassigned'}</span>
                                </div>
                                {selectedTask.delay_probability != null ? (
                                    <div className="flex justify-between">
                                        <span>Delay Risk</span>
                                        <span className={selectedTask.delay_probability > 0.5 ? 'text-danger' : 'text-success'}>
                                            {(selectedTask.delay_probability * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                ) : null}
                            </div>

                            {canAssignTask ? (
                                <div className="mt-4 space-y-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Assign Operator</p>
                                    {(() => {
                                        const operatorOptions = getOperatorOptions(selectedTask);
                                        const hasAvailableOperator = operatorOptions.some((operator) => !operator.disabled);

                                        return (
                                    <select
                                        value={selectedTask.assigned_to || ''}
                                        onChange={(event) => handleAssign(selectedTask.id, event.target.value)}
                                        disabled={assigningTaskId === selectedTask.id || !hasAvailableOperator}
                                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-primary outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <option value="">
                                            {hasAvailableOperator ? 'Select operator' : 'No available operators'}
                                        </option>
                                        {operatorOptions.map((operator) => (
                                            <option key={operator.id} value={operator.id} disabled={operator.disabled}>
                                                {operator.label}
                                            </option>
                                        ))}
                                    </select>
                                        );
                                    })()}
                                    {assignmentErrors[selectedTask.id] ? (
                                        <p className="text-[10px] text-danger">{assignmentErrors[selectedTask.id]}</p>
                                    ) : null}
                                </div>
                            ) : null}

                            {canControlWorkflow ? (
                                <div className="mt-4 space-y-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Workflow control</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {(WORKFLOW_ACTIONS[selectedTask.status] || []).map((action) => (
                                            <button
                                                key={action.status}
                                                type="button"
                                                onClick={() => handleStatusChange(selectedTask.id, action.status)}
                                                disabled={statusUpdating === selectedTask.id}
                                                className={`${action.tone} rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${action.status === 'completed' ? 'col-span-2' : ''}`}
                                            >
                                                {statusUpdating === selectedTask.id ? 'Updating...' : action.label}
                                            </button>
                                        ))}
                                    </div>
                                    {statusError ? <p className="text-[10px] text-danger">{statusError}</p> : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </aside>
        );
    }

    return (
        <aside className="w-72 bg-bg-secondary border-l border-border flex flex-col shrink-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Overview</h2>
                    {canCreateTask ? (
                        <button
                            type="button"
                            onClick={() => openCreateTaskModal()}
                            className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_10px_18px_rgba(59,130,246,0.18)] transition hover:bg-accent-glow"
                        >
                            + Task
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                    <select
                        value={taskFilter}
                        onChange={(event) => setTaskFilter(event.target.value)}
                        className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-secondary outline-none transition focus:border-accent"
                    >
                        {FILTER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <select
                        value={taskSort}
                        onChange={(event) => setTaskSort(event.target.value)}
                        className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-secondary outline-none transition focus:border-accent"
                    >
                        {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>

                {dashboard ? (
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { label: 'Tasks', value: dashboard.tasks?.total, color: 'text-text-primary' },
                            { label: 'Done', value: dashboard.tasks?.completed, color: 'text-success' },
                            { label: 'Active', value: dashboard.tasks?.in_progress, color: 'text-warning' },
                            { label: 'Delayed', value: dashboard.tasks?.delayed, color: 'text-danger' },
                            { label: 'Machines', value: dashboard.machines?.total, color: 'text-accent' },
                            { label: 'Operators', value: dashboard.users?.operators, color: 'text-text-primary' },
                        ].map((stat) => (
                            <div key={stat.label} className="bg-bg-card rounded-lg p-2.5 border border-border text-center">
                                <p className={`text-lg font-bold ${stat.color}`}>{stat.value ?? 0}</p>
                                <p className="text-[10px] text-text-muted uppercase">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                ) : null}

                <div>
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-text-secondary uppercase">Task Queue</p>
                        <span className="text-[10px] text-text-muted">{visibleTasks.length} visible</span>
                    </div>
                    <div className="space-y-1.5">
                        {visibleTasks.slice(0, 6).map((task) => (
                            <button
                                key={task.id}
                                type="button"
                                onClick={() => {
                                    setSelectedTask(task);
                                    const machine = task.machine_id ? useAppStore.getState().machines.find((item) => item.id === task.machine_id) : null;
                                    if (machine) {
                                        setSelectedMachine(machine);
                                    }
                                }}
                                className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-left transition hover:bg-bg-hover"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-text-primary truncate">{task.title}</p>
                                    <span className={`text-[10px] font-mono uppercase ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                                </div>
                                <p className="mt-1 text-[10px] capitalize text-text-muted">{formatStatus(task.status)}</p>
                            </button>
                        ))}
                        {visibleTasks.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-6 text-center">
                                <p className="text-xs text-text-muted">No tasks match the current filter.</p>
                                {canCreateTask ? (
                                    <button
                                        type="button"
                                        onClick={() => openCreateTaskModal()}
                                        className="mt-3 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.22)] transition hover:bg-accent-glow"
                                    >
                                        + Create Task
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div>
                    <p className="text-xs font-bold text-text-secondary uppercase mb-2">AI Insights</p>
                    <div className="space-y-1.5">
                        {insights.slice(0, 5).map((insight) => (
                            <div
                                key={insight.id}
                                className={`px-3 py-2 rounded-lg border text-xs ${insight.severity === 'critical'
                                    ? 'bg-danger/10 border-danger/30 text-danger'
                                    : insight.severity === 'warning'
                                        ? 'bg-warning/10 border-warning/30 text-warning'
                                        : 'bg-bg-card border-border text-text-secondary'
                                    }`}
                            >
                                {insight.message}
                            </div>
                        ))}
                        {insights.length === 0 ? (
                            <p className="text-xs text-text-muted text-center py-4">No insights yet</p>
                        ) : null}
                    </div>
                </div>
            </div>
        </aside>
    );
});

export default RightPanel;
