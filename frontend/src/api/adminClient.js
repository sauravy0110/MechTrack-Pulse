import axios from 'axios';

const apiBaseURL = (import.meta.env.VITE_API_URL || '') + '/api/v1';

const adminClient = axios.create({
    baseURL: apiBaseURL,
    headers: { 'Content-Type': 'application/json' },
});

adminClient.interceptors.request.use((config) => {
    const url = config.url || '';
    const token = localStorage.getItem('admin_token');

    if (!url.includes('/platform/login') && token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

adminClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('admin_token');
            if (window.location.pathname !== '/admin/login') {
                window.location.assign('/admin/login');
            }
        }

        return Promise.reject(error);
    }
);

export default adminClient;
