const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

// AAPKI WORDPRESS WEBSITE KA LINK
const WP_SITE_URL = "https://bharatpurmart.com"; // <-- Apni website ka link yahan daalein (Bina aakhri slash ke)
const SECRET_KEY = "MERA_SUPER_SECRET_KEY_12345"; // Jo WordPress Plugin me rakhi thi

let waitingPlayers = [];
let activeRooms = {};

app.get('/', (req, res) => {
    res.send("🎲 Ludo Game Server Successfully LIVE hai!");
});

io.on('connection', (socket) => {
    console.log('Player connect hua: ' + socket.id);

    socket.on('request_join', async (data) => {
        const { user_id, username } = data;

        try {
            // WordPress se points deduct karein
            const apiRes = await axios.post(`${WP_SITE_URL}/wp-json/ludo/v1/deduct`, 
                { user_id: user_id },
                { headers: { 'X-Secret': SECRET_KEY } }
            );

            if (apiRes.data.success) {
                socket.user_id = user_id;
                socket.username = username;

                waitingPlayers.push(socket);
                socket.emit('status_update', 'Points kat gaye! Dusre player ka wait kar rahe hain...');

                if (waitingPlayers.length >= 2) {
                    let p1 = waitingPlayers.shift();
                    let p2 = waitingPlayers.shift();

                    let roomId = "room_" + Date.now();
                    p1.join(roomId);
                    p2.join(roomId);

                    activeRooms[roomId] = {
                        players: [p1, p2],
                        turn: 0
                    };

                    io.to(roomId).emit('match_started', {
                        roomId: roomId,
                        players: [p1.username, p2.username],
                        currentTurn: p1.username
                    });
                }
            }
        } catch (err) {
            socket.emit('status_update', 'Balance kam hai ya connection fail!');
        }
    });

    socket.on('roll_dice', (roomId) => {
        let diceNumber = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('dice_result', {
            player: socket.username,
            number: diceNumber
        });
    });

    socket.on('disconnect', () => {
        waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
