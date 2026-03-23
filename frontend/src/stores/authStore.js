import { create } from 'zustand';
import api from '../api/client';

const useAuthStore = create((set, get) => ({
    token: localStorage.getItem('token') || null,
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    loading: false,
    error: null,

    login: async (email, password) => {
        set({ loading: true, error: null });
        try {
            const { data } = await api.post('/auth/login', { email, password });
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            set({ token: data.access_token, loading: false });

            // Fetch user profile
            const profile = await api.get('/auth/me');
            localStorage.setItem('user', JSON.stringify(profile.data));
            set({ user: profile.data });

            return data;
        } catch (err) {
            const msg = err.response?.data?.detail || 'Login failed';
            set({ loading: false, error: msg });
            throw err;
        }
    },

    changePassword: async (currentPassword, newPassword) => {
        set({ loading: true, error: null });
        try {
            await api.post('/auth/change-password', {
                current_password: currentPassword,
                new_password: newPassword,
            });

            const profile = await api.get('/auth/me');
            localStorage.setItem('user', JSON.stringify(profile.data));
            set({ user: profile.data, loading: false });
        } catch (err) {
            const msg = err.response?.data?.detail || 'Password change failed';
            set({ loading: false, error: msg });
            throw err;
        }
    },

    logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        set({ token: null, user: null });
        window.location.assign('/login');
    },

    isAuthenticated: () => !!get().token,
}));

export default useAuthStore;
