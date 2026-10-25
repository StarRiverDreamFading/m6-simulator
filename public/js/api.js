// public/js/api.js

export const API = {
    async getConfig() {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) throw new Error('Network response was not ok');
            return await res.json();
        } catch (e) {
            console.warn("获取配置失败:", e);
            return null;
        }
    },

    async postTelemetry(data) {
        try {
            await fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) { }
    },

    async postEvent(type, data) {
        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, ...data })
            });
            return await res.json();
        } catch (e) { return null; }
    },

    async postTrip(data) {
        try {
            const res = await fetch('/api/trips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return await res.json();
        } catch (e) { return null; }
    },

    connectWS(onMessage) {
        try {
            // 动态适配 wss 或 ws
            const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
            const wsUrl = `${protocol}${location.host}`;

            const ws = new WebSocket(wsUrl);
            ws.onmessage = (ev) => {
                try { onMessage(JSON.parse(ev.data)); } catch (e) { }
            };
            return ws;
        } catch (e) {
            return null;
        }
    }
};