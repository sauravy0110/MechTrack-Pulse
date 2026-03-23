/**
 * Decode a JWT and check if it's expired.
 * Returns true if the token is missing or expired.
 */
export function isTokenExpired() {
    const token = localStorage.getItem('token');
    if (!token) return true;

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        // exp is in seconds, Date.now() is in milliseconds
        return payload.exp * 1000 < Date.now();
    } catch {
        return true;
    }
}

/**
 * Get seconds remaining until token expiry.
 * Returns 0 if expired or invalid.
 */
export function getTokenTTL() {
    const token = localStorage.getItem('token');
    if (!token) return 0;

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const remaining = (payload.exp * 1000 - Date.now()) / 1000;
        return Math.max(0, Math.floor(remaining));
    } catch {
        return 0;
    }
}
