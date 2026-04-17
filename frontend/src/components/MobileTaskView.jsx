import { memo, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Play, ChevronDown, Clock3, Pencil, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useAppStore, { filterTasks, sortTasks } from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import TaskWorkspacePanel from './TaskWorkspacePanel';
import api from '../api/client';

const MotionDiv = motion.div;

function isCNCJob(task) {
    return Boolean(task?.is_locked || task?.part_name || ['created', 'planned', 'ready', 'assigned', 'setup', 'setup_done', 'first_piece_approval', 'qc_check', 'final_inspection', 'dispatched'].includes(task?.status));
}

const MobileTaskView = memo(function MobileTaskView({ embedded = false }) {
    const tasks = useAppStore((state) => state.tasks);
    const machines = useAppStore((state) => state.machines);
    const updateTaskStatus = useAppStore((state) => state.updateTaskStatus);
    const openJobCreationModal = useAppStore((state) => state.openJobCreationModal);
    const openEditTaskModal = useAppStore((state) => state.openEditTaskModal);
    const deleteTask = useAppStore((state) => state.deleteTask);
    const addAlert = useAppStore((state) => state.addAlert);
    const taskFilter = useAppStore((state) => state.taskFilter);
    const taskSort = useAppStore((state) => state.taskSort);
    const setTaskFilter = useAppStore((state) => state.setTaskFilter);
    const setTaskSort = useAppStore((state) => state.setTaskSort);
    const setSelectedTask = useAppStore((state) => state.setSelectedTask);
    const setSelectedMachine = useAppStore((state) => state.setSelectedMachine);
    const userRole = useAuthStore((state) => state.user?.role);
    const [expandedTaskId, setExpandedTaskId] = useState('');
    const [deletingTaskId, setDeletingTaskId] = useState('');
    const [startingTaskId, setStartingTaskId] = useState('');

    const visibleTasks = useMemo(() => sortTasks(filterTasks(tasks, taskFilter), taskSort), [tasks, taskFilter, taskSort]);
    const reviewTasks = useMemo(() => sortTasks(tasks.filter((task) => task.status === 'final_inspection'), 'time'), [tasks]);
    const reworkTasks = useMemo(() => sortTasks(tasks.filter((task) => task.rework_flag && task.status !== 'completed'), 'time'), [tasks]);
    const canCreateTask = userRole === 'owner' || userRole === 'supervisor';
    const canEditTask = userRole === 'owner' || userRole === 'supervisor';
    const canDeleteTask = userRole === 'owner' || userRole === 'supervisor';
    const canControlWorkflow = userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator';
    const canReviewTasks = userRole === 'owner' || userRole === 'supervisor';
    const canSeeReworkQueue = userRole === 'operator' || userRole === 'owner' || userRole === 'supervisor';

    const getMachineName = (id) => machines.find((m) => m.id === id)?.name || 'Unassigned Machine';
    const canStart = (status) => ['idle', 'queued', 'paused', 'delayed'].includes(status);
    const getPrimaryActionLabel = (status) => status === 'queued' ? 'Start Task' : status === 'paused' ? 'Resume Task' : status === 'delayed' ? 'Recover Task' : 'Start Procedure';
    const formatDeadline = (value) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'No deadline';
    const formatDuration = (value) => {
        const total = Math.max(value || 0, 0);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };
    const formatStartedAt = (value) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Not started';
    const canStartCnc = (task) => ['created', 'planned', 'ready', 'assigned'].includes(task.status) && !task.timer_started_at;
    const canFinishCnc = (task) => Boolean(task.timer_started_at) && !['completed', 'dispatched', 'final_inspection'].includes(task.status);

    const handleStatusUpdate = async (taskId, nextStatus) => {
        try { await updateTaskStatus(taskId, nextStatus); }
        catch (error) { addAlert(error.message || 'Unable to update.', 'error'); }
    };

    const handleStartCncTask = async (task) => {
        setStartingTaskId(task.id);
        try {
            const { data } = await api.post(`/tasks/${task.id}/start-cnc`);
            if (data?.task) {
                useAppStore.getState().updateTask(data.task);
                setSelectedTask(data.task);
            } else {
                setSelectedTask(task);
            }
            setExpandedTaskId(task.id);
            addAlert('CNC workflow started. MES controls are now open below.', 'success');
        } catch (error) {
            addAlert(error.response?.data?.detail || error.message || 'Unable to start CNC workflow.', 'error');
        } finally {
            setStartingTaskId('');
        }
    };

    const handleFinishCncTask = async (task) => {
        setStartingTaskId(task.id);
        try {
            const { data } = await api.post(`/tasks/${task.id}/finish-cnc`);
            if (data?.task) {
                useAppStore.getState().updateTask(data.task);
                setSelectedTask(data.task);
            } else {
                setSelectedTask(task);
            }
            setExpandedTaskId(task.id);
            addAlert('CNC task finished. Review final inspection in the workspace below.', 'success');
        } catch (error) {
            addAlert(error.response?.data?.detail || error.message || 'Unable to finish CNC task.', 'error');
        } finally {
            setStartingTaskId('');
        }
    };

    const openTaskWorkspace = (task) => {
        if (task.status === 'final_inspection' && canReviewTasks) {
            setTaskFilter('review');
        } else if (task.rework_flag && task.status !== 'completed' && canSeeReworkQueue) {
            setTaskFilter('rework');
        } else if (!filterTasks(tasks, taskFilter).some((item) => item.id === task.id)) {
            setTaskFilter('all');
        }
        if (task.machine_id) {
            const machine = machines.find((item) => item.id === task.machine_id);
            if (machine) {
                setSelectedMachine(machine);
            }
        }
        setSelectedTask(task);
        setExpandedTaskId((current) => current === task.id ? '' : task.id);
    };

    const openTaskCreation = () => {
        openJobCreationModal();
    };

    const handleDeleteTask = async (task) => {
        if (!confirm(`Permanently delete "${task.title}"? This will remove all related data.`)) {
            return;
        }

        setDeletingTaskId(task.id);
        try {
            await deleteTask(task.id);
        } catch (error) {
            addAlert(error.message || 'Unable to delete task.', 'error');
        } finally {
            setDeletingTaskId('');
        }
    };

    const wrapperClass = embedded
        ? 'px-6 py-6 pb-8 space-y-5'
        : 'flex-1 overflow-y-auto p-4 space-y-4 pb-32';

    const renderTaskSummaryCard = (task, tone = 'accent') => (
        <div key={task.id} className={`rounded-2xl border px-4 py-4 ${
            tone === 'warning'
                ? 'border-warning/25 bg-warning/8'
                : 'border-accent/20 bg-accent/5'
        }`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{task.title}</p>
                    <p className="mt-1 text-[11px] text-text-secondary">
                        {task.part_name || 'General task'} {task.material_type ? `• ${task.material_type}` : ''} {task.operation_type ? `• ${task.operation_type === 'Other' ? (task.operation_other || 'Other') : task.operation_type}` : ''}
                    </p>
                    <p className="mt-2 text-[11px] text-text-muted">
                        Status: {task.status.replace(/_/g, ' ')} {task.rework_flag ? `• Rework #${task.rework_iteration || 1}` : ''}
                    </p>
                    {task.rework_reason ? (
                        <p className="mt-2 rounded-xl border border-warning/20 bg-warning/8 px-3 py-2 text-[11px] leading-5 text-warning">
                            Supervisor input: {task.rework_reason}
                        </p>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={() => openTaskWorkspace(task)}
                    className="shrink-0 rounded-xl border border-border/70 bg-bg-hover/40 px-3 py-2 text-[11px] font-semibold text-text-primary"
                >
                    {tone === 'warning' ? 'Open Rework' : 'Start Review'}
                </button>
            </div>
        </div>
    );

    return (
        <div className={wrapperClass}>
            <header className="mb-6 flex items-end justify-between gap-4">
                <div>
                    <h1 className={`text-text-primary tracking-tight ${embedded ? 'font-display text-4xl leading-none' : 'text-2xl font-black'}`}>Active Work</h1>
                    <p className="text-xs text-text-muted mt-1 font-mono uppercase tracking-widest">{visibleTasks.length} visible · {taskFilter} · {taskSort}</p>
                </div>
                {canCreateTask && (
                    <button type="button" onClick={openTaskCreation}
                        className="btn-primary rounded-xl px-4 py-3 text-xs font-semibold">+ Create Job</button>
                )}
            </header>

            <div className="grid grid-cols-2 gap-3">
                <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}
                    className="input-glass rounded-xl px-4 py-3 text-xs font-semibold">
                    <option value="all">All Tasks</option>
                    <option value="active">Active</option>
                    {canReviewTasks && <option value="review">Review</option>}
                    {canSeeReworkQueue && <option value="rework">Rework</option>}
                    <option value="completed">Completed</option>
                    <option value="delayed">Delayed</option>
                </select>
                <select value={taskSort} onChange={(e) => setTaskSort(e.target.value)}
                    className="input-glass rounded-xl px-4 py-3 text-xs font-semibold">
                    <option value="priority">Sort: Priority</option>
                    <option value="time">Sort: Time</option>
                </select>
            </div>

            {canReviewTasks && reviewTasks.length > 0 && (
                <section className="glass-card rounded-2xl p-5">
                    <div className="flex items-end justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Review Tasks</p>
                            <h2 className="mt-1 text-lg font-bold text-text-primary">Supervisor final verification queue</h2>
                            <p className="mt-1 text-xs text-text-secondary">Jobs finished by operators land here for human review, approval, or rework.</p>
                        </div>
                        <div className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1 text-[11px] font-semibold text-accent">
                            {reviewTasks.length} pending
                        </div>
                    </div>
                    <div className="mt-4 space-y-3">
                        {reviewTasks.map((task) => renderTaskSummaryCard(task, 'accent'))}
                    </div>
                </section>
            )}

            {canSeeReworkQueue && reworkTasks.length > 0 && (
                <section className="glass-card rounded-2xl p-5">
                    <div className="flex items-end justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-warning">Rework Queue</p>
                            <h2 className="mt-1 text-lg font-bold text-text-primary">Jobs returned with supervisor feedback</h2>
                            <p className="mt-1 text-xs text-text-secondary">Operators can reopen these jobs, review the reason, and continue from the workspace.</p>
                        </div>
                        <div className="rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-[11px] font-semibold text-warning">
                            {reworkTasks.length} active
                        </div>
                    </div>
                    <div className="mt-4 space-y-3">
                        {reworkTasks.map((task) => renderTaskSummaryCard(task, 'warning'))}
                    </div>
                </section>
            )}

            <AnimatePresence mode="popLayout">
                {visibleTasks.map((task) => (
                    <MotionDiv key={task.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                        className="group relative glass-card rounded-2xl overflow-hidden shadow-xl">
                        <div className="p-5">
                            <div className="flex justify-between items-start mb-4">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter border ${
                                    task.priority === 'critical' ? 'bg-danger/10 text-danger border-danger/30'
                                    : task.priority === 'high' ? 'bg-warning/10 text-warning border-warning/30'
                                    : 'bg-accent/10 text-accent border-accent/30'
                                }`}>{task.priority} Priority</span>
                                {(canEditTask || canDeleteTask) ? (
                                    <div className="flex items-center gap-2">
                                        {canEditTask && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedTask(task);
                                                    openEditTaskModal(task);
                                                }}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/8 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent transition hover:bg-accent/15"
                                            >
                                                <Pencil size={12} />
                                                Edit
                                            </button>
                                        )}
                                        {canDeleteTask && (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteTask(task)}
                                                disabled={deletingTaskId === task.id}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-danger/20 bg-danger/8 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-danger transition hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Trash2 size={12} />
                                                {deletingTaskId === task.id ? 'Deleting' : 'Delete'}
                                            </button>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                            <h3 className="text-lg font-bold text-text-primary mb-1 leading-tight">{task.title}</h3>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-1 bg-bg-primary rounded-md"><div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /></div>
                                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">{getMachineName(task.machine_id)}</span>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed mb-6 line-clamp-2 italic">"{task.description || 'No description provided'}"</p>

                            <div className="mb-4 grid grid-cols-2 gap-3 text-[11px] text-text-secondary">
                                <div className="glass-card rounded-xl px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Deadline</p>
                                    <p className="mt-1 text-text-primary">{formatDeadline(task.estimated_completion)}</p>
                                </div>
                                <div className="glass-card rounded-xl px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">{isCNCJob(task) ? 'Started' : 'Logged time'}</p>
                                    <p className="mt-1 text-text-primary inline-flex items-center gap-1">
                                        <Clock3 size={12} />
                                        {isCNCJob(task) ? formatStartedAt(task.timer_started_at) : formatDuration(task.total_time_spent_seconds)}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {isCNCJob(task) ? (
                                    <>
                                        {canStartCnc(task) ? (
                                            <button
                                                type="button"
                                                onClick={() => handleStartCncTask(task)}
                                                disabled={startingTaskId === task.id}
                                                className="col-span-2 btn-primary py-4 rounded-xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Play size={16} fill="currentColor" />
                                                {startingTaskId === task.id ? 'Starting...' : 'Start Task'}
                                            </button>
                                        ) : canFinishCnc(task) ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => handleFinishCncTask(task)}
                                                    disabled={startingTaskId === task.id}
                                                    className="bg-success text-white py-4 rounded-xl font-black text-[10px] uppercase tracking-tighter active:scale-95 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <CheckCircle2 size={16} />
                                                    {startingTaskId === task.id ? 'Finishing...' : 'Finish Task'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openTaskWorkspace(task)}
                                                    className="btn-ghost py-4 rounded-xl font-black text-[10px] uppercase tracking-tighter active:scale-95 transition-all flex items-center justify-center gap-2"
                                                >
                                                    <ChevronDown size={14} className={`transition-transform ${expandedTaskId === task.id ? 'rotate-180' : ''}`} />
                                                    Workflow
                                                </button>
                                            </>
                                        ) : null}
                                        <div className="col-span-2 rounded-xl border border-accent/20 bg-accent/5 px-4 py-4 text-[11px] leading-5 text-text-secondary">
                                            {canStartCnc(task)
                                                ? 'This job is assigned and ready. Start Task begins operator work and starts the timer.'
                                                : canFinishCnc(task)
                                                    ? 'Finish Task stops the timer and moves the job into final inspection. Open Workspace any time for detailed MES controls.'
                                                    : task.status === 'final_inspection'
                                                        ? 'This job is in final inspection. Open the workflow below to review the current MES status.'
                                                        : 'This CNC job follows the MES workflow. Open the workspace below to continue the process.'}
                                        </div>
                                    </>
                                ) : canControlWorkflow && canStart(task.status) ? (
                                    <button onClick={() => handleStatusUpdate(task.id, 'in_progress')}
                                        className="col-span-2 btn-primary py-4 rounded-xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2">
                                        <Play size={16} fill="currentColor" /> {getPrimaryActionLabel(task.status)}
                                    </button>
                                ) : canControlWorkflow && task.status === 'in_progress' ? (
                                    <>
                                        <button onClick={() => handleStatusUpdate(task.id, 'completed')}
                                            className="flex items-center justify-center gap-2 bg-success text-white py-4 rounded-xl font-black text-[10px] uppercase tracking-tighter active:scale-95 transition-all">
                                            <CheckCircle2 size={16} /> Finish
                                        </button>
                                        <button onClick={() => handleStatusUpdate(task.id, 'delayed')}
                                            className="flex items-center justify-center gap-2 glass-card py-4 rounded-xl font-black text-[10px] uppercase tracking-tighter active:scale-95 transition-all">
                                            <AlertTriangle size={16} className="text-warning" /> Issue
                                        </button>
                                    </>
                                ) : (
                                    <div className="col-span-2 flex items-center justify-center py-4 glass-card rounded-xl text-text-muted font-bold text-xs gap-2">
                                        {task.status === 'completed' ? <><CheckCircle2 size={16} className="text-success" /> Task Completed</> :
                                         !canControlWorkflow ? <><CheckCircle2 size={16} className="text-accent/40" /> Status View Only</> :
                                         <><AlertTriangle size={16} className="text-warning" /> Awaiting Action</>}
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => openTaskWorkspace(task)}
                                className="mt-4 w-full btn-ghost rounded-xl px-4 py-3 text-xs font-semibold inline-flex items-center justify-center gap-2"
                            >
                                Workspace
                                <ChevronDown size={14} className={`transition-transform ${expandedTaskId === task.id ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence initial={false}>
                                {expandedTaskId === task.id && (
                                    <MotionDiv
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="mt-4 overflow-hidden"
                                    >
                                        <TaskWorkspacePanel task={task} role={userRole} compact />
                                    </MotionDiv>
                                )}
                            </AnimatePresence>
                        </div>
                        {task.status === 'in_progress' && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-bg-primary">
                                <MotionDiv className="h-full bg-accent glow-accent" initial={{ width: '0%' }} animate={{ width: '100%' }}
                                    transition={{ duration: 30, repeat: Infinity, ease: 'linear' }} />
                            </div>
                        )}
                    </MotionDiv>
                ))}

                {visibleTasks.length === 0 && (
                    <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mb-4 border border-accent/20">
                            <CheckCircle2 size={32} className="text-accent/40" />
                        </div>
                        <h3 className="text-lg font-bold text-text-primary">{tasks.length === 0 ? 'No Tasks Yet' : 'No Tasks Match This View'}</h3>
                        <p className="text-sm text-text-muted max-w-[220px] mt-2 leading-relaxed">
                            {tasks.length === 0 ? 'Dispatch a task to start work.' : 'Change the filter or sort to see different tasks.'}
                        </p>
                        {canCreateTask && (
                            <button type="button" onClick={openTaskCreation}
                                className="mt-5 btn-primary rounded-xl px-4 py-3 text-xs font-semibold">+ Create Job</button>
                        )}
                    </MotionDiv>
                )}
            </AnimatePresence>
        </div>
    );
});

export default MobileTaskView;
