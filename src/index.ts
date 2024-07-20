import { WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

const players: string[] = [];

const connectedUsers: {
    [key: string]: {
        ws: WebSocket,
        userName: string,
        userAddress: string
    }
} = {} ;

wss.on('connection', function connection(userSocket) {
    userSocket.on('error', console.error);

    userSocket.on('message', function message(data: string) {
        const parsedData = JSON.parse(data);
        const id = randomId();
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
                userSocket.send(`${parsedData.userName} joined`);
            }
        }

        if (parsedData.type == "CONNECTION_REQUEST") {
            const to = parsedData.to;
            const from = parsedData.from;
            let userFound = false;
            Object.keys(connectedUsers).forEach((id) => {
                const { ws, userName, userAddress } = connectedUsers[id];
                if (userName == to) {
                    userFound = true;
                    ws.send(JSON.stringify({
                        from: from,
                        message: `${from} sent you a connection request, connection Id: ${userAddress}`,
                        senderAddress: userAddress
                    }));
                    userSocket.send(`connection request sent to ${to}`)
                }
            })
            if (!userFound) {
                userSocket.send(`No user with username ${to} exist`);
            }
        }
    })

    userSocket.send("you are connected to notification server please subscribe");
})

function randomId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}