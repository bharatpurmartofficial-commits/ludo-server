const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

const WP_SITE_URL = "https://bharatpurmart.com";
const SECRET_KEY = "MERA_SUPER_SECRET_KEY_12345";

// Matchmaking queues partitioned by: mode_players_fee
let queues = {};
let activeRooms = {};

io.on('connection', (socket) => {

    socket.on('find_match', async (data) => {
        const { user_id, displayName, playersCount, entryFee, mode } = data;
        const queueKey = `${mode}_${playersCount}_${entryFee}`;

        try {
            // Deduct Points
            const res = await axios.post(`${WP_SITE_URL}/wp-json/ludo/v1/deduct-tier`, {
                user_id: user_id,
                fee: entryFee
            }, { headers: { 'X-Secret': SECRET_KEY } });

            if (res.data.success) {
                socket.user_id = user_id;
                socket.displayName = displayName;
                socket.emit('points_deducted', { new_balance: res.data.new_balance });

                if (!queues[queueKey]) queues[queueKey] = [];
                queues[queueKey].push(socket);

                // Start game if required players reached
                if (queues[queueKey].length >= playersCount) {
                    const matchPlayers = queues[queueKey].splice(0, playersCount);
                    const roomId = "room_" + Date.now();

                    activeRooms[roomId] = {
                        roomId: roomId,
                        players: matchPlayers.map(p => ({ id: p.id, user_id: p.user_id, name: p.displayName })),
                        turnIndex: 0,
                        entryFee: entryFee,
                        playersCount: playersCount
                    };

                    matchPlayers.forEach(p => p.join(roomId));

                    io.to(roomId).emit('match_ready', {
                        roomId: roomId,
                        currentTurnName: matchPlayers[0].displayName,
                        currentTurnId: matchPlayers[0].user_id
                    });
                }
            }
        } catch (err) {
            socket.emit('error_alert', 'Points deduction fail ya insufficient balance!');
        }
    });

    // Authoritative Dice Roll
    socket.on('request_roll', (data) => {
        const room = activeRooms[data.roomId];
        if (!room) return;

        const diceValue = Math.floor(Math.random() * 6) + 1;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.turnIndex];

        io.to(data.roomId).emit('dice_update', {
            value: diceValue,
            nextTurnName: nextPlayer.name,
            nextTurnId: nextPlayer.user_id
        });
    });

    socket.on('disconnect', () => {
        for (let q in queues) {
            queues[q] = queues[q].filter(s => s.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Pro Ludo Engine running on port ${PORT}`));
