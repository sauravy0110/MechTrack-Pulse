import { memo, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Play, MoreVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useAppStore, { filterTasks, sortTasks } from '../stores/appStore';
import useAuthStore from '../stores/authStore';

const MotionDiv = motion.div;

const MobileTaskView = memo(function MobileTaskView() {
    const tasks = useAppStore((state) => state.tasks);
    const machines = useAppStore((state) => state.machines);
    const updateTaskStatus = useAppStore((state) => state.updateTaskStatus);
    const openCreateTaskModal = useAppStore((state) => state.openCreateTaskModal);
    const addAlert = useAppStore((state) => state.addAlert);
    const taskFilter = useAppStore((state) => state.taskFilter);
    const taskSort = useAppStore((state) => state.taskSort);
    const setTaskFilter = useAppStore((state) => state.setTaskFilter);
    const setTaskSort = useAppStore((state) => state.setTaskSort);
    const userRole = useAuthStore((state) => state.user?.role);

    const visibleTasks = useMemo(
        () => sortTasks(filterTasks(tasks, taskFilter), taskSort),
        [tasks, taskFilter, taskSort]
    );
    const canCreateTask = userRole === 'owner' || userRole === 'supervisor';
    const canControlWorkflow = userRole === 'owner' || userRole === 'supervisor' || userRole === 'operator';

    const getMachineName = (id) => machines.find((machine) => machine.id === id)?.name || 'Unassigned Machine';
    const canStart = (status) => ['idle', 'queued', 'paused', 'delayed'].includes(status);
    const getPrimaryActionLabel = (status) => status === 'queued'
        ? 'Start Task'
        : status === 'paused'
            ? 'Resume Task'
            : status === 'delayed'
                ? 'Recover Task'
                : 'Start Procedure';

    const handleStatusUpdate = async (taskId, nextStatus) => {
        try {
            await updateTaskStatus(taskId, nextStatus);
        } catch (error) {
            addAlert(error.message || 'Unable to update workflow right now.', 'error');
        }
    };

    return (
        <div className="flex-1 overflow-y-auto bg-bg-primary/40 p-4 space-y-4 pb-32">
            <header className="mb-6 flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-text-primary tracking-tight">Active Work</h1>
                    <p className="text-xs text-text-muted mt-1 font-mono uppercase tracking-widest">
                        {visibleTasks.length} visible · {taskFilter} · {taskSort}
                    </p>
                </div>
                {canCreateTask ? (
                    <button
                        type="button"
                        onClick={() => openCreateTaskModal()}
                        className="rounded-2xl bg-accent px-4 py-3 text-xs font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow"
                    >
                        + Create Task
                    </button>
                ) : null}
            </header>

            <div className="grid grid-cols-2 gap-3">
                <select
                    value={taskFilter}
                    onChange={(event) => setTaskFilter(event.target.value)}
                    className="rounded-2xl border border-border bg-white px-4 py-3 text-xs font-semibold text-text-secondary outline-none transition focus:border-accent"
                >
                    <option value="all">All Tasks</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="delayed">Delayed</option>
                </select>
                <select
                    value={taskSort}
                    onChange={(event) => setTaskSort(event.target.value)}
                    className="rounded-2xl border border-border bg-white px-4 py-3 text-xs font-semibold text-text-secondary outline-none transition focus:border-accent"
                >
                    <option value="priority">Sort: Priority</option>
                    <option value="time">Sort: Time</option>
                </select>
            </div>

            <AnimatePresence mode="popLayout">
                {visibleTasks.map((task) => (
                    <MotionDiv
                        key={task.id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="group relative bg-bg-panel/60 backdrop-blur-md border border-border/50 rounded-2xl overflow-hidden shadow-xl"
                    >
                        <div className="p-5">
                            <div className="flex justify-between items-start mb-4">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter shadow-sm border ${task.priority === 'critical'
                                    ? 'bg-danger/20 text-danger border-danger/30'
                                    : task.priority === 'high'
                                        ? 'bg-warning/20 text-warning border-warning/30'
                                        : 'bg-accent/20 text-accent border-accent/30'
                                    }`}>
                                    {task.priority} Priority
                                </span>
                                <button className="text-text-muted p-1 hover:text-text-primary transition-colors">
                                    <MoreVertical size={18} />
                                </button>
                            </div>

                            <h3 className="text-lg font-bold text-text-primary mb-1 leading-tight group-active:text-accent transition-colors">
                                {task.title}
                            </h3>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-1 bg-bg-primary rounded-md">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                </div>
                                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                                    {getMachineName(task.machine_id)}
                                </span>
                            </div>

                            <p className="text-xs text-text-muted leading-relaxed mb-6 line-clamp-2 italic">
                                "{task.description || 'No description provided'}"
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                                {canControlWorkflow && canStart(task.status) ? (
                                    <button
                                        onClick={() => handleStatusUpdate(task.id, 'in_progress')}
                                        className="col-span-2 flex items-center justify-center gap-2 bg-accent text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-accent/20"
                                    >
                                        <Play size={16} fill="currentColor" />
                                        {getPrimaryActionLabel(task.status)}
                                    </button>
                                ) : canControlWorkflow && task.status === 'in_progress' ? (
                                    <>
                                        <button
                                            onClick={() => handleStatusUpdate(task.id, 'completed')}
                                            className="flex items-center justify-center gap-2 bg-success text-white py-4 rounded-xl font-black text-[10px] uppercase tracking-tighter active:scale-95 transition-all shadow-lg shadow-success/20"
                                        >
                                            <CheckCircle2 size={16} />
                                            Finish
                                        </button>
                                        <button
                                            onClick={() => handleStatusUpdate(task.id, 'delayed')}
                                            className="flex items-center justify-center gap-2 bg-bg-secondary border border-border text-text-primary py-4 rounded-xl font-black text-[10px] uppercase tracking-tighter active:scale-95 transition-all"
                                        >
                                            <AlertTriangle size={16} className="text-warning" />
                                            Issue
                                        </button>
                                    </>
                                ) : (
                                    <div className="col-span-2 flex items-center justify-center py-4 bg-bg-secondary rounded-xl text-text-muted font-bold text-xs gap-2">
                                        {task.status === 'completed' ? (
                                            <>
                                                <CheckCircle2 size={16} className="text-success" />
                                                Task Completed
                                            </>
                                        ) : !canControlWorkflow ? (
                                            <>
                                                <CheckCircle2 size={16} className="text-accent/40" />
                                                Status View Only
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle size={16} className="text-warning" />
                                                Awaiting Action
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {task.status === 'in_progress' ? (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-bg-primary">
                                <MotionDiv
                                    className="h-full bg-accent shadow-[0_0_10px_var(--accent)]"
                                    initial={{ width: '0%' }}
                                    animate={{ width: '100%' }}
                                    transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
                                />
                            </div>
                        ) : null}
                    </MotionDiv>
                ))}

                {visibleTasks.length === 0 ? (
                    <MotionDiv
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center py-20 text-center"
                    >
                        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle2 size={32} className="text-accent/40" />
                        </div>
                        <h3 className="text-lg font-bold text-text-primary">
                            {tasks.length === 0 ? 'No Tasks Yet' : 'No Tasks Match This View'}
                        </h3>
                        <p className="text-sm text-text-muted max-w-[220px] mt-2 leading-relaxed">
                            {tasks.length === 0
                                ? 'Dispatch a task to start work across the factory.'
                                : 'Change the filter or sort from the main dashboard to surface different tasks.'}
                        </p>
                        {canCreateTask ? (
                            <button
                                type="button"
                                onClick={() => openCreateTaskModal()}
                                className="mt-5 rounded-2xl bg-accent px-4 py-3 text-xs font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow"
                            >
                                + Create Task
                            </button>
                        ) : null}
                    </MotionDiv>
                ) : null}
            </AnimatePresence>
        </div>
    );
});

export default MobileTaskView;
