// public/js/api.js

export const API = {
    // 获取车辆配置
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

    // 上报实时遥测数据
    async postTelemetry(data) {
        try {
            await fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) {
            // 忽略网络错误，防止刷屏
        }
    },

    // 上报事件（如泊车、AEB等）
    async postEvent(type, data) {
        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, ...data })
            });
            return await res.json();
        } catch (e) {
            return null;
        }
    },

    // 保存行程
    async postTrip(data) {
        try {
            const res = await fetch('/api/trips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return await res.json();
        } catch (e) {
            return null;
        }
    },

    // 建立 WebSocket 连接（自动适配 http/https）
    connectWS(onMessage) {
        try {
            // 核心修复：如果在 https 环境下，必须使用 wss://
            const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
            const wsUrl = `${protocol}${location.host}`;

            console.log(`正在尝试连接 WebSocket: ${wsUrl}`);
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log("WebSocket 连接成功！");
            };

            ws.onmessage = (ev) => {
                try {
                    onMessage(JSON.parse(ev.data));
                } catch (e) {
                    // 忽略解析错误
                }
            };

            ws.onerror = (err) => {
                console.warn("WebSocket 连接发生错误，请检查后端服务是否正常。", err);
            };

            ws.onclose = () => {
                console.log("WebSocket 连接已关闭。");
            };

            return ws;
        } catch (e) {
            console.warn("WebSocket 初始化失败:", e);
            return null;
        }
    }
};