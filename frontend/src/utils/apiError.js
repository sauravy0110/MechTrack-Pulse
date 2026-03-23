export function getApiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
    const detail = error?.response?.data?.detail;

    if (Array.isArray(detail)) {
        const message = detail
            .map((item) => item?.msg)
            .filter(Boolean)
            .join(', ');

        if (message) {
            return message;
        }
    }

    if (typeof detail === 'string' && detail.trim()) {
        return detail;
    }

    if (typeof error?.response?.data?.message === 'string' && error.response.data.message.trim()) {
        return error.response.data.message;
    }

    if (!error?.response) {
        return 'Unable to reach the server. Check your connection and try again.';
    }

    return fallback;
}
