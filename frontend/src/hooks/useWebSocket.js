import { useCallback, useEffect, useRef } from 'react';
import useAppStore from '../stores/appStore';

/**
 * WebSocket hook for real-time updates.
 * Connects to the backend using JWT, subscribes to company room.
 * Updates only changed elements in the store — no full refetch.
 */
export default function useWebSocket(companyId) {
    const wsRef = useRef(null);
    const shouldReconnectRef = useRef(true);
    const reconnectTimeoutRef = useRef(null);
    const dashboardRefreshTimeoutRef = useRef(null);
    const connectRef = useRef(null);
    const retryCountRef = useRef(0);
    const MAX_RETRIES = 10;

    const updateTask = useAppStore((state) => state.updateTask);
    const updateMachine = useAppStore((state) => state.updateMachine);
    const updateOperator = useAppStore((state) => state.updateOperator);
    const updateUser = useAppStore((state) => state.updateUser);
    const removeTaskById = useAppStore((state) => state.removeTaskById);
    const refreshTaskSurfaces = useAppStore((state) => state.refreshTaskSurfaces);
    const addAlert = useAppStore((state) => state.addAlert);

    const scheduleDashboardRefresh = useCallback(() => {
        if (dashboardRefreshTimeoutRef.current) {
            window.clearTimeout(dashboardRefreshTimeoutRef.current);
        }

        dashboardRefreshTimeoutRef.current = window.setTimeout(() => {
            refreshTaskSurfaces();
        }, 250);
    }, [refreshTaskSurfaces]);

    const connect = useCallback(() => {
        if (!companyId) {
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            return;
        }

        // Derive WS URL from the API URL so it always points to the backend (Render),
        // never the frontend host (Vercel doesn't support WebSockets).
        const configuredWs = import.meta.env.VITE_WS_BASE_URL?.replace(/\/$/, '');
        let base;
        if (configuredWs) {
            base = configuredWs;
        } else if (import.meta.env.DEV) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            base = `${protocol}//127.0.0.1:8000`;
        } else {
            // Production: convert VITE_API_URL (https://xxx.onrender.com/api/v1) → wss://xxx.onrender.com
            const apiUrl = import.meta.env.VITE_API_URL || '';
            const origin = apiUrl.replace(/\/api\/v1\/?$/, '');
            base = origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
        }
        const url = `${base}/api/v1/ws/${companyId}?token=${encodeURIComponent(token)}`;

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                retryCountRef.current = 0;
                useAppStore.setState({ wsStatus: 'connected' });
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    switch (msg.type) {
                        case 'task_update':
                            updateTask(msg.data);
                            scheduleDashboardRefresh();
                            break;
                        case 'machine_update':
                            updateMachine(msg.data);
                            scheduleDashboardRefresh();
                            break;
                        case 'operator_update':
                            updateOperator(msg.data);
                            scheduleDashboardRefresh();
                            break;
                        case 'user_update':
                            updateUser(msg.data);
                            scheduleDashboardRefresh();
                            break;
                        case 'task_deleted':
                            removeTaskById(msg.data?.id);
                            scheduleDashboardRefresh();
                            break;
                        case 'notification':
                            addAlert(msg.message, msg.severity || 'info');
                            break;
                        case 'dashboard_refresh':
                            refreshTaskSurfaces();
                            break;
                        default:
                            break;
                    }
                } catch (err) {
                    console.warn('[WS] Parse error:', err);
                }
            };

            ws.onclose = () => {
                if (!shouldReconnectRef.current) {
                    useAppStore.setState({ wsStatus: 'disconnected' });
                    return;
                }

                if (retryCountRef.current >= MAX_RETRIES) {
                    useAppStore.setState({ wsStatus: 'disconnected' });
                    console.warn('[WS] Max retries reached, giving up.');
                    return;
                }

                retryCountRef.current += 1;
                const delay = Math.min(3000 * Math.pow(2, retryCountRef.current - 1), 30000);
                useAppStore.setState({ wsStatus: 'reconnecting' });
                reconnectTimeoutRef.current = window.setTimeout(() => {
                    if (shouldReconnectRef.current && connectRef.current) {
                        connectRef.current();
                    }
                }, delay);
            };

            ws.onerror = () => {
                ws.close();
            };
        } catch {
            if (retryCountRef.current < MAX_RETRIES) {
                retryCountRef.current += 1;
                const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 30000);
                reconnectTimeoutRef.current = window.setTimeout(() => {
                    if (connectRef.current) {
                        connectRef.current();
                    }
                }, delay);
            }
        }
    }, [companyId, updateTask, updateMachine, updateOperator, updateUser, removeTaskById, refreshTaskSurfaces, addAlert, scheduleDashboardRefresh]);

    useEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    useEffect(() => {
        shouldReconnectRef.current = true;
        connect();

        return () => {
            shouldReconnectRef.current = false;
            if (reconnectTimeoutRef.current) {
                window.clearTimeout(reconnectTimeoutRef.current);
            }
            if (dashboardRefreshTimeoutRef.current) {
                window.clearTimeout(dashboardRefreshTimeoutRef.current);
            }
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
            }
        };
    }, [connect]);
}
