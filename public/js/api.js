// public/js/api.js
export const API = {
    async getConfig() {
        const res = await fetch('/api/config');
        return res.json();
    },
    async postTelemetry(data) {
        try {
            await fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) { /* 蹇界暐缃戠粶閿欒 */ }
    },
    async postEvent(type, data) {
        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, ...data })
            });
            return res.json();
        } catch (e) { return null; }
    },
    async postTrip(data) {
        try {
            const res = await fetch('/api/trips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.json();
        } catch (e) { return null; }
    },
    connectWS(onMessage) {
        try {
            const ws = new WebSocket(`ws://${location.host}`);
            ws.onmessage = (ev) => {
                try { onMessage(JSON.parse(ev.data)); } catch (e) { /* 蹇界暐 */ }
            };
            ws.onerror = () => { };
            return ws;
        } catch (e) {
            return null;
        }
    }
};