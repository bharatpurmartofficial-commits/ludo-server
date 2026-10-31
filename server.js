const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const WP_SITE_URL = "https://bharatpurmart.com";
const SECRET_KEY = "MERA_SUPER_SECRET_KEY_12345";

// Indian Bot Names Pool
const BOT_NAMES = [
    "Rahul_Sharma", "Pooja_99", "Vikram_RJ", "Amit_Verma", 
    "Neha_Patel", "Deepak_Kumar", "Suresh_Meena", "Anjali_Singh",
    "Manish_Yadav", "Kavita_Rathore", "Sachin_Gupta", "Ritu_Choudhary"
];

let queues = {};
let queueTimers = {};
let activeRooms = {};

app.get('/', (req, res) => res.send("🎲 Ludo Pro Engine LIVE"));

io.on('connection', (socket) => {

    socket.on('find_match', async (data) => {
        const { user_id, displayName, playersCount, entryFee, mode } = data;
        const queueKey = `${mode}_${playersCount}_${entryFee}`;

        try {
            // WordPress se point kaato
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

                // Check if Real Players are enough
                if (queues[queueKey].length >= playersCount) {
                    clearTimeout(queueTimers[queueKey]);
                    startMatch(queues[queueKey].splice(0, playersCount), playersCount, entryFee);
                } else {
                    // Agar 20 second tak wait kare aur koi na aaye -> Bot inject karo
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
                        }, 20000); // 20 Seconds Wait
                    }
                }
            }
        } catch (err) {
            socket.emit('error_alert', 'Points deduction fail!');
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

        // Agar pehli turn bot ki ho to roll karwao
        if (activeRooms[roomId].players[0].isBot) {
            triggerBotTurn(roomId);
        }
    }

    // Dice Roll
    socket.on('request_roll', (data) => {
        handleDiceRoll(data.roomId, socket.user_id);
    });

    function handleDiceRoll(roomId, rollerId) {
        const room = activeRooms[roomId];
        if (!room) return;

        // Difficulty based on entry fee
        let diceValue = Math.floor(Math.random() * 6) + 1;

        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.turnIndex];

        io.to(roomId).emit('dice_update', {
            value: diceValue,
            nextTurnName: nextPlayer.name,
            nextTurnId: nextPlayer.user_id
        });

        // Agar agla player Bot hai to auto-roll karega (1.5 sec delay)
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
        }, 1500); // Natural 1.5s thinking time
    }

    socket.on('disconnect', () => {
        for (let q in queues) {
            queues[q] = queues[q].filter(s => s.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Ludo Engine with Smart Bots running on ${PORT}`));
