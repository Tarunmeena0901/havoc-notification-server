import { WebSocket, WebSocketServer } from "ws";
import { addLobby, addPlayerToLobby, addUser, changeLobbyLeader, deleteLobby, findPlayerById, rebuildLobbies, removePlayerFromDatabaseLobby } from "./sql/sql_function";
import { setConfirmTags, twoWayAddFriend } from "./play-fab/playfab_function";

const wss = new WebSocketServer({ port: 8080 });

const players: string[] = [];

const connectedUsers: {
    [key: string]: {
        ws: WebSocket,
        username: string,
        lobby?: string
    }
} = {};

const lobbies: {
    [key: string]: {
        leader: string,
        players: Set<string>
    }
} = {};

const serializedLobbies: {
    [key: string]: {
        leader: string,
        players: string[]
    }
} = {};

//incase the server crash this fill bring all the lobbies and back
//rebuildLobbies(lobbies);

wss.on('connection', function connection(userSocket) {
    userSocket.on('error', console.error);

    const id = randomId();
    let lobbyId = randomId();

    connectedUsers[id] = {
        ws: userSocket,
        username: '',
        lobby: lobbyId
    };
    lobbies[lobbyId] = {
        leader: "",
        players: new Set<string>()
    }
    //addLobby(lobbyId,"", new Set<string>());

    userSocket.on('message', async function message(data: string) {
        const parsedData = JSON.parse(data);

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

                lobbies[lobbyId].leader = parsedData.username;
                //changeLobbyLeader(lobbyId, parsedData.username)
                lobbies[lobbyId].players.add(parsedData.username);
                //addPlayerToLobby(lobbyId, parsedData.username );

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
                    }, null, 2));
                    userSocket.send(`message sent to ${to}`);
                }
            })

            if (!userOnline) {
                userSocket.send(`player ${to} is offline`);
            }
        }

        if (parsedData.type == "LOBBY_INVITE_REQUEST") {
            const from = parsedData.from;
            const to = parsedData.to;
            let senderLobbyId = '';
            let userOnline = false;
            Object.keys(lobbies).forEach((lobbyId) => {
                const { leader } = lobbies[lobbyId];
                if (leader === from) {
                    senderLobbyId = lobbyId;
                }
            })
            Object.keys(connectedUsers).forEach((id) => {
                const { ws, username } = connectedUsers[id];
                if (username == to) {
                    userOnline = true;
                    ws.send(JSON.stringify({
                        type: "LOBBY_INVITE_REQUEST",
                        from: from,
                        to: to,
                        message: `${from} sent a join request`,
                        lobbyId: senderLobbyId
                    }, null, 2));
                    userSocket.send(`invite sent to ${to}`);
                }
            })

            if (!userOnline) {
                userSocket.send(`player ${to} is offline`);
            }
        }

        if (parsedData.type == "LOBBY_REQUEST_RESPONSE") {
            const accepter = parsedData.from;
            const initialSender = parsedData.to;
            const joiningLobbyId = parsedData.lobbyId;
            const response = parsedData.response;
            let userOnline = false;

            Object.keys(connectedUsers).forEach((id) => {
                const { ws, username } = connectedUsers[id];
                if (username == accepter) {
                    if (response === "ACCEPT") {
                        const accepterCurrentLobbyId = connectedUsers[id].lobby || "";
                        lobbies[accepterCurrentLobbyId].leader == accepter ? removePlayerFromLobby(accepter, accepterCurrentLobbyId, joiningLobbyId) : removePlayerFromLobby(accepter, accepterCurrentLobbyId);
                        connectedUsers[id].lobby = joiningLobbyId;
                        lobbies[joiningLobbyId].players.add(accepter);
                        //addPlayerToLobby(joiningLobbyId, accepter);
                        broadcastInLobby(JSON.stringify({
                            currentLobbyStatus: { leader: lobbies[joiningLobbyId].leader, players: Array.from(lobbies[joiningLobbyId].players) },
                            message: `${accepter} joined the lobby`
                        }, null, 2), joiningLobbyId, accepter);
                        userSocket.send(`u have joined ${initialSender}'s lobby, ${initialSender} is the leader`);
                    }
                }
                if (username == initialSender) {
                    userOnline = true;
                    ws.send(JSON.stringify({
                        type: "LOBBY_REQUEST_RESPONSE",
                        from: accepter,
                        response: response,
                        message: `${accepter} ${response}  your lobby invite`
                    }, null, 2));
                }
            })

            if (!userOnline) {
                userSocket.send(`player ${initialSender} is no more online`);
            }
        }

        if (parsedData.type == "EXIT_LOBBY") {
            const deserter = parsedData.from;
            Object.keys(connectedUsers).forEach((id) => {
                const { username, ws } = connectedUsers[id];
                if (username === deserter) {
                    const currentLobbyId = connectedUsers[id].lobby || "";
                    const lobbyLeader = lobbies[currentLobbyId].leader;
                    removePlayerFromLobby(deserter, currentLobbyId);
                    //removePlayerFromDatabaseLobby(currentLobbyId, deserter);
                    if (deserter != lobbyLeader) {
                        connectedUsers[id].lobby = lobbyId;
                        lobbies[lobbyId] = {
                            leader: deserter,
                            players: new Set<string>([deserter])
                        }
                        //changeLobbyLeader(lobbyId,deserter);
                        //addPlayerToLobby(lobbyId, deserter);
                    }
                    broadcastInLobby(JSON.stringify({
                        currentLobbyStatus: { leader: lobbies[currentLobbyId].leader, players: Array.from(lobbies[currentLobbyId].players) },
                        message: `${deserter} left the lobby`
                    }, null, 2), currentLobbyId, deserter);
                    ws.send(`You left ${lobbyLeader}'s lobby`);
                }
            })
        }

        if (parsedData.type == "SEND_FRIEND_REQUEST") {
            const from = parsedData.playFabId;
            const to = parsedData.friendPlayFabId;
            const result = await twoWayAddFriend(from, to);
            userSocket.send(JSON.stringify({
                type: 'FRIEND_REQUEST_PROCESSED',
                success: result.success,
                error: result.error || null
            }, null, 2))
        }

        if (parsedData.type == "CONFIRM_FRIEND_REQUEST") {
            const from = parsedData.playFabId;
            const to = parsedData.friendPlayFabId;
            const result = await setConfirmTags(from, to);
            userSocket.send(JSON.stringify({
                type: 'CONFIRM_REQUEST_PROCESSED',
                success: result.success,
                error: result.error || null
            }, null, 2))
        }

        if (parsedData.type == "RETRIEVE_LOBBY") {
            const all = parsedData.all || false;
            const one = parsedData.one || false;
            const lobbyId = parsedData.lobbyId;
            if (all) {
                userSocket.send(JSON.stringify(serializeLobbies(lobbies), null, 2));
            } else if (lobbyId && one) {
                const lobby = lobbies[lobbyId];
                if (lobby) {
                    const serializedLobby = {
                        leader: lobby.leader,
                        players: Array.from(lobby.players)
                    };
                    userSocket.send(JSON.stringify(serializedLobby, null, 2));
                } else {
                    userSocket.send(JSON.stringify({ error: "Lobby not found" }));
                }
            }
        }
        console.log(lobbies);
        console.log(connectedUsers);
    })
    userSocket.send("you are connected to notification server please subscribe");

    userSocket.on('close', () => {
        try {
            if (Object.keys(connectedUsers).length > 0) {
                if (connectedUsers[id] && connectedUsers[id].username) {
                    const playerName = connectedUsers[id].username;
                    const userLobby = connectedUsers[id].lobby || "";
                    removePlayerFromLobby(playerName, userLobby);
                    //removePlayerFromDatabaseLobby(userLobby, playerName);
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

function broadcastInLobby(message: string, lobbyId: string, broadcaster: string) {
    Object.values(connectedUsers).forEach(({ ws, username }) => {
        if (lobbies[lobbyId].players.has(username) && ws.readyState == WebSocket.OPEN && username != broadcaster) {
            ws.send(message);
        }
    })
}

function removePlayerOnDisconnect(username: string) {
    const index = players.indexOf(username);
    if (index != -1) {
        players.splice(index, 1);
    }
}

function serializeLobbies(lobbies: any) {
    for (const lobbyId in lobbies) {
        serializedLobbies[lobbyId] = {
            leader: lobbies[lobbyId].leader,
            players: Array.from(lobbies[lobbyId].players)
        };
    }
    return serializedLobbies;
}


// if leader leaves this function reassign every other lobby member a new lobby 
async function removePlayerFromLobby(username: string, lobbyId: string, leaderNewLobby?: string) {
    if (lobbies[lobbyId].leader === username) {
        lobbies[lobbyId].players.forEach(async (playerUsername) => {
            if (playerUsername != lobbies[lobbyId].leader) {
                const newLobbyId = randomId();
                lobbies[newLobbyId] = {
                    leader: playerUsername,
                    players: new Set<string>().add(playerUsername),
                };
                lobbies[lobbyId].players.delete(playerUsername);
                Object.keys(connectedUsers).forEach((id) => {
                    const { username } = connectedUsers[id];
                    if (playerUsername == username) {
                        connectedUsers[id].lobby = newLobbyId;
                    }
                })
                //await addLobby(newLobbyId, playerUsername, new Set<string>([playerUsername]))
                //await removePlayerFromDatabaseLobby(lobbyId,playerUsername);
            }
        })
        if (leaderNewLobby) {
            delete lobbies[lobbyId];
            //await deleteLobby(lobbyId);
        }
    }
    else {
        lobbies[lobbyId].players.delete(username);
        //await removePlayerFromDatabaseLobby(lobbyId, username);
    }
}

