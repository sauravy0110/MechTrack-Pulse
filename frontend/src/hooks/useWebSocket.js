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

    const updateTask = useAppStore((state) => state.updateTask);
    const updateMachine = useAppStore((state) => state.updateMachine);
    const updateOperator = useAppStore((state) => state.updateOperator);
    const updateUser = useAppStore((state) => state.updateUser);
    const fetchDashboard = useAppStore((state) => state.fetchDashboard);
    const addAlert = useAppStore((state) => state.addAlert);

    const scheduleDashboardRefresh = useCallback(() => {
        if (dashboardRefreshTimeoutRef.current) {
            window.clearTimeout(dashboardRefreshTimeoutRef.current);
        }

        dashboardRefreshTimeoutRef.current = window.setTimeout(() => {
            fetchDashboard();
        }, 250);
    }, [fetchDashboard]);

    const connect = useCallback(() => {
        if (!companyId) {
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            return;
        }

        const configuredBase = import.meta.env.VITE_WS_BASE_URL?.replace(/\/$/, '');
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const hostBase = `${protocol}//${window.location.host}`;
        const devBase = import.meta.env.DEV ? `${protocol}//127.0.0.1:8000` : hostBase;
        const base = configuredBase || devBase;
        const url = `${base}/api/v1/ws/${companyId}?token=${encodeURIComponent(token)}`;

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
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
                        case 'notification':
                            addAlert(msg.message, msg.severity || 'info');
                            break;
                        case 'dashboard_refresh':
                            fetchDashboard();
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

                useAppStore.setState({ wsStatus: 'reconnecting' });
                reconnectTimeoutRef.current = window.setTimeout(() => {
                    if (shouldReconnectRef.current && connectRef.current) {
                        connectRef.current();
                    }
                }, 3000);
            };

            ws.onerror = () => {
                ws.close();
            };
        } catch {
            reconnectTimeoutRef.current = window.setTimeout(() => {
                if (connectRef.current) {
                    connectRef.current();
                }
            }, 5000);
        }
    }, [companyId, updateTask, updateMachine, updateOperator, updateUser, fetchDashboard, addAlert, scheduleDashboardRefresh]);

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
