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

// 8 Universal Safe Stars
const SAFE_STAR_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

let queues = {};
let queueTimers = {};
let activeRooms = {};
let privateRooms = {};

app.get('/', (req, res) => res.send("🎲 Ludo King Engine LIVE"));

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

    // Private Rooms
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

    // Start Match: Player is ALWAYS at Bottom (Blue), Opponents at Top
    function startMatch(playersList, count, entryFee) {
        const roomId = "room_" + Date.now();

        // PERSPECTIVE RULES:
        // Blue = Bottom-Left (User)
        // Green = Top-Right (Opponent)
        // Red = Top-Left (Opponent)
        // Yellow = Bottom-Right
        let activeColors = [];
        if (count == 2) {
            activeColors = ['blue', 'green']; // User Bottom-Left (Blue), Opponent Top-Right (Green)
        } else if (count == 3) {
            activeColors = ['blue', 'green', 'red']; // User at Bottom, both opponents at Top
        } else {
            activeColors = ['blue', 'green', 'red', 'yellow'];
        }

        const roomPawns = {};
        activeColors.forEach(c => {
            roomPawns[c] = [{ pos: -1 }, { pos: -1 }, { pos: -1 }, { pos: -1 }];
        });

        activeRooms[roomId] = {
            roomId: roomId,
            players: playersList.map((p, idx) => ({
                id: p.id,
                user_id: p.user_id,
                name: p.displayName,
                color: activeColors[idx],
                isBot: p.isBot || false
            })),
            pawns: roomPawns,
            activeColors: activeColors,
            turnIndex: 0,
            hasRolled: false, // Strict Dice Lock per turn
            consecutiveSixes: 0,
            lastDice: 0,
            entryFee: entryFee,
            playersCount: count
        };

        playersList.forEach((p, idx) => {
            const assignedColor = activeColors[idx];
            if (!p.isBot && p.join) {
                p.join(roomId);
                p.emit('match_ready', {
                    roomId: roomId,
                    assignedColor: assignedColor,
                    activeColors: activeColors,
                    currentTurnColor: activeColors[0],
                    currentTurnName: activeRooms[roomId].players[0].name,
                    players: activeRooms[roomId].players.map(pl => pl.name)
                });
            }
        });

        if (activeRooms[roomId].players[0].isBot) {
            triggerBotTurn(roomId);
        }
    }

    // Strict Anti-Cheat Dice Roll Handler
    socket.on('request_roll', (data) => {
        const room = activeRooms[data.roomId];
        if (!room) return;

        const currentTurnPlayer = room.players[room.turnIndex];

        // Security check: Only current turn player can roll & ONLY ONCE per turn
        if (currentTurnPlayer.user_id !== socket.user_id) return;
        if (room.hasRolled) return; // REJECT MULTIPLE ROLLS!

        room.hasRolled = true; // Lock dice immediately
        handleDiceRoll(data.roomId, socket.user_id);
    });

    function handleDiceRoll(roomId, rollerId) {
        const room = activeRooms[roomId];
        if (!room) return;

        let diceValue = Math.floor(Math.random() * 6) + 1;
        room.lastDice = diceValue;
        const currentTurnPlayer = room.players[room.turnIndex];

        // 3 Consecutive Sixes Rule
        if (diceValue === 6) {
            room.consecutiveSixes++;
            if (room.consecutiveSixes >= 3) {
                // Forfeit turn on 3 sixes
                room.consecutiveSixes = 0;
                room.hasRolled = false;
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                const nextPlayer = room.players[room.turnIndex];
                io.to(roomId).emit('pawn_moved', {
                    color: 'none',
                    notice: '3 Sixes in a row! Turn forfeited.',
                    nextTurnColor: nextPlayer.color,
                    nextTurnName: nextPlayer.name
                });
                if (nextPlayer.isBot) triggerBotTurn(roomId);
                return;
            }
        } else {
            room.consecutiveSixes = 0;
        }

        io.to(roomId).emit('dice_update', {
            value: diceValue,
            currentTurnColor: currentTurnPlayer.color,
            nextTurnName: currentTurnPlayer.name,
            nextTurnId: currentTurnPlayer.user_id
        });

        if (currentTurnPlayer.isBot) {
            setTimeout(() => {
                handleBotMove(roomId, currentTurnPlayer.color, diceValue);
            }, 1400);
        }
    }

    // Pawn Movement Handler
    socket.on('move_pawn', (data) => {
        const { roomId, color, pawnIndex, diceValue } = data;
        const room = activeRooms[roomId];
        if (!room) return;

        // Unlock dice lock for next roll/turn
        room.hasRolled = false;

        let pawn = room.pawns[color][pawnIndex];
        if (pawn.pos === -1) {
            pawn.pos = 0;
        } else {
            pawn.pos += diceValue;
        }

        // Star Safe Check & Kill Detection
        let killed = false;
        let killedColor = null;
        let killedIndex = null;

        if (pawn.pos < 51) {
            let globalCell = (START_INDEX[color] + pawn.pos) % 52;
            // Agar cell Safe Star me nahi hai, tabhi kill hoga
            if (!SAFE_STAR_INDICES.includes(globalCell)) {
                room.activeColors.forEach(oppColor => {
                    if (oppColor !== color) {
                        room.pawns[oppColor].forEach((oppPawn, oIdx) => {
                            if (oppPawn.pos >= 0 && oppPawn.pos < 51) {
                                let oppGlobalCell = (START_INDEX[oppColor] + oppPawn.pos) % 52;
                                if (oppGlobalCell === globalCell) {
                                    oppPawn.pos = -1; // Send to base
                                    killed = true;
                                    killedColor = oppColor;
                                    killedIndex = oIdx;
                                }
                            }
                        });
                    }
                });
            }
        }

        // Extra Turn on 6 or Kill
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

    // Skip Turn
    socket.on('skip_turn', (data) => {
        const roomId = data.roomId;
        const room = activeRooms[roomId];
        if (!room) return;

        room.hasRolled = false; // Reset lock
        room.consecutiveSixes = 0;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.turnIndex];

        io.to(roomId).emit('pawn_moved', {
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
                room.hasRolled = true;
                handleDiceRoll(roomId, 0);
            }
        }, 1200);
    }

    function handleBotMove(roomId, botColor, dice) {
        const room = activeRooms[roomId];
        if (!room) return;

        room.hasRolled = false;

        let moveIndex = -1;
        room.pawns[botColor].forEach((p, idx) => {
            if (moveIndex !== -1) return;
            if (p.pos === -1 && dice === 6) moveIndex = idx;
            else if (p.pos >= 0 && (p.pos + dice) <= 56) moveIndex = idx;
        });

        if (moveIndex !== -1) {
            let pawn = room.pawns[botColor][moveIndex];
            pawn.pos = (pawn.pos === -1) ? 0 : pawn.pos + dice;

            // Kill detection for bot
            let killed = false;
            let killedColor = null;
            let killedIndex = null;
            if (pawn.pos < 51) {
                let globalCell = (START_INDEX[botColor] + pawn.pos) % 52;
                if (!SAFE_STAR_INDICES.includes(globalCell)) {
                    room.activeColors.forEach(oppColor => {
                        if (oppColor !== botColor) {
                            room.pawns[oppColor].forEach((oppPawn, oIdx) => {
                                if (oppPawn.pos >= 0 && oppPawn.pos < 51) {
                                    let oppGlobalCell = (START_INDEX[oppColor] + oppPawn.pos) % 52;
                                    if (oppGlobalCell === globalCell) {
                                        oppPawn.pos = -1;
                                        killed = true;
                                        killedColor = oppColor;
                                        killedIndex = oIdx;
                                    }
                                }
                            });
                        }
                    });
                }
            }

            let getsExtra = (dice === 6 || killed);
            if (!getsExtra) {
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
            }
            const nextP = room.players[room.turnIndex];

            io.to(roomId).emit('pawn_moved', {
                color: botColor,
                pawnIndex: moveIndex,
                newPos: pawn.pos,
                killedOpponent: killed,
                killedColor: killedColor,
                killedIndex: killedIndex,
                nextTurnColor: nextP.color,
                nextTurnName: nextP.name
            });

            if (nextP.isBot) triggerBotTurn(roomId);
        } else {
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

    socket.on('disconnect', () => {
        for (let q in queues) {
            queues[q] = queues[q].filter(s => s.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Ludo Engine running on port ${PORT}`));
