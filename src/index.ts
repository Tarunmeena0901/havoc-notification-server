import { WebSocket, WebSocketServer } from "ws";
import { addUser, findPlayerById } from "./sql/sql_function";

const wss = new WebSocketServer({ port: 8080 });

const players: string[] = [];

const connectedUsers: {
    [key: string]: {
        ws: WebSocket,
        userName: string
    }
} = {};

wss.on('connection', function connection(userSocket) {
    userSocket.on('error', console.error);

    const id = randomId();
    userSocket.on('message', function message(data: string) {
        const parsedData = JSON.parse(data);
        connectedUsers[id] = {
            ws: userSocket,
            userName: ''
        };

        if (parsedData.type == "SUBSCRIBE") {
            let duplicateUserNameExist = false
            players.forEach((existingUsername) => {
                if (parsedData.userName == existingUsername) {
                    userSocket.send("you are already subscribed")
                    duplicateUserNameExist = true;
                }
            })
            if (!duplicateUserNameExist) {
                players.push(parsedData.userName);
                connectedUsers[id].userName = parsedData.userName;
                const player_data = {
                    id, 
                    username:parsedData.userName
                }
                addUser(player_data);
                broadcast(`${parsedData.userName} is now online`, parsedData.userName);
            }
        }

        if (parsedData.type == "MESSAGE") {
            const to = parsedData.to;
            const from = parsedData.from;
            const message = parsedData.message;
            let userOnline = false;
            Object.keys(connectedUsers).forEach((id) => {
                const { ws, userName } = connectedUsers[id];
                if (userName == to) {
                    userOnline = true;
                    ws.send(JSON.stringify({
                        from: from,
                        messageNotification: `${from} sent you a message`,
                        message: message
                    }));
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
        const playerName = connectedUsers[id].userName;
        delete connectedUsers[id];
        broadcast(`${playerName} is now offline`, playerName );
    })
})

function randomId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function broadcast(message: string, broadcaster: string) {
    Object.values(connectedUsers).forEach(({ ws, userName }) => {
        if (ws.readyState == WebSocket.OPEN && userName != broadcaster) {
            ws.send(message);
        }
    });
}