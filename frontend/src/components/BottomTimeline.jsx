import { memo, useMemo } from 'react';
import useAppStore, { filterTasks, sortTasks } from '../stores/appStore';
import { playClickSound } from '../utils/audio';

const STATUS_VARIANTS = {
    completed: 'bg-success/10 border-success/30 text-success',
    in_progress: 'bg-warning/10 border-warning/30 text-warning',
    delayed: 'bg-danger/10 border-danger/40 text-danger shadow-[0_0_10px_rgba(239,68,68,0.2)]',
    idle: 'bg-idle/10 border-idle/30 text-idle',
};

const formatTime = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const BottomTimeline = memo(function BottomTimeline() {
    const tasks = useAppStore((s) => s.tasks);
    const taskFilter = useAppStore((s) => s.taskFilter);
    const taskSort = useAppStore((s) => s.taskSort);
    const machines = useAppStore((s) => s.machines);
    const setSelectedTask = useAppStore((s) => s.setSelectedTask);
    const setSelectedMachine = useAppStore((s) => s.setSelectedMachine);

    const recentTasks = useMemo(() => {
        return [...sortTasks(filterTasks(tasks, taskFilter), taskSort)]
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .slice(0, 20);
    }, [tasks, taskFilter, taskSort]);

    const handleTaskClick = (t) => {
        playClickSound();
        setSelectedTask(t);
        const machine = machines.find((m) => m.id === t.machine_id);
        if (machine) setSelectedMachine(machine);
    };

    return (
        <div className="h-16 bg-bg-secondary border-t border-border flex items-center px-4 gap-3 shrink-0 overflow-x-auto scroller-hide">
            <span className="text-[10px] text-text-muted uppercase tracking-wider whitespace-nowrap font-bold mr-2 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Timeline
            </span>
            {recentTasks.map((t) => (
                <button
                    key={t.id}
                    onClick={() => handleTaskClick(t)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border hover:-translate-y-0.5 transition-all cursor-pointer shrink-0 ${STATUS_VARIANTS[t.status] || STATUS_VARIANTS.idle}`}
                >
                    <span className="text-[10px] font-mono opacity-60">{formatTime(t.updated_at)}</span>
                    <div className="w-[1px] h-3 bg-current opacity-20 mx-0.5" />
                    <span className="text-xs font-medium truncate max-w-[120px]">{t.title}</span>
                </button>
            ))}
            {tasks.length === 0 && (
                <span className="text-xs text-text-muted italic">No recent activity detected</span>
            )}
        </div>
    );
});

export default BottomTimeline;
