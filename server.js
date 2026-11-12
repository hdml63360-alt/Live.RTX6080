const WebSocket = require('ws');

// تنظیمات پورت (Render از متغیر محیطی PORT استفاده می‌کند)
const port = process.env.PORT || 10000;

// ایجاد سرور WebSocket با تنظیمات پیشرفته برای پایداری بیشتر
const wss = new WebSocket.Server({ 
    port,
    maxPayload: 1024 * 1024 * 5 // حداکثر ۵ مگابایت برای هر پیام (برای سیگنال‌های WebRTC)
});

// ذخیره اتاق‌ها: Map<RoomId, Set<WebSocket>>
const rooms = new Map();

// سیستم Heartbeat برای تشخیص قطعی ناگهانی کاربران
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`[Terminated] ${ws.userId || 'Unknown'} - Connection lost.`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(); // ارسال پینگ شبکه‌ای
    });
}, 30000); // هر ۳۰ ثانیه چک می‌کند

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

wss.on('connection', (ws) => {
    ws.isAlive = true;
    
    // وقتی مرورگر پاسخ پینگ شبکه‌ای را داد
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (data) => {
        let msg;
        try { 
            msg = JSON.parse(data); 
        } catch (e) { 
            return; // اگر پیام ساختار JSON نداشت، نادیده بگیر
        }

        // ۱. مدیریت پینگ و پونگ سفارشی (برای بیدار نگه داشتن Render)
        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;
        }

        // ۲. مدیریت ورود به اتاق (چه لایو، چه چت)
        if (msg.type === 'join') {
            // اگر کاربر قبلاً در اتاقی بوده، اول از آن خارجش کن
            if (ws.roomId && rooms.has(ws.roomId)) {
                rooms.get(ws.roomId).delete(ws);
            }

            if (!rooms.has(msg.room)) {
                rooms.set(msg.room, new Set());
            }
            
            rooms.get(msg.room).add(ws);
            ws.roomId = msg.room;
            ws.userId = msg.userId;
            
            console.log(`[JOIN] ${ws.userId} joined room: ${ws.roomId}`);
            
            // اطلاع دادن به بقیه اعضای اتاق که یک نفر جدید آمد
            broadcastToRoom(ws.roomId, { type: 'user-joined', userId: ws.userId }, ws);
            return;
        }

        // ۳. مدیریت خروج عمدی کاربر (وقتی دکمه خروج را می‌زند)
        if (msg.type === 'leave') {
            handleLeave(ws);
            return;
        }

        // ۴. فوروارد کردن پیام‌ها و سیگنال‌ها به بقیه اعضای اتاق
        if (ws.roomId) {
            broadcastToRoom(ws.roomId, msg, ws);
        }
    });

    ws.on('close', () => {
        handleLeave(ws);
    });

    ws.on('error', (err) => {
        console.error(`[ERROR] WebSocket error for ${ws.userId || 'Unknown'}:`, err.message);
        handleLeave(ws);
    });
});

// تابع کمکی برای ارسال پیام به همه افراد یک اتاق (به جز خود فرستنده)
function broadcastToRoom(roomId, message, senderWs) {
    const room = rooms.get(roomId);
    if (room) {
        const messageString = typeof message === 'string' ? message : JSON.stringify(message);
        
        room.forEach(client => {
            // پیام را فقط به افراد باز و به جز فرستنده بفرست
            if (client !== senderWs && client.readyState === WebSocket.OPEN) {
                // اگر پیام targetId داشت، فقط برای فرد هدف بفرست (برای چت خصوصی)
                if (message.targetId && message.targetId !== client.userId) {
                    return; 
                }
                client.send(messageString);
            }
        });
    }
}

// تابع کمکی برای خروج و پاکسازی کاربر
function handleLeave(ws) {
    if (ws.roomId && rooms.has(ws.roomId)) {
        rooms.get(ws.roomId).delete(ws);
        
        // اطلاع به بقیه که کاربر خارج شد (برای لایو بسیار مهم است)
        broadcastToRoom(ws.roomId, { type: 'user-left', userId: ws.userId });
        
        // اگر اتاق خالی شد، حافظه را آزاد کن
        if (rooms.get(ws.roomId).size === 0) {
            rooms.delete(ws.roomId);
            console.log(`[ROOM CLOSED] Room ${ws.roomId} is now empty and removed.`);
        } else {
            console.log(`[LEAVE] ${ws.userId || 'Unknown'} left room: ${ws.roomId}`);
        }
    }
    ws.roomId = null;
    ws.userId = null;
}

console.log(`🚀 Arisa Advanced Server is running on port ${port}`);
console.log(`Waiting for connections...`);
