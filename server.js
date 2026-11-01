const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const WP_SITE_URL = "https://bharatpurmart.com";
const SECRET_KEY = "MERA_SUPER_SECRET_KEY_Param#108Martgame@live";

const BOT_NAMES = [
    "Rahul_Sharma", "Pooja_99", "Vikram_RJ", "Amit_Verma", 
    "Neha_Patel", "Deepak_Kumar", "Suresh_Meena", "Anjali_Singh",
    "Rajendra", "Deepali", "jaat_boy", "amar_pratap",
    "Manish_Yadav", "Kavita_Rathore", "Sachin_Gupta", "Ritu_Choudhary"
];

const COLORS = ['red', 'green', 'yellow', 'blue'];
const SAFE_STAR_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

let queues = {};
let queueTimers = {};
let activeRooms = {};
let privateRooms = {};

app.get('/', (req, res) => res.send("🎲 Ludo King Engine LIVE"));

io.on('connection', (socket) => {

    // 1. Quick Matchmaking
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
                        }, 20000); // 20s Bot Timer
                    }
                }
            }
        } catch (err) {
            socket.emit('error_alert', 'Points deduction failed or low balance!');
        }
    });

    // 2. Create Private Room
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

    // 3. Join Private Room
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

    // Match Start Helper (Pawns & Colors Initialization)
    function startMatch(playersList, count, entryFee) {
        const roomId = "room_" + Date.now();

        // 4 Players ki 4-4 Gotiyan Initialize karein
        const roomPawns = {
            red:    [{ pos: -1 }, { pos: -1 }, { pos: -1 }, { pos: -1 }],
            green:  [{ pos: -1 }, { pos: -1 }, { pos: -1 }, { pos: -1 }],
            yellow: [{ pos: -1 }, { pos: -1 }, { pos: -1 }, { pos: -1 }],
            blue:   [{ pos: -1 }, { pos: -1 }, { pos: -1 }, { pos: -1 }]
        };

        activeRooms[roomId] = {
            roomId: roomId,
            players: playersList.map((p, idx) => ({
                id: p.id,
                user_id: p.user_id,
                name: p.displayName,
                color: COLORS[idx],
                isBot: p.isBot || false
            })),
            pawns: roomPawns,
            turnIndex: 0,
            lastDice: 0,
            entryFee: entryFee,
            playersCount: count
        };

        // Har player ko uska specific color aur match details bhejo
        playersList.forEach((p, idx) => {
            const assignedColor = COLORS[idx];
            if (!p.isBot && p.join) {
                p.join(roomId);
                p.emit('match_ready', {
                    roomId: roomId,
                    assignedColor: assignedColor,
                    currentTurnColor: COLORS[0],
                    currentTurnName: activeRooms[roomId].players[0].name,
                    players: activeRooms[roomId].players.map(pl => pl.name)
                });
            }
        });

        // Agar pehla player bot hai to dice roll karo
        if (activeRooms[roomId].players[0].isBot) {
            triggerBotTurn(roomId);
        }
    }

    // 4. Dice Roll Handler
    socket.on('request_roll', (data) => {
        handleDiceRoll(data.roomId, socket.user_id);
    });

    function handleDiceRoll(roomId, rollerId) {
        const room = activeRooms[roomId];
        if (!room) return;

        let diceValue = Math.floor(Math.random() * 6) + 1;
        room.lastDice = diceValue;
        const currentTurnPlayer = room.players[room.turnIndex];

        io.to(roomId).emit('dice_update', {
            value: diceValue,
            currentTurnColor: currentTurnPlayer.color,
            nextTurnName: currentTurnPlayer.name,
            nextTurnId: currentTurnPlayer.user_id
        });

        // Agar player Bot hai to auto move karega
        if (currentTurnPlayer.isBot) {
            setTimeout(() => {
                handleBotMove(roomId, currentTurnPlayer.color, diceValue);
            }, 1200);
        }
    }

    // 5. Pawn Movement Handler (Inside Connection Scope)
    socket.on('move_pawn', (data) => {
        const { roomId, color, pawnIndex, diceValue } = data;
        const room = activeRooms[roomId];
        if (!room) return;

        let pawn = room.pawns[color][pawnIndex];
        if (pawn.pos === -1) {
            pawn.pos = 0; // Base se bahar nikli
        } else {
            pawn.pos += diceValue;
        }

        // Kill Detection (Agar safe star par na ho)
        let killed = false;
        let killedColor = null;
        let killedIndex = null;

        if (pawn.pos < 51) {
            let globalCell = (START_INDEX[color] + pawn.pos) % 52;
            if (!SAFE_STAR_INDICES.includes(globalCell)) {
                // Check if any opponent pawn is here
                for (let oppColor of COLORS) {
                    if (oppColor !== color) {
                        room.pawns[oppColor].forEach((oppPawn, oIdx) => {
                            if (oppPawn.pos >= 0 && oppPawn.pos < 51) {
                                let oppGlobalCell = (START_INDEX[oppColor] + oppPawn.pos) % 52;
                                if (oppGlobalCell === globalCell) {
                                    // Kill Opponent!
                                    oppPawn.pos = -1;
                                    killed = true;
                                    killedColor = oppColor;
                                    killedIndex = oIdx;
                                }
                            }
                        });
                    }
                }
            }
        }

        // 6 aane par ya goti kaatne par extra turn
        let getsExtraTurn = (diceValue === 6 || killed);
        if (!getsExtraTurn) {
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
        }

        const nextPlayer = room.players[room.turnIndex];

        io.to(roomId).emit('pawn_moved', {
            color: color,
            pawnIndex: pawnIndex,
            newPos: pawn.pos,
            killedOpponent: killed,
            killedColor: killedColor,
            killedIndex: killedIndex,
            nextTurnColor: nextPlayer.color,
            nextTurnName: nextPlayer.name
        });

        if (nextPlayer.isBot) {
            triggerBotTurn(roomId);
        }
    });

    // 6. Skip Turn (Jab koi goti move na ho sake)
    socket.on('skip_turn', (data) => {
        const room = activeRooms[data.roomId];
        if (!room) return;

        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.turnIndex];

        io.to(data.roomId).emit('pawn_moved', {
            color: 'none',
            nextTurnColor: nextPlayer.color,
            nextTurnName: nextPlayer.name
        });

        if (nextPlayer.isBot) {
            triggerBotTurn(roomId);
        }
    });

    function triggerBotTurn(roomId) {
        setTimeout(() => {
            const room = activeRooms[roomId];
            if (room && room.players[room.turnIndex].isBot) {
                handleDiceRoll(roomId, 0);
            }
        }, 1500);
    }

    function handleBotMove(roomId, botColor, dice) {
        const room = activeRooms[roomId];
        if (!room) return;

        // Bot selects first valid pawn
        let moveIndex = -1;
        room.pawns[botColor].forEach((p, idx) => {
            if (moveIndex !== -1) return;
            if (p.pos === -1 && dice === 6) moveIndex = idx;
            else if (p.pos >= 0 && (p.pos + dice) <= 56) moveIndex = idx;
        });

        if (moveIndex !== -1) {
            // Trigger move
            io.to(roomId).emit('pawn_moved', {
                color: botColor,
                pawnIndex: moveIndex,
                newPos: (room.pawns[botColor][moveIndex].pos === -1) ? 0 : room.pawns[botColor][moveIndex].pos + dice,
                nextTurnColor: (dice === 6) ? botColor : getNextColor(room),
                nextTurnName: room.players[room.turnIndex].name
            });
        } else {
            // Skip
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            const nextP = room.players[room.turnIndex];
            io.to(roomId).emit('pawn_moved', {
                color: 'none',
                nextTurnColor: nextP.color,
                nextTurnName: nextP.name
            });
            if (nextP.isBot) triggerBotTurn(roomId);
        }
    }

    function getNextColor(room) {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        return room.players[room.turnIndex].color;
    }

    socket.on('disconnect', () => {
        for (let q in queues) {
            queues[q] = queues[q].filter(s => s.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Ludo Engine running on port ${PORT}`));
