const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const WP_SITE_URL = "https://bharatpurmart.com";
const SECRET_KEY = "MERA_SUPER_SECRET_KEY_Param#108Martgame@live"; // Keep identical to WP

const BOT_NAMES = [
    "Rahul_Sharma", "Pooja_99", "Vikram_RJ", "Amit_Verma", 
    "Neha_Patel", "Deepak_Kumar", "Suresh_Meena", "Anjali_Singh",
    "Rajendra", "Deepali", "jaat_boy", "amar_pratap",
    "Manish_Yadav", "Kavita_Rathore", "Sachin_Gupta", "Ritu_Choudhary"
];

let queues = {};
let queueTimers = {};
let activeRooms = {};
let privateRooms = {}; // Store private room codes

app.get('/', (req, res) => res.send("🎲 Ludo Pro Engine LIVE"));

io.on('connection', (socket) => {

    // Quick Matchmaking
    socket.on('find_match', async (data) => {
        const { user_id, displayName, playersCount, entryFee, mode } = data;
        const queueKey = `${mode}_${playersCount}_${entryFee}`;

        try {
            const res = await axios.post(`${WP_SITE_URL}/wp-json/ludo/v1/deduct-tier`, {
                user_id: user_id, fee: entryFee
            }, { headers: { 'X-Secret': SECRET_KEY } });

            if (res.data.success) {
                socket.user_id = user_id;
                socket.displayName = displayName;
                socket.emit('points_deducted', { new_balance: res.data.new_balance });

                if (!queues[queueKey]) queues[queueKey] = [];
                queues[queueKey].push(socket);

                if (queues[queueKey].length >= playersCount) {
                    clearTimeout(queueTimers[queueKey]);
                    startMatch(queues[queueKey].splice(0, playersCount), playersCount, entryFee);
                } else {
                    if (!queueTimers[queueKey]) {
                        queueTimers[queueKey] = setTimeout(() => {
                            if (queues[queueKey] && queues[queueKey].length > 0) {
                                let realPlayers = queues[queueKey].splice(0, queues[queueKey].length);
                                let neededBots = playersCount - realPlayers.length;
                                let botPlayers = [];
                                for (let i = 0; i < neededBots; i++) {
                                    let randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
                                    botPlayers.push({
                                        id: "bot_" + Math.random().toString(36).substr(2, 9),
                                        user_id: 0,
                                        displayName: randomName,
                                        isBot: true
                                    });
                                }
                                startMatch([...realPlayers, ...botPlayers], playersCount, entryFee);
                                delete queueTimers[queueKey];
                            }
                        }, 20000);
                    }
                }
            }
        } catch (err) {
            socket.emit('error_alert', 'Points deduction failed or low balance!');
        }
    });

    // Create Private Room
    socket.on('create_private_room', async (data) => {
        const { user_id, displayName, playersCount, entryFee, roomCode } = data;
        try {
            const res = await axios.post(`${WP_SITE_URL}/wp-json/ludo/v1/deduct-tier`, {
                user_id: user_id, fee: entryFee
            }, { headers: { 'X-Secret': SECRET_KEY } });

            if (res.data.success) {
                socket.user_id = user_id;
                socket.displayName = displayName;
                socket.emit('points_deducted', { new_balance: res.data.new_balance });

                privateRooms[roomCode] = {
                    code: roomCode,
                    entryFee: entryFee,
                    playersCount: playersCount,
                    players: [socket]
                };
                socket.join("private_" + roomCode);
            }
        } catch(err) {
            socket.emit('error_alert', 'Could not deduct points for private room.');
        }
    });

    // Join Private Room
    socket.on('join_private_room', async (data) => {
        const { user_id, displayName, roomCode } = data;
        const room = privateRooms[roomCode];

        if (!room) {
            socket.emit('error_alert', 'Room code not found or expired.');
            return;
        }

        if (room.players.length >= room.playersCount) {
            socket.emit('error_alert', 'Room is already full.');
            return;
        }

        try {
            const res = await axios.post(`${WP_SITE_URL}/wp-json/ludo/v1/deduct-tier`, {
                user_id: user_id, fee: room.entryFee
            }, { headers: { 'X-Secret': SECRET_KEY } });

            if (res.data.success) {
                socket.user_id = user_id;
                socket.displayName = displayName;
                socket.emit('points_deducted', { new_balance: res.data.new_balance });

                room.players.push(socket);
                socket.join("private_" + roomCode);

                if (room.players.length === room.playersCount) {
                    delete privateRooms[roomCode];
                    startMatch(room.players, room.playersCount, room.entryFee);
                }
            }
        } catch(err) {
            socket.emit('error_alert', 'Insufficient points to join this private room.');
        }
    });

    function startMatch(playersList, count, entryFee) {
        const roomId = "room_" + Date.now();
        activeRooms[roomId] = {
            roomId: roomId,
            players: playersList.map(p => ({
                id: p.id,
                user_id: p.user_id,
                name: p.displayName,
                isBot: p.isBot || false
            })),
            turnIndex: 0,
            entryFee: entryFee,
            playersCount: count
        };

        playersList.forEach(p => {
            if (!p.isBot && p.join) p.join(roomId);
        });

        io.to(roomId).emit('match_ready', {
            roomId: roomId,
            players: activeRooms[roomId].players.map(p => p.name),
            currentTurnName: activeRooms[roomId].players[0].name,
            currentTurnId: activeRooms[roomId].players[0].user_id
        });

        if (activeRooms[roomId].players[0].isBot) {
            triggerBotTurn(roomId);
        }
    }

    socket.on('request_roll', (data) => {
        handleDiceRoll(data.roomId, socket.user_id);
    });

    function handleDiceRoll(roomId, rollerId) {
        const room = activeRooms[roomId];
        if (!room) return;

        let diceValue = Math.floor(Math.random() * 6) + 1;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.turnIndex];

        io.to(roomId).emit('dice_update', {
            value: diceValue,
            nextTurnName: nextPlayer.name,
            nextTurnId: nextPlayer.user_id
        });

        if (nextPlayer.isBot) {
            triggerBotTurn(roomId);
        }
    }

    function triggerBotTurn(roomId) {
        setTimeout(() => {
            const room = activeRooms[roomId];
            if (room && room.players[room.turnIndex].isBot) {
                handleDiceRoll(roomId, 0);
            }
        }, 1500);
    }

    socket.on('disconnect', () => {
        for (let q in queues) {
            queues[q] = queues[q].filter(s => s.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Ludo Engine with Private Rooms running on port ${PORT}`));
