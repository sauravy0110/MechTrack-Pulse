import { memo, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Play, MoreVertical, ChevronDown, Clock3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useAppStore, { filterTasks, sortTasks } from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import TaskWorkspacePanel from './TaskWorkspacePanel';

const MotionDiv = motion.div;

function isCNCJob(task) {
    return Boolean(task?.is_locked || task?.part_name || ['created', 'planned', 'ready', 'assigned', 'setup', 'setup_done', 'first_piece_approval', 'qc_check', 'final_inspection', 'dispatched'].includes(task?.status));
}

const MobileTaskView = memo(function MobileTaskView({ embedded = false }) {
    const tasks = useAppStore((state) => state.tasks);
    const machines = useAppStore((state) => state.machines);
    const updateTaskStatus = useAppStore((state) => state.updateTaskStatus);
    const openJobCreationModal = useAppStore((state) => state.openJobCreationModal);
    const addAlert = useAppStore((state) => state.addAlert);
    const taskFilter = useAppStore((state) => state.taskFilter);
    const taskSort = useAppStore((state) => state.taskSort);
    const setTaskFilter = useAppStore((state) => state.setTaskFilter);
    const setTaskSort = useAppStore((state) => state.setTaskSort);
    const setSelectedTask = useAppStore((state) => state.setSelectedTask);
    const userRole = useAuthStore((state) => state.user?.role);
    const [expandedTaskId, setExpandedTaskId] = useState('');

    const visibleTasks = useMemo(() => sortTasks(filterTasks(tasks, taskFilter), taskSort), [tasks, taskFilter, taskSort]);
    const canCreateTask = userRole === 'owner' || userRole === 'supervisor';
    const canControlWorkflow = userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator';

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

    const handleStatusUpdate = async (taskId, nextStatus) => {
        try { await updateTaskStatus(taskId, nextStatus); }
        catch (error) { addAlert(error.message || 'Unable to update.', 'error'); }
    };

    const toggleWorkspace = (task) => {
        setSelectedTask(task);
        setExpandedTaskId((current) => current === task.id ? '' : task.id);
    };

    const openTaskCreation = () => {
        openJobCreationModal();
    };

    const wrapperClass = embedded
        ? 'px-6 py-6 pb-8 space-y-5'
        : 'flex-1 overflow-y-auto p-4 space-y-4 pb-32';

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
                    <option value="completed">Completed</option>
                    <option value="delayed">Delayed</option>
                </select>
                <select value={taskSort} onChange={(e) => setTaskSort(e.target.value)}
                    className="input-glass rounded-xl px-4 py-3 text-xs font-semibold">
                    <option value="priority">Sort: Priority</option>
                    <option value="time">Sort: Time</option>
                </select>
            </div>

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
                                <button className="text-text-muted p-1 hover:text-text-primary transition-colors"><MoreVertical size={18} /></button>
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
                                    <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Logged time</p>
                                    <p className="mt-1 text-text-primary inline-flex items-center gap-1">
                                        <Clock3 size={12} />
                                        {formatDuration(task.total_time_spent_seconds)}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {isCNCJob(task) ? (
                                    <div className="col-span-2 rounded-xl border border-accent/20 bg-accent/5 px-4 py-4 text-[11px] leading-5 text-text-secondary">
                                        This CNC job follows the MES workflow. Open the workspace to continue with material validation, setup, QC, rework, dispatch, or completion.
                                    </div>
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
                                onClick={() => toggleWorkspace(task)}
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
