import { create } from 'zustand';
import api from '../api/client';
import { playAlertSound } from '../utils/audio';
import { getApiErrorMessage } from '../utils/apiError';
import useAuthStore from './authStore';

export const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
export const ACTIVE_TASK_STATUSES = new Set([
    'idle',
    'queued',
    'created',
    'planned',
    'ready',
    'assigned',
    'setup',
    'setup_done',
    'first_piece_approval',
    'in_progress',
    'paused',
    'qc_check',
    'final_inspection',
    'dispatched',
    'delayed',
]);

function deriveOperatorStatus(operator) {
    if (!operator?.is_on_duty) {
        return 'offline';
    }
    if ((operator.current_task_count || 0) >= 5) {
        return 'busy';
    }
    return 'available';
}

function normalizeOperator(operator) {
    return {
        ...operator,
        current_task_count: operator?.current_task_count ?? 0,
        status: operator?.status || deriveOperatorStatus(operator),
    };
}

function normalizeUser(user) {
    return {
        ...user,
        phone: user?.phone ?? null,
        department: user?.department ?? null,
        is_active: user?.is_active ?? true,
        is_on_duty: user?.is_on_duty ?? false,
        current_task_count: user?.current_task_count ?? 0,
        last_active_at: user?.last_active_at ?? null,
    };
}

export function filterTasks(tasks, filter) {
    if (filter === 'completed') {
        return tasks.filter((task) => task.status === 'completed');
    }
    if (filter === 'delayed') {
        return tasks.filter((task) => task.status === 'delayed');
    }
    if (filter === 'active') {
        return tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
    }
    return tasks;
}

