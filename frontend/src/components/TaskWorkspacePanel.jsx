import { useEffect, useMemo, useState } from 'react';
import {
    Brain,
    Camera,
    Clock3,
    Loader2,
    Mic,
    MessageSquare,
    Siren,
    Upload,
} from 'lucide-react';
import api from '../api/client';
import useAppStore from '../stores/appStore';
import MESStageWorkspace from './MESStageWorkspace';

function formatDateTime(value) {
    if (!value) return 'Not available';
    try {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }).format(new Date(value));
    } catch {
        return 'Not available';
    }
}

function formatDuration(seconds) {
    const totalSeconds = Math.max(seconds || 0, 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remaining = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${remaining}s`;
    return `${remaining}s`;
}

function resolveMediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/api\/v1\/?$/, '');
    return `${apiBase}${path}`;
}

function normalizeLog(log) {
    return {
        id: log.id,
        action: log.action,
        details: log.details,
        user_id: log.user_id,
        created_at: log.created_at,
    };
}

export default function TaskWorkspacePanel({ task, role, compact = false }) {
    const addAlert = useAppStore((state) => state.addAlert);
    const [logs, setLogs] = useState([]);
    const [media, setMedia] = useState([]);
    const [assistant, setAssistant] = useState(null);
    const [clientSummary, setClientSummary] = useState(null);
    const [supervisorIntel, setSupervisorIntel] = useState(null);
    const [mesSummary, setMesSummary] = useState(null);
    const [loading, setLoading] = useState(false);
    const [note, setNote] = useState('');
    const [savingNote, setSavingNote] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [voiceActive, setVoiceActive] = useState(false);
    const [liveSeconds, setLiveSeconds] = useState(task?.total_time_spent_seconds || 0);

    useEffect(() => {
        setLiveSeconds(task?.total_time_spent_seconds || 0);
    }, [task?.id, task?.total_time_spent_seconds]);

    useEffect(() => {
        if (!task?.timer_started_at) return undefined;
        const startedAt = new Date(task.timer_started_at).getTime();
        const base = task.total_time_spent_seconds || 0;
        const interval = window.setInterval(() => {
            const extra = Math.max(Math.floor((Date.now() - startedAt) / 1000), 0);
            setLiveSeconds(base + extra);
        }, 1000);
        return () => window.clearInterval(interval);
    }, [task?.id, task?.timer_started_at, task?.total_time_spent_seconds]);

    useEffect(() => {
        if (!task?.id) return;
        let cancelled = false;

        async function loadWorkspace() {
            setLoading(true);
            try {
                const requests = [
                    api.get(`/tasks/${task.id}/logs`),
                    api.get(`/uploads/tasks/${task.id}/media`),
                    api.get(`/tasks/${task.id}/mes-summary`),
                ];

                if (role === 'operator') {
                    requests.push(api.get(`/ai/task-assistant/${task.id}`));
                } else if (role === 'client') {
                    requests.push(api.get(`/ai/client-summary/${task.id}`));
                } else if (role === 'owner' || role === 'supervisor') {
                    requests.push(api.get('/ai/supervisor-intelligence', { params: { task_id: task.id } }));
                }

                const results = await Promise.all(requests);
                if (cancelled) return;

                setLogs(Array.isArray(results[0]?.data) ? results[0].data.map(normalizeLog) : []);
                setMedia(Array.isArray(results[1]?.data) ? results[1].data : []);
                setMesSummary(results[2]?.data || null);

                if (role === 'operator') {
                    setAssistant(results[3]?.data || null);
                    setClientSummary(null);
                    setSupervisorIntel(null);
                } else if (role === 'client') {
                    setClientSummary(results[3]?.data || null);
                    setAssistant(null);
                    setSupervisorIntel(null);
                } else {
                    setSupervisorIntel(results[3]?.data || null);
                    setAssistant(null);
                    setClientSummary(null);
                }
            } catch (error) {
                if (!cancelled) {
                    addAlert(error.response?.data?.detail || 'Unable to load task workspace.', 'error');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadWorkspace();
        return () => {
            cancelled = true;
        };
    }, [task?.id, role, addAlert]);

    const refreshWorkspace = async () => {
        if (!task?.id) return;
        try {
            const [logsRes, mediaRes, mesRes] = await Promise.all([
                api.get(`/tasks/${task.id}/logs`),
                api.get(`/uploads/tasks/${task.id}/media`),
                api.get(`/tasks/${task.id}/mes-summary`),
            ]);
            setLogs(Array.isArray(logsRes?.data) ? logsRes.data.map(normalizeLog) : []);
            setMedia(Array.isArray(mediaRes?.data) ? mediaRes.data : []);
            setMesSummary(mesRes?.data || null);
        } catch (error) {
            addAlert(error.response?.data?.detail || 'Unable to refresh MES workspace.', 'error');
        }
    };

    const recentNotes = useMemo(
        () => logs.filter((entry) => entry.action === 'note_added').slice(0, 4),
        [logs]
    );

    const recentTimeline = useMemo(
        () => logs.filter((entry) => entry.action !== 'note_added').slice(0, 5),
        [logs]
    );

    const handleAddNote = async (event) => {
        event.preventDefault();
        const cleaned = note.trim();
        if (cleaned.length < 2) {
            addAlert('Write a slightly longer note before sending it.', 'warning');
            return;
        }

        setSavingNote(true);
        try {
            const { data } = await api.post(`/tasks/${task.id}/notes`, { note: cleaned });
            setLogs((current) => [
                {
                    id: data.id,
                    action: 'note_added',
                    details: data.note,
                    user_id: data.user_id,
                    created_at: data.created_at,
                },
                ...current,
            ]);
            setNote('');
            addAlert('Task note added.', 'success');
        } catch (error) {
            addAlert(error.response?.data?.detail || 'Unable to save note.', 'error');
        } finally {
            setSavingNote(false);
        }
    };

    const handleUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        setUploading(true);
        try {
            const { data } = await api.post(`/uploads/tasks/${task.id}/media`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setMedia((current) => [data, ...current]);
            addAlert('Work evidence uploaded.', 'success');
        } catch (error) {
            addAlert(error.response?.data?.detail || 'Unable to upload work evidence.', 'error');
        } finally {
            setUploading(false);
            event.target.value = '';
        }
    };

    const startVoiceInput = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            addAlert('Voice input is not supported in this browser.', 'warning');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        setVoiceActive(true);

        recognition.onresult = (event) => {
            const transcript = event.results?.[0]?.[0]?.transcript || '';
            setNote((current) => `${current}${current ? ' ' : ''}${transcript}`.trim());
        };
        recognition.onerror = () => {
            addAlert('Voice capture failed. Please try again.', 'error');
        };
        recognition.onend = () => {
            setVoiceActive(false);
        };
        recognition.start();
    };

    const downloadClientReport = async (format) => {
        try {
            const response = await api.get(`/client/reports/export/${format}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(response.data);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = format === 'pdf' ? 'client_project_reports.pdf' : 'client_project_reports.csv';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            addAlert(error.response?.data?.detail || `Unable to download ${format.toUpperCase()} report.`, 'error');
        }
    };

    const containerClass = compact ? 'space-y-3' : 'space-y-4';
    const canUploadMedia = role !== 'client';

    return (
        <div className={containerClass}>
            <div className="grid grid-cols-2 gap-2">
                <div className="glass-card rounded-xl px-3 py-3">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">
                        <Clock3 size={12} />
                        Time tracking
                    </div>
                    <p className="mt-2 text-lg font-bold text-text-primary">{formatDuration(liveSeconds)}</p>
                </div>
                <div className="glass-card rounded-xl px-3 py-3">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">
                        <Camera size={12} />
                        Work evidence
                    </div>
                    <p className="mt-2 text-lg font-bold text-text-primary">{media.length}</p>
                </div>
            </div>

            {loading && (
                <div className="glass-card rounded-xl px-3 py-4 text-xs text-text-muted flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading task workspace...
                </div>
            )}

            {role === 'operator' && assistant && (
                <div className="glass-card rounded-2xl p-4 border border-accent/20">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
                        <Brain size={14} />
                        AI Task Assistant
                    </div>
                    <p className="mt-3 text-sm text-text-primary">{assistant.due_message}</p>
                    <div className="mt-3 space-y-2 text-xs text-text-secondary">
                        {assistant.steps?.map((step, index) => (
                            <div key={step} className="rounded-xl bg-black/10 px-3 py-2">
                                <span className="font-semibold text-text-primary">Step {index + 1}:</span> {step}
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 text-xs text-text-muted">
                        Expected completion: <span className="text-text-primary font-semibold">{assistant.expected_completion_label}</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                        {assistant.evidence_feedback?.map((item) => (
                            <p key={item} className="text-[11px] text-text-secondary">{item}</p>
                        ))}
                    </div>
                </div>
            )}

            {(role === 'owner' || role === 'supervisor') && supervisorIntel && (
                <div className="glass-card rounded-2xl p-4 border border-warning/20">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-warning">
                        <Siren size={14} />
                        Supervisor Intelligence
                    </div>
                    <div className="mt-3 space-y-2 text-xs text-text-secondary">
                        {supervisorIntel.alerts?.map((alert) => (
                            <div key={alert} className="rounded-xl bg-black/10 px-3 py-2">{alert}</div>
                        ))}
                    </div>
                    {supervisorIntel.delay_prediction && (
                        <p className="mt-3 text-sm text-text-primary">
                            Delay risk: <span className="font-bold">{Math.round((supervisorIntel.delay_prediction.delay_probability || 0) * 100)}%</span>
                        </p>
                    )}
                    {supervisorIntel.assignment_suggestion && (
                        <div className="mt-3 rounded-xl border border-accent/20 px-3 py-3">
                            <p className="text-xs font-semibold text-accent">Suggested operator</p>
                            <p className="mt-1 text-sm font-bold text-text-primary">{supervisorIntel.assignment_suggestion.full_name}</p>
                            <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
                                {supervisorIntel.assignment_suggestion.reasons?.map((reason) => <p key={reason}>{reason}</p>)}
                            </div>
                        </div>
                    )}
                    {supervisorIntel.bottleneck && (
                        <p className="mt-3 text-[11px] text-text-secondary">{supervisorIntel.bottleneck.message}</p>
                    )}
                </div>
            )}

            {role === 'client' && clientSummary && (
                <div className="glass-card rounded-2xl p-4 border border-success/20">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-success">
                        <Brain size={14} />
                        AI Progress Summary
                    </div>
                    <p className="mt-3 text-sm text-text-primary">{clientSummary.summary}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-black/10 px-3 py-3">
                            <p className="text-text-muted">Progress</p>
                            <p className="mt-1 text-lg font-bold text-text-primary">{clientSummary.progress_percent}%</p>
                        </div>
                        <div className="rounded-xl bg-black/10 px-3 py-3">
                            <p className="text-text-muted">ETA</p>
                            <p className="mt-1 text-sm font-bold text-text-primary">{formatDateTime(clientSummary.delivery_prediction)}</p>
                        </div>
                    </div>
                    <p className="mt-3 text-[11px] text-text-secondary">{clientSummary.delay_explanation}</p>
                    <div className="mt-4 flex gap-2">
                        <button
                            type="button"
                            onClick={() => downloadClientReport('csv')}
                            className="btn-ghost rounded-xl px-3 py-2 text-[11px] font-semibold"
                        >
                            CSV report
                        </button>
                        <button
                            type="button"
                            onClick={() => downloadClientReport('pdf')}
                            className="btn-primary rounded-xl px-3 py-2 text-[11px] font-semibold"
                        >
                            PDF report
                        </button>
                    </div>
                </div>
            )}

            <MESStageWorkspace task={task} role={role} mesSummary={mesSummary} onRefresh={refreshWorkspace} />

            <div className="glass-card rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                        <Upload size={14} />
                        Work Upload
                    </div>
                    {canUploadMedia ? (
                        <label className="btn-ghost rounded-xl px-3 py-2 text-[11px] font-semibold cursor-pointer">
                            {uploading ? 'Uploading...' : 'Add image/video'}
                            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleUpload} />
                        </label>
                    ) : (
                        <span className="text-[11px] text-text-muted">View only</span>
                    )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {media.slice(0, compact ? 2 : 4).map((item) => (
                        <a
                            key={item.id}
                            href={resolveMediaUrl(item.media_url || item.image_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl overflow-hidden border border-border bg-black/10"
                        >
                            {item.media_type === 'video' ? (
                                <video src={resolveMediaUrl(item.media_url || item.image_url)} className="h-28 w-full object-cover" muted />
                            ) : (
                                <img src={resolveMediaUrl(item.media_url || item.image_url)} alt="Task evidence" className="h-28 w-full object-cover" />
                            )}
                        </a>
                    ))}
                    {media.length === 0 && (
                        <div className="col-span-2 rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                            No work evidence uploaded yet.
                        </div>
                    )}
                </div>
            </div>

            <div className="glass-card rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                        <MessageSquare size={14} />
                        Notes & Communication
                    </div>
                    <button
                        type="button"
                        onClick={startVoiceInput}
                        className={`btn-ghost rounded-xl px-3 py-2 text-[11px] font-semibold ${voiceActive ? 'text-accent' : ''}`}
                    >
                        <Mic size={12} className="inline mr-1" />
                        {voiceActive ? 'Listening...' : 'Voice input'}
                    </button>
                </div>

                <form onSubmit={handleAddNote} className="mt-3 space-y-3">
                    <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={compact ? 3 : 4}
                        placeholder="Log a blocker, progress update, or handoff note..."
                        className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                    />
                    <div className="flex justify-end">
                        <button type="submit" disabled={savingNote} className="btn-primary rounded-xl px-4 py-2 text-xs font-semibold">
                            {savingNote ? 'Saving...' : 'Add note'}
                        </button>
                    </div>
                </form>

                <div className="mt-4 space-y-2">
                    {recentNotes.map((entry) => (
                        <div key={entry.id} className="rounded-xl bg-black/10 px-3 py-3">
                            <p className="text-sm text-text-primary">{entry.details}</p>
                            <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-text-muted">{formatDateTime(entry.created_at)}</p>
                        </div>
                    ))}
                    {recentNotes.length === 0 && (
                        <p className="text-xs text-text-muted">No notes yet.</p>
                    )}
                </div>
            </div>

            <div className="glass-card rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                    <Clock3 size={14} />
                    Timeline
                </div>
                <div className="mt-3 space-y-2">
                    {recentTimeline.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-border/60 px-3 py-3">
                            <p className="text-xs font-semibold text-text-primary">{entry.action.replace(/_/g, ' ')}</p>
                            {entry.details ? <p className="mt-1 text-[11px] text-text-secondary">{entry.details}</p> : null}
                            <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-text-muted">{formatDateTime(entry.created_at)}</p>
                        </div>
                    ))}
                    {recentTimeline.length === 0 && (
                        <p className="text-xs text-text-muted">No timeline activity recorded yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
