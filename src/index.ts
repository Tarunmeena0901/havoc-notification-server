import { WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

const players: string[] = [];

const connectedUsers: {
    [key: string]: {
        ws: WebSocket,
        userName: string,
        userAddress: string
    }
} = {};

wss.on('connection', function connection(userSocket) {
    userSocket.on('error', console.error);

    const id = randomId();
    userSocket.on('message', function message(data: string) {
        const parsedData = JSON.parse(data);
        connectedUsers[id] = {
            ws: userSocket,
            userName: '',
            userAddress: ''
        };

        if (parsedData.type == "SUBSCRIBE") {
            let duplicateUserNameExist = false
            players.forEach((existingUsername) => {
                if (parsedData.userName == existingUsername) {
                    userSocket.send("Username already exist please choose a different username")
                    duplicateUserNameExist = true;
                }
            })
            if (!duplicateUserNameExist) {
                players.push(parsedData.userName);
                connectedUsers[id].userName = parsedData.userName;
                connectedUsers[id].userAddress = parsedData.IpAddress;
                broadcast(`${parsedData.userName} is now online`, parsedData.userName);
            }
        }

        if (parsedData.type == "CONNECTION_REQUEST") {
            const to = parsedData.to;
            const from = parsedData.from;
            let userOnline = false;
            Object.keys(connectedUsers).forEach((id) => {
                const { ws, userName, userAddress } = connectedUsers[id];
                if (userName == to) {
                    userOnline = true;
                    ws.send(JSON.stringify({
                        from: from,
                        message: `${from} sent you a connection request, connection Id: ${userAddress}`,
                        senderAddress: userAddress
                    }));
                    userSocket.send(`connection request sent to ${to}`);
                }
            })

            if (!userOnline) {
                userSocket.send(`player ${to} is offline`);
            }
        }
    })

    userSocket.send("you are connected to notification server please subscribe");

    userSocket.on('close', () => {
        delete connectedUsers[id];
        userSocket.send("notification service is disconnected");
    })
})

function randomId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function broadcast(message: string, broadcaster: string) {
    Object.values(connectedUsers).forEach(({ ws, userName }) => {
        if (ws.readyState == WebSocket.OPEN && userName == broadcaster) {
            ws.send(message);
        }
    });
}