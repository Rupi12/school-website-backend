// Sends push notifications via Expo's push service (no SDK needed — plain HTTPS).
// Accepts an array of Expo push tokens; skips invalid/empty ones and never throws
// to the caller, so a push failure can't break the request that triggered it.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendPushToTokens(tokens, title, body, data = {}) {
    try {
        const valid = (tokens || []).filter(
            (t) => typeof t === 'string' && t.startsWith('ExponentPushToken')
        );
        if (valid.length === 0) return;

        // Expo accepts up to 100 messages per request.
        for (let i = 0; i < valid.length; i += 100) {
            const messages = valid.slice(i, i + 100).map((to) => ({
                to,
                sound: 'default',
                title,
                body,
                data,
            }));
            await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(messages),
            });
        }
    } catch (e) {
        console.error('Push send failed:', e.message);
    }
}

module.exports = { sendPushToTokens };
