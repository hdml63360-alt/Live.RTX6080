const WebSocket = require('ws');
const port = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port });

const rooms = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;
        }

        if (msg.type === 'join') {
            if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
            rooms.get(msg.room).add(ws);
            ws.roomId = msg.room;
            ws.userId = msg.userId;
            return;
        }

        const room = rooms.get(ws.roomId);
        if (room) {
            room.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(data.toString());
                }
            });
        }
    });

    ws.on('close', () => {
        if (ws.roomId && rooms.has(ws.roomId)) {
            rooms.get(ws.roomId).delete(ws);
            if (rooms.get(ws.roomId).size === 0) rooms.delete(ws.roomId);
        }
    });
});

console.log(`Signal server running on port ${port}`);
