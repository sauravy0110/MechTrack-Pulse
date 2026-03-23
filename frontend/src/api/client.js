import axios from 'axios';
import axiosRetry from 'axios-retry';
import { isTokenExpired } from '../utils/token';

const apiBaseURL = (import.meta.env.VITE_API_URL || '') + '/api/v1';

const api = axios.create({
    baseURL: apiBaseURL,
    headers: { 'Content-Type': 'application/json' },
});

const refreshClient = axios.create({
    baseURL: apiBaseURL,
    headers: { 'Content-Type': 'application/json' },
});

// Setup Retry (Step 1 Infra requirement)
axiosRetry(api, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        // Retry on network errors or 5xx
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status >= 500;
    }
});

let isRefreshing = false;
let failedQueue = [];

const clearAuth = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
};

const processQueue = (error, token = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

// ── Request Interceptor ─────────────────────────────────────
api.interceptors.request.use(async (config) => {
    let token = localStorage.getItem('token');
    const url = config.url || '';

    // Skip interceptor for auth routes
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
        return config;
    }

    // Proactive refresh mechanism
    if (token && isTokenExpired()) {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
            clearAuth();
            window.location.assign('/login');
            return Promise.reject(new Error('Tokens expired'));
        }

        if (isRefreshing) {
            return new Promise(function (resolve, reject) {
                failedQueue.push({ resolve, reject });
            }).then(newToken => {
                config.headers.Authorization = `Bearer ${newToken}`;
                return config;
            }).catch(err => Promise.reject(err));
        }

        isRefreshing = true;
        try {
            const { data } = await refreshClient.post('/auth/refresh', { refresh_token: refreshToken });
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);

            token = data.access_token;
            processQueue(null, token);
        } catch (error) {
            processQueue(error, null);
            clearAuth();
            window.location.assign('/login');
            return Promise.reject(error);
        } finally {
            isRefreshing = false;
        }
    }

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ── Response Interceptor ────────────────────────────────────
api.interceptors.response.use(
    (res) => res,
    async (error) => {
        const originalRequest = error.config;
        const url = originalRequest?.url || '';

        // Handle 401 specifically for refresh flow, though proactive refresh usually catches it
        if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !url.includes('/auth/')) {
            if (isRefreshing) {
                return new Promise(function (resolve, reject) {
                    failedQueue.push({ resolve, reject });
                }).then(token => {
                    originalRequest.headers.Authorization = 'Bearer ' + token;
                    return api(originalRequest);
                }).catch(err => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
                clearAuth();
                window.location.assign('/login');
                return Promise.reject(error);
            }

            try {
                const { data } = await refreshClient.post('/auth/refresh', { refresh_token: refreshToken });
                localStorage.setItem('token', data.access_token);
                localStorage.setItem('refresh_token', data.refresh_token);
                processQueue(null, data.access_token);

                originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
                return api(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError, null);
                clearAuth();
                window.location.assign('/login');
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
        return Promise.reject(error);
    }
);

export default api;
