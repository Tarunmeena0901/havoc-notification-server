import { WebSocket, WebSocketServer } from "ws";
import { addUser, findPlayerById } from "./sql/sql_function";

const wss = new WebSocketServer({ port: 8080 });

const players: string[] = [];

const connectedUsers: {
    [key: string]: {
        ws: WebSocket,
        username: string
    }
} = {};

wss.on('connection', function connection(userSocket) {
    userSocket.on('error', console.error);

    const id = randomId();
    userSocket.on('message', async function message(data: string) {
        const parsedData = JSON.parse(data);
        connectedUsers[id] = {
            ws: userSocket,
            username: ''
        };

        if (parsedData.type == "SUBSCRIBE") {
            let duplicateUserNameExist = false
            players.forEach((existingUsername) => {
                if (parsedData.username == existingUsername) {
                    userSocket.send("you are already subscribed")
                    duplicateUserNameExist = true;
                }
            })
            if (!duplicateUserNameExist) {
                players.push(parsedData.username);
                connectedUsers[id].username = parsedData.username;
                const player_data = {
                    id,
                    username: parsedData.username
                }
                const isStoredInDatabase = await findPlayerById(parsedData.username);
                if (!isStoredInDatabase) {
                    await addUser(player_data);
                }
                broadcast(`${parsedData.username} is now online`, parsedData.username);
            }
        }

        if (parsedData.type == "MESSAGE") {
            const to = parsedData.to;
            const from = parsedData.from;
            const message = parsedData.message;
            let userOnline = false;
            Object.keys(connectedUsers).forEach((id) => {
                const { ws, username } = connectedUsers[id];
                if (username == to) {
                    userOnline = true;
                    ws.send(JSON.stringify({
                        type: "MESSAGE",
                        from: from,
                        messageNotification: `${from} sent you a message`,
                        message: message
                    },null,2));
                    userSocket.send(`message sent to ${to}`);
                }
            })

            if (!userOnline) {
                userSocket.send(`player ${to} is offline`);
            }
        }
    })
    userSocket.send("you are connected to notification server please subscribe");

    userSocket.on('close', () => {
        try {
            if (Object.keys(connectedUsers).length > 0) {
                if (connectedUsers[id] && connectedUsers[id].username) {
                    const playerName = connectedUsers[id].username;
                    delete connectedUsers[id];
                    removePlayerOnDisconnect(playerName);
                    broadcast(`${playerName} is now offline`, playerName);
                }
            }
        } catch (error) {
            console.log(error);
        }
    })
})

function randomId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function broadcast(message: string, broadcaster: string) {
    Object.values(connectedUsers).forEach(({ ws, username }) => {
        if (ws.readyState == WebSocket.OPEN && username != broadcaster) {
            ws.send(message);
        }
    });
}

function removePlayerOnDisconnect(username: string) {
    const index = players.indexOf(username);
    if (index != -1) {
        players.splice(index, 1);
    }
}