export function sortTasks(tasks, sort) {
    if (sort === 'priority') {
        return [...tasks].sort((a, b) => {
            const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
        });
    }

    return [...tasks].sort(
        (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    );
}

function getStoredUserRole() {
    try {
        return JSON.parse(localStorage.getItem('user') || 'null')?.role || null;
    } catch {
        return null;
    }
}

function shouldRefreshOwnerBusiness() {
    return getStoredUserRole() === 'owner';
}

function triggerBrowserDownload(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

const useAppStore = create((set, get) => ({
    // Data
    users: [],
    clients: [],
    machines: [],
    tasks: [],
    dashboard: null,
    ownerBusiness: null,
    reports: [],
    insights: [],
    aiProviderStatus: null,
    selectedMachine: null,
    selectedTask: null,
    wsStatus: 'disconnected', // 'connected' | 'disconnected' | 'reconnecting'

    // Loading states
    loadingMachines: false,
    loadingTasks: false,
    loadingUsers: false,
    loadingOwnerBusiness: false,
    loadingReports: false,
    creatingMachine: false,
    creatingTask: false,
    creatingUser: false,
    savingCompanyProfile: false,
    generatingReport: false,
    togglingDuty: false,

    // UI state
    isAddMachineModalOpen: false,
    isCreateTaskModalOpen: false,
    isAddUserModalOpen: false,
    isGlobalAIModalOpen: false,
    createTaskMachineId: '',
    taskFilter: 'all',
    taskSort: 'time',

    // ── Fetchers ────────────────────────────────────────
    fetchMachines: async () => {
        set({ loadingMachines: true });
        try {
            const { data } = await api.get('/machines/');
            set({ machines: data, loadingMachines: false });
        } catch { set({ loadingMachines: false }); }
    },

    fetchTasks: async () => {
        set({ loadingTasks: true });
        try {
            const { data } = await api.get('/tasks/');
            set({ tasks: data, loadingTasks: false });
        } catch { set({ loadingTasks: false }); }
    },

    fetchUsers: async () => {
        set({ loadingUsers: true });
        try {
            const { data } = await api.get('/users/');
            set({ users: Array.isArray(data) ? data.map(normalizeUser) : [], loadingUsers: false });
        } catch (error) {
            void error;
            set({ loadingUsers: false });
        }
    },

    fetchClients: async () => {
        try {
            const { data } = await api.get('/clients/');
            set({ clients: Array.isArray(data) ? data : [] });
            return Array.isArray(data) ? data : [];
        } catch (error) {
            void error;
            return [];
        }
    },

    fetchDashboard: async () => {
        try {
            const { data } = await api.get('/analytics/dashboard');
            set({ dashboard: data });
        } catch (error) {
            void error;
        }
    },

    fetchOwnerBusinessOverview: async () => {
        set({ loadingOwnerBusiness: true });
        try {
            const { data } = await api.get('/owner/business-overview');
            set({ ownerBusiness: data, loadingOwnerBusiness: false });
        } catch (error) {
            void error;
            set({ loadingOwnerBusiness: false });
        }
    },

    fetchReports: async () => {
        set({ loadingReports: true });
        try {
            const { data } = await api.get('/reports/');
            set({ reports: Array.isArray(data) ? data : [], loadingReports: false });
        } catch (error) {
            void error;
            set({ loadingReports: false });
        }
    },

    fetchInsights: async () => {
        try {
            const { data } = await api.get('/ai/insights');
            set({ insights: data });
        } catch (error) {
            void error;
        }
    },

    fetchAIProviderStatus: async () => {
        try {
            const { data } = await api.get('/ai/provider-status');
            set({ aiProviderStatus: data });
        } catch (error) {
            void error;
            set({
                aiProviderStatus: {
                    enabled: false,
                    configured: false,
                    error: getApiErrorMessage(error, 'AI unavailable'),
                },
            });
        }
    },

    fetchAll: async () => {
        const { fetchMachines, fetchTasks, fetchDashboard, fetchInsights, fetchOwnerBusinessOverview, fetchReports, fetchAIProviderStatus } = get();
        await Promise.all([
            fetchMachines(),
            fetchTasks(),
            fetchDashboard(),
            fetchInsights(),
            fetchAIProviderStatus(),
            shouldRefreshOwnerBusiness() ? fetchOwnerBusinessOverview() : Promise.resolve(),
            shouldRefreshOwnerBusiness() ? fetchReports() : Promise.resolve(),
        ]);
    },

    // ── Operators ───────────────────────────────────────
    operators: [],
    fetchOperators: async () => {
        try {
            const { data } = await api.get('/operator/status');
            set({ operators: Array.isArray(data) ? data.map(normalizeOperator) : [] });
        } catch (error) {
            void error;
        }
    },
    updateOperator: (updatedOp) => {
        set((state) => ({
            operators: state.operators.some((op) => op.id === updatedOp.id)
                ? state.operators.map((op) =>
                    op.id === updatedOp.id ? normalizeOperator({ ...op, ...updatedOp }) : op
                )
                : [...state.operators, normalizeOperator(updatedOp)],
            users: state.users.map((user) =>
                user.id === updatedOp.id ? normalizeUser({ ...user, ...updatedOp }) : user
            ),
        }));
    },
    updateUser: (updatedUser) => {
        set((state) => ({
            users: updatedUser.is_active === false
                ? state.users.filter((user) => user.id !== updatedUser.id)
                : (
                    state.users.some((user) => user.id === updatedUser.id)
                        ? state.users.map((user) =>
                            user.id === updatedUser.id ? normalizeUser({ ...user, ...updatedUser }) : user
                        )
                        : [...state.users, normalizeUser(updatedUser)]
                ),
            operators: updatedUser.is_active === false
                ? state.operators.filter((operator) => operator.id !== updatedUser.id)
                : (
                    updatedUser.role === 'operator' || state.operators.some((operator) => operator.id === updatedUser.id)
                        ? (
                            state.operators.some((operator) => operator.id === updatedUser.id)
                                ? state.operators.map((operator) =>
                                    operator.id === updatedUser.id ? normalizeOperator({ ...operator, ...updatedUser }) : operator
                                )
                                : [...state.operators, normalizeOperator(updatedUser)]
                        )
                        : state.operators
                ),
        }));

        const authUser = useAuthStore.getState().user;
        if (authUser?.id === updatedUser.id && updatedUser.is_active === false) {
            get().addAlert('Your access has been removed. Signing out.', 'error');
            window.setTimeout(() => {
                useAuthStore.getState().logout();
            }, 250);
        }
    },

    // Additional state for Product Experience
    cameraMode: 'overview', // 'overview' | 'focus' | 'alert'
    alerts: [], // Toast notifications

    // ── Selectors ───────────────────────────────────────
    setCameraMode: (mode) => set({ cameraMode: mode }),
    openAddMachineModal: () => set({ isAddMachineModalOpen: true }),
    closeAddMachineModal: () => set({ isAddMachineModalOpen: false }),
    openCreateTaskModal: (machineId = '') => set({ isCreateTaskModalOpen: true, createTaskMachineId: machineId || '' }),
    closeCreateTaskModal: () => set({ isCreateTaskModalOpen: false, createTaskMachineId: '' }),
    openAddUserModal: () => set({ isAddUserModalOpen: true }),
    closeAddUserModal: () => set({ isAddUserModalOpen: false }),
    openGlobalAIModal: () => set({ isGlobalAIModalOpen: true }),
    closeGlobalAIModal: () => set({ isGlobalAIModalOpen: false }),
    setTaskFilter: (taskFilter) => set({ taskFilter }),
    setTaskSort: (taskSort) => set({ taskSort }),
    setSelectedMachine: (machine) => set((state) => ({
        selectedMachine: machine,
        selectedTask: null,
        cameraMode: machine ? 'focus' : state.cameraMode
    })),
    setSelectedTask: (task) => set({ selectedTask: task }),
    clearSelection: () => set({ selectedMachine: null, selectedTask: null, cameraMode: 'overview' }),

    // ── Toast Alerts ────────────────────────────────────
    addAlert: (message, type = 'info') => {
        const id = Date.now();
        set((state) => ({
            ...state,
            alerts: [...state.alerts, { id, message, type }],
        }));
        setTimeout(() => {
            set((state) => ({
                ...state,
                alerts: state.alerts.filter((a) => a.id !== id),
            }));
        }, 5000);
    },

    // ── Real-time update (from WebSocket) ───────────────
    updateTask: (updatedTask) => {
        set((state) => {
            const oldTask = state.tasks.find((t) => t.id === updatedTask.id);
            // Trigger alert if task just became delayed
            if (oldTask && oldTask.status !== 'delayed' && updatedTask.status === 'delayed') {
                get().addAlert(`Task "${updatedTask.title}" was delayed.`, 'error');
                playAlertSound();
                if (get().cameraMode === 'alert') {
                    // Auto-focus logic handles it via FactoryScene
                }
            }
            return {
                ...state,
                tasks: oldTask
                    ? state.tasks.map((t) =>
                        t.id === updatedTask.id ? { ...t, ...updatedTask } : t
                    )
                    : [updatedTask, ...state.tasks],
                selectedTask: state.selectedTask?.id === updatedTask.id
                    ? { ...state.selectedTask, ...updatedTask }
                    : state.selectedTask,
            };
        });
    },

    updateMachine: (updatedMachine) => {
        set((state) => ({
            machines: state.machines.some((m) => m.id === updatedMachine.id)
                ? state.machines.map((m) =>
                    m.id === updatedMachine.id ? { ...m, ...updatedMachine } : m
                )
                : [updatedMachine, ...state.machines],
            selectedMachine: state.selectedMachine?.id === updatedMachine.id
                ? { ...state.selectedMachine, ...updatedMachine }
                : state.selectedMachine,
        }));
    },

    createUser: async ({ full_name, email, phone, role }) => {
        set({ creatingUser: true });

        try {
            const { data } = await api.post('/users/', {
                full_name,
                email,
                phone: phone || null,
                role,
            });

            const createdUser = normalizeUser({
                id: data.id,
                full_name: data.full_name,
                email: data.email,
                phone: phone || null,
                role: data.role,
                is_on_duty: false,
                current_task_count: 0,
            });

            set((state) => ({
                creatingUser: false,
                users: state.users.some((user) => user.id === createdUser.id)
                    ? state.users.map((user) =>
                        user.id === createdUser.id ? { ...user, ...createdUser } : user
                    )
                    : [...state.users, createdUser],
                operators: data.role === 'operator'
                    ? (
                        state.operators.some((operator) => operator.id === data.id)
                            ? state.operators.map((operator) =>
                                operator.id === data.id ? normalizeOperator({ ...operator, ...createdUser, status: 'offline' }) : operator
                            )
                            : [...state.operators, normalizeOperator({ ...createdUser, status: 'offline' })]
                    )
                    : state.operators,
            }));

            get().addAlert(`${data.role.charAt(0).toUpperCase() + data.role.slice(1)} "${data.full_name}" added successfully.`, 'success');
            await Promise.all([
                get().fetchDashboard(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);

            return data;
        } catch (error) {
            set({ creatingUser: false });
            throw new Error(getApiErrorMessage(error, 'Unable to add user right now.'));
        }
    },

    createClient: async ({ company_name, contact_person, email, phone, address, send_email = true }) => {
        try {
            const { data } = await api.post('/clients/', {
                company_name,
                contact_person,
                email,
                phone: phone || null,
                address: address || null,
                send_email,
            });

            set((state) => ({
                clients: state.clients.some((client) => client.id === data.id)
                    ? state.clients.map((client) => (client.id === data.id ? { ...client, ...data } : client))
                    : [data, ...state.clients],
                users: state.users.some((user) => user.id === data.id)
                    ? state.users.map((user) => (user.id === data.id ? normalizeUser({ ...user, ...data, role: 'client', full_name: data.contact_person }) : user))
                    : [...state.users, normalizeUser({
                        id: data.id,
                        email: data.email,
                        full_name: data.contact_person,
                        phone: data.phone,
                        role: 'client',
                        is_active: true,
                    })],
            }));

            get().addAlert(`Client "${data.company_name}" created successfully.`, 'success');
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to create client right now.'));
        }
    },

    deactivateUser: async (userId) => {
        try {
            await api.delete(`/users/${userId}`);
            set((state) => ({
                users: state.users.filter((user) => user.id !== userId),
                operators: state.operators.filter((op) => op.id !== userId)
            }));
            get().addAlert('User deactivated successfully.', 'success');
            await Promise.all([
                get().fetchDashboard(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);
        } catch (error) {
            get().addAlert(getApiErrorMessage(error, 'Unable to deactivate user.'), 'error');
            throw error;
        }
    },

    createMachine: async ({ name, grid_x = 0, grid_y = 0 }) => {
        set({ creatingMachine: true });

        try {
            const { data } = await api.post('/machines/', {
                name,
                grid_x,
                grid_y,
            });

            set((state) => ({
                creatingMachine: false,
                machines: state.machines.some((machine) => machine.id === data.id)
                    ? state.machines.map((machine) =>
                        machine.id === data.id ? { ...machine, ...data } : machine
                    )
                    : [data, ...state.machines],
                selectedMachine: data,
                cameraMode: 'focus',
            }));

            get().addAlert(`Machine "${data.name}" created successfully.`, 'success');
            await Promise.all([
                get().fetchDashboard(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);

            return data;
        } catch (error) {
            set({ creatingMachine: false });
            throw new Error(getApiErrorMessage(error, 'Unable to create machine right now.'));
        }
    },

    createTask: async ({ title, description, machine_id, priority, client_id, estimated_completion }) => {
        set({ creatingTask: true });

        try {
            const { data } = await api.post('/tasks/', {
                title,
                description: description || null,
                machine_id: machine_id || null,
                priority,
                client_id: client_id || null,
                estimated_completion: estimated_completion || null,
            });

            const machine = get().machines.find((item) => item.id === data.machine_id) || null;
            set((state) => ({
                creatingTask: false,
                tasks: state.tasks.some((task) => task.id === data.id)
                    ? state.tasks.map((task) => (task.id === data.id ? { ...task, ...data } : task))
                    : [data, ...state.tasks],
                selectedTask: data,
                selectedMachine: machine || state.selectedMachine,
                cameraMode: machine ? 'focus' : state.cameraMode,
            }));

            get().addAlert(`Task "${data.title}" created successfully.`, 'success');
            await Promise.all([
                get().fetchDashboard(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);
            return data;
        } catch (error) {
            set({ creatingTask: false });
            throw new Error(getApiErrorMessage(error, 'Unable to create task right now.'));
        }
    },

    assignTask: async (taskId, assignedTo) => {
        try {
            const { data } = await api.patch(`/tasks/${taskId}/assign`, {
                assigned_to: assignedTo,
            });
            get().updateTask(data);
            get().addAlert(`Task "${data.title}" assigned successfully.`, 'success');
            await Promise.all([
                get().fetchDashboard(),
                get().fetchOperators(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to assign that task right now.'));
        }
    },

    updateTaskStatus: async (taskId, newStatus) => {
        try {
            const { data } = await api.patch(`/tasks/${taskId}/status`, null, {
                params: { new_status: newStatus },
            });
            get().updateTask(data);
            await Promise.all([
                get().fetchDashboard(),
                get().fetchOperators(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to update task status right now.'));
        }
    },

    toggleDuty: async (operatorId) => {
        set({ togglingDuty: true });
        try {
            const { data } = await api.post('/operator/toggle-duty');
            get().updateOperator({
                id: operatorId,
                is_on_duty: data.is_on_duty,
                last_active_at: data.last_active_at,
            });
            get().addAlert(data.message || 'Duty status updated.', 'success');
            await Promise.all([
                get().fetchDashboard(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to toggle duty right now.'));
        } finally {
            set({ togglingDuty: false });
        }
    },

    updateCompanyProfile: async (payload) => {
        set({ savingCompanyProfile: true });
        try {
            const { data } = await api.patch('/owner/company-profile', payload);
            set((state) => ({
                savingCompanyProfile: false,
                ownerBusiness: state.ownerBusiness ? { ...state.ownerBusiness, company: data } : state.ownerBusiness,
            }));
            get().addAlert('Company profile updated successfully.', 'success');
            await Promise.all([get().fetchOwnerBusinessOverview(), get().fetchDashboard()]);
            return data;
        } catch (error) {
            set({ savingCompanyProfile: false });
            throw new Error(getApiErrorMessage(error, 'Unable to update company profile right now.'));
        }
    },

    generateReport: async ({ title, report_type, period_start, period_end }) => {
        set({ generatingReport: true });
        try {
            const { data } = await api.post('/reports/generate', {
                title,
                report_type,
                period_start,
                period_end,
            });
            get().addAlert(`Report "${data.title}" generated successfully.`, 'success');
            await Promise.all([get().fetchReports(), get().fetchOwnerBusinessOverview()]);
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to generate report right now.'));
        } finally {
            set({ generatingReport: false });
        }
    },

    downloadOwnerExport: async (format) => {
        const exportConfig = format === 'pdf'
            ? {
                endpoint: '/owner/export/pdf',
                filename: 'mechtrack_report.pdf',
            }
            : {
                endpoint: '/owner/export/csv',
                filename: 'mechtrack_export.csv',
            };

        try {
            const response = await api.get(exportConfig.endpoint, { responseType: 'blob' });
            triggerBrowserDownload(response.data, exportConfig.filename);
            get().addAlert(`${format.toUpperCase()} export downloaded.`, 'success');
        } catch (error) {
            throw new Error(getApiErrorMessage(error, `Unable to download ${format.toUpperCase()} export right now.`));
        }
    },

    // ── Task helper: get tasks for a machine ────────────
    getTasksForMachine: (machineId) => {
        return get().tasks.filter((t) => t.machine_id === machineId);
    },
    getVisibleTasks: (machineId = null) => {
        const { tasks, taskFilter, taskSort } = get();
        const scopedTasks = machineId ? tasks.filter((task) => task.machine_id === machineId) : tasks;
        return sortTasks(filterTasks(scopedTasks, taskFilter), taskSort);
    },

    // ── Machine status derived from tasks ───────────────
    getMachineStatus: (machineId) => {
        const tasks = get().tasks.filter((t) => t.machine_id === machineId);
        if (tasks.some((t) => t.status === 'delayed')) return 'delayed';
        if (tasks.some((t) => ACTIVE_TASK_STATUSES.has(t.status) && t.status !== 'delayed' && t.status !== 'completed')) return 'in_progress';
        if (tasks.some((t) => t.status === 'completed')) return 'completed';
        return 'idle';
    },

    // ── Machine delay risk ──────────────────────────────
    getMachineDelayRisk: (machineId) => {
        const tasks = get().tasks.filter((t) => t.machine_id === machineId);
        let maxRisk = 0;
        tasks.forEach((t) => {
            if (t.status !== 'completed' && t.delay_probability != null) {
                maxRisk = Math.max(maxRisk, t.delay_probability);
            }
        });
        return maxRisk;
    },

    // ── CNC Job State ────────────────────────────────────
    jobSpecs: {},           // { [taskId]: { specs, is_locked, all_confirmed } }
    jobProcesses: {},       // { [taskId]: { operations, total_cycle_time_minutes } }
    loadingJobSpecs: false,
    loadingJobProcesses: false,
    lockingJob: false,
    triggeringRework: false,
    isJobCreationModalOpen: false,

    openJobCreationModal: () => set({ isJobCreationModalOpen: true }),
    closeJobCreationModal: () => set({ isJobCreationModalOpen: false }),

    // ── Create CNC Job (full flow) ───────────────────────
    createCNCJob: async ({ title, description, priority, client_id, machine_id, part_name, material_type, material_batch, drawing_url, estimated_completion }) => {
        set({ creatingTask: true });
        try {
            // Step 1: Create the base task
            const { data } = await api.post('/tasks/', {
                title,
                description: description || null,
                machine_id: machine_id || null,
                priority: priority || 'medium',
                client_id: client_id || null,
                estimated_completion: estimated_completion || null,
            });

            // Step 2: Set CNC-specific fields
            if (part_name || material_type || material_batch || drawing_url) {
                const { data: cncData } = await api.patch(`/tasks/${data.id}/cnc-fields`, {
                    part_name: part_name || null,
                    material_type: material_type || null,
                    material_batch: material_batch || null,
                    drawing_url: drawing_url || null,
                });
                Object.assign(data, cncData);
            }

            set((state) => ({
                creatingTask: false,
                tasks: state.tasks.some((t) => t.id === data.id)
                    ? state.tasks.map((t) => (t.id === data.id ? { ...t, ...data } : t))
                    : [data, ...state.tasks],
                selectedTask: data,
            }));

            get().addAlert(`Job "${data.title}" created. Now extract drawing specs.`, 'success');
            await Promise.all([
                get().fetchDashboard(),
                shouldRefreshOwnerBusiness() ? get().fetchOwnerBusinessOverview() : Promise.resolve(),
            ]);
            return data;
        } catch (error) {
            set({ creatingTask: false });
            throw new Error(getApiErrorMessage(error, 'Unable to create job right now.'));
        }
    },

    // ── Job Specs ────────────────────────────────────────
    fetchJobSpecs: async (taskId) => {
        set({ loadingJobSpecs: true });
        try {
            const { data } = await api.get(`/job-specs/${taskId}`);
            set((state) => ({
                jobSpecs: { ...state.jobSpecs, [taskId]: data },
                loadingJobSpecs: false,
            }));
            return data;
        } catch (error) {
            void error;
            set({ loadingJobSpecs: false });
            return null;
        }
    },

    extractJobSpecs: async (taskId, { drawing_context, drawing_image_url, part_name }) => {
        try {
            const { data } = await api.post(`/job-specs/${taskId}/extract`, {
                drawing_context,
                drawing_image_url,
                part_name,
            });
            set((state) => ({
                jobSpecs: {
                    ...state.jobSpecs,
                    [taskId]: { ...state.jobSpecs[taskId], specs: data.specs, all_confirmed: false },
                },
            }));
            get().addAlert(
                data.message || 'AI extraction complete.',
                data.source === 'ai_llm' || data.source === 'ai_vision' ? 'success' : 'info'
            );
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'AI extraction failed.'));
        }
    },

    updateJobSpec: async (specId, { human_value, is_confirmed }) => {
        try {
            const { data } = await api.patch(`/job-specs/spec/${specId}`, { human_value, is_confirmed });
            // Update in local state
            set((state) => {
                const newJobSpecs = { ...state.jobSpecs };
                Object.keys(newJobSpecs).forEach((taskId) => {
                    if (newJobSpecs[taskId]?.specs) {
                        newJobSpecs[taskId] = {
                            ...newJobSpecs[taskId],
                            specs: newJobSpecs[taskId].specs.map((s) =>
                                s.id === specId ? { ...s, ...data } : s
                            ),
                        };
                    }
                });
                return { jobSpecs: newJobSpecs };
            });
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to update spec.'));
        }
    },

    confirmAllSpecs: async (taskId) => {
        try {
            const { data } = await api.post(`/job-specs/${taskId}/confirm-all`);
            set((state) => ({
                jobSpecs: {
                    ...state.jobSpecs,
                    [taskId]: {
                        ...state.jobSpecs[taskId],
                        all_confirmed: true,
                        specs: (state.jobSpecs[taskId]?.specs || []).map((s) => ({
                            ...s,
                            is_confirmed: true,
                            human_value: s.human_value || s.ai_value,
                        })),
                    },
                },
            }));
            get().addAlert(data.message || 'All specs confirmed.', 'success');
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to confirm specs.'));
        }
    },

    // ── Lock Job ─────────────────────────────────────────
    lockJob: async (taskId) => {
        set({ lockingJob: true });
        try {
            const { data } = await api.post(`/tasks/${taskId}/lock`);
            // Update task in store
            set((state) => ({
                lockingJob: false,
                tasks: state.tasks.map((t) =>
                    t.id === taskId ? { ...t, is_locked: true, status: 'created' } : t
                ),
                selectedTask: state.selectedTask?.id === taskId
                    ? { ...state.selectedTask, is_locked: true, status: 'created' }
                    : state.selectedTask,
            }));
            get().addAlert('Job locked. Process planning ready.', 'success');
            return data;
        } catch (error) {
            set({ lockingJob: false });
            throw new Error(getApiErrorMessage(error, 'Unable to lock job.'));
        }
    },

    // ── Job Processes ────────────────────────────────────
    fetchJobProcesses: async (taskId) => {
        set({ loadingJobProcesses: true });
        try {
            const { data } = await api.get(`/job-processes/${taskId}`);
            set((state) => ({
                jobProcesses: { ...state.jobProcesses, [taskId]: data },
                loadingJobProcesses: false,
            }));
            return data;
        } catch (error) {
            void error;
            set({ loadingJobProcesses: false });
            return null;
        }
    },

    aiSuggestProcesses: async (taskId) => {
        try {
            const { data } = await api.post(`/job-processes/${taskId}/suggest`);
            set((state) => ({
                jobProcesses: {
                    ...state.jobProcesses,
                    [taskId]: { ...state.jobProcesses[taskId], operations: data.operations },
                },
            }));
            get().addAlert(data.message || 'AI process plan suggested.', 'success');
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'AI suggestion failed.'));
        }
    },

    validateProcessPlan: async (taskId) => {
        try {
            const { data } = await api.post(`/job-processes/${taskId}/validate`);
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Validation failed.'));
        }
    },

    lockProcessPlan: async (taskId) => {
        try {
            const { data } = await api.post(`/job-processes/${taskId}/lock`);
            set((state) => ({
                tasks: state.tasks.map((t) =>
                    t.id === taskId ? { ...t, status: data.status } : t
                ),
                selectedTask: state.selectedTask?.id === taskId
                    ? { ...state.selectedTask, status: data.status }
                    : state.selectedTask,
            }));
            get().addAlert('Process plan locked. Job status → planned.', 'success');
            return data;
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Unable to lock process plan.'));
        }
    },

    // ── Trigger Rework ───────────────────────────────────
    triggerRework: async (taskId, { rework_reason, reassign_to }) => {
        set({ triggeringRework: true });
        try {
            const { data } = await api.post(`/tasks/${taskId}/rework`, {
                rework_reason,
                reassign_to: reassign_to || null,
            });
            set((state) => ({
                triggeringRework: false,
                tasks: state.tasks.map((t) =>
                    t.id === taskId ? {
                        ...t,
                        rework_flag: true,
                        rework_iteration: data.rework_iteration,
                        rework_reason: rework_reason,
                        status: 'in_progress',
                    } : t
                ),
                selectedTask: state.selectedTask?.id === taskId
                    ? { ...state.selectedTask, rework_flag: true, rework_iteration: data.rework_iteration, status: 'in_progress' }
                    : state.selectedTask,
            }));
            get().addAlert(`Rework triggered (iteration #${data.rework_iteration}).`, 'warning');
            return data;
        } catch (error) {
            set({ triggeringRework: false });
            throw new Error(getApiErrorMessage(error, 'Unable to trigger rework.'));
        }
    },
}));

export default useAppStore;
