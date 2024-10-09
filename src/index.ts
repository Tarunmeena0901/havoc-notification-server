import { WebSocket, WebSocketServer } from "ws";
import { addUser, findPlayerById } from "./sql/sql_function";
import { removeFriend, setConfirmTags, twoWayAddFriend } from "./play-fab/playfab_function";

type LobbyMembers = { [key: string]: string }

type PlayerInLobby = {
    username: string,
    spot: number,
    ping?: number,
    ready: boolean
}

type UpdateLobbyData = {
    newSpot?: number,
    ready?: boolean,
    newMatchType?: string,
    newMapId?: string,
    ping?: number
}

const MAX_COUNT = 99999;
const MAX_LOBBY_SPOT = 9;

const wss = new WebSocketServer({ port: 8080 });

const players: string[] = [];

const connectedUsers: {
    [key: string]: {
        ws: WebSocket,
        username: string,
        lobby: string
    }
} = {};

const lobbies: {
    [key: string]: {
        matchType: string,
        mapId: string,
        leader: string,
        players: Map<string, PlayerInLobby>,
        filledSpots: Set<number>
    }
} = {};

const serializedLobbies: {
    [key: string]: {
        leader: string,
        players: PlayerInLobby[]
    }
} = {};

//incase the server crash this fill bring all the lobbies and back
//rebuildLobbies(lobbies);

wss.on('connection', function connection(userSocket) {
    userSocket.on('error', console.error);

    const id = randomId();
    let lobbyId = randomId();

    userSocket.on('message', async (data: string) => {
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

                connectedUsers[id] = {
                    ws: userSocket,
                    username: parsedData.username,
                    lobby: lobbyId
                };

                const initPlayerInLobby: PlayerInLobby = {
                    username: parsedData.username,
                    ready: false,
                    spot: 1,
                    ping: MAX_COUNT
                }
                lobbies[lobbyId] = {
                    leader: parsedData.username,
                    mapId: "map_1",
                    matchType: "unranked",
                    players: new Map<string, PlayerInLobby>([[parsedData.username, initPlayerInLobby]]),
                    filledSpots: new Set<number>([1])
                }
                //addLobby(lobbyId,"", new Set<string>());
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

                        let firstAvailableSpot = null;

                        for (let i = 1; i <= MAX_LOBBY_SPOT; i++) {
                            if (!lobbies[joiningLobbyId].filledSpots.has(i)) {
                                firstAvailableSpot = i;
                                break;
                            }
                        }

                        lobbies[joiningLobbyId] && lobbies[joiningLobbyId].players.set(accepter, {
                            username: accepter,
                            ready: false,
                            spot: firstAvailableSpot ? firstAvailableSpot : MAX_COUNT
                        });

                        //addPlayerToLobby(joiningLobbyId, accepter);
                        const lobbyUpdateResponse = {
                            type: "LOBBY_DETAILS",
                            leader: lobbies[joiningLobbyId].leader,
                            matchType: lobbies[joiningLobbyId].matchType,
                            mapId: lobbies[joiningLobbyId].mapId,
                            filledSpots: lobbies[joiningLobbyId].filledSpots,
                            players: Array.from(lobbies[joiningLobbyId].players.values())
                        }
                        broadcastInLobby(JSON.stringify(lobbyUpdateResponse, null, 2), joiningLobbyId, "0");
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

        if (parsedData.type == "SEND_MESSAGE_IN_LOBBY") {
            const message = parsedData.message;
            const lobbyId = parsedData.lobbyId;
            const from = parsedData.from;
            broadcastInLobby(message, lobbyId, from);
            userSocket.send("message sent in the lobby");
        }

        if (parsedData.type == "LOBBY_START_GAME" || "LOBBY_END_GAME") {
            const from = parsedData.from;
            const type = parsedData.type;
            let message;
            type == "LOBBY_START_GAME" ? message = {
                type: "LOBBY_START_GAME"
            } : message = {
                type: "LOBBY_END_GAME"
            };

            Object.keys(lobbies).forEach((lobbyId) => {
                if (lobbies[lobbyId].leader == from) {
                    broadcastInLobby(JSON.stringify(message), lobbyId, from);
                }
            })
            userSocket.send("game start/end info shared in the lobby");
        }

        if (parsedData.type == "SHARE_GAME_IP_IN_LOBBY") {
            const from = parsedData.from;
            const lobbyIp = parsedData.lobbyIp
            const message = {
                type: "LOBBY_FOUND_GAME",
                from: from,
                lobbyIp: lobbyIp
            }
            Object.keys(lobbies).forEach((lobbyId) => {
                if (lobbies[lobbyId].leader == from) {
                    broadcastInLobby(JSON.stringify(message), lobbyId, from);
                }
            })
            userSocket.send("lobby IP shared in the lobby");
        }

        // {
        //     "type": "LOBBY_UPDATE",
        //     "lobbyId": "lobby_123",
        //     "from": "player_1",
        //     "data": {
        //     "newSpot": 3,
        //     "ready": true,
        //     "newMatchType": "ranked",
        //     "newMapId": "map_123"
        //     }
        //     }

        if (parsedData.type == "LOBBY_UPDATE") {
            const lobbyId = parsedData.lobbyId;
            const from = parsedData.from;
            const updateFields = parsedData.data as UpdateLobbyData;
            let singleFail = false;
            const lobbyUpdateResponse = {
                type: "LOBBY_DETAILS",
                leader: lobbies[lobbyId].leader,
                matchType: lobbies[lobbyId].matchType,
                mapId: lobbies[lobbyId].mapId,
                filledSpots: lobbies[lobbyId].filledSpots,
                players: Array.from(lobbies[lobbyId].players.values())
            }

            if (updateFields.newSpot) {
                if (lobbies[lobbyId].filledSpots.has(updateFields.newSpot)) {
                    userSocket.send(JSON.stringify(lobbyUpdateResponse));
                    singleFail = true;
                } else {
                    lobbies[lobbyId].filledSpots.add(updateFields.newSpot);
                    lobbyUpdateResponse.filledSpots = lobbies[lobbyId].filledSpots;
                }
            }
            if (updateFields.ready) {
                try {
                    const player = lobbies[lobbyId].players.get(from);
                    if (player) {
                        player.ready = updateFields.ready;
                        const oldPlayerData = lobbyUpdateResponse.players.find((player) => player.username == from);
                        if (oldPlayerData) {
                            oldPlayerData.ready = player.ready;
                        }
                    }
                } catch (error) {
                    console.log("Update lobby fields error", error);
                    userSocket.send(JSON.stringify(lobbyUpdateResponse));
                    singleFail = true;
                }
            }

            if (updateFields.newMatchType) {
                if (from == lobbies[lobbyId].leader) {
                    lobbies[lobbyId].matchType = updateFields.newMatchType;
                    lobbyUpdateResponse.matchType = lobbies[lobbyId].matchType;
                } else {
                    userSocket.send(JSON.stringify(lobbyUpdateResponse))
                    singleFail = true;
                }
            }

            if (updateFields.newMapId) {
                if (from == lobbies[lobbyId].leader) {
                    lobbies[lobbyId].mapId = updateFields.newMapId;
                    lobbyUpdateResponse.mapId = lobbies[lobbyId].mapId;
                } else {
                    userSocket.send(JSON.stringify(lobbyUpdateResponse));
                    singleFail = true;
                }
            }

            if (!singleFail) {
                broadcastInLobby(JSON.stringify(lobbyUpdateResponse, null, 2), lobbyId, "0");
            }
        }



        if (parsedData.type == "EXIT_LOBBY") {
            const deserter = parsedData.from;
            Object.keys(connectedUsers).forEach((id) => {
                const { username, ws } = connectedUsers[id];
                if (username === deserter) {
                    const currentLobbyId = connectedUsers[id].lobby || "";
                    const lobbyLeader = lobbies[currentLobbyId].leader;

                    if (deserter == lobbyLeader) {
                        broadcastInLobby(JSON.stringify({ "type": "LOBBY_DESTROYED" }, null, 2), currentLobbyId, deserter);
                        ws.send(`You left your lobby`);
                    }
                    removePlayerFromLobby(deserter, currentLobbyId);
                    //removePlayerFromDatabaseLobby(currentLobbyId, deserter);
                    if (deserter != lobbyLeader) {
                        connectedUsers[id].lobby = lobbyId;
                        lobbies[lobbyId] = {
                            leader: deserter,
                            filledSpots: new Set<number>([1]),
                            mapId: "map_1",
                            matchType: "unranked",
                            players: new Map<string, PlayerInLobby>([[deserter, {
                                username: deserter,
                                ready: false,
                                spot: 1
                            }]])
                        }

                        const lobbyUpdateResponse = {
                            type: "LOBBY_DETAILS",
                            leader: lobbies[currentLobbyId].leader,
                            matchType: lobbies[currentLobbyId].matchType,
                            mapId: lobbies[currentLobbyId].mapId,
                            filledSpots: lobbies[currentLobbyId].filledSpots,
                            players: Array.from(lobbies[currentLobbyId].players.values())
                        }
                        broadcastInLobby(JSON.stringify(lobbyUpdateResponse, null, 2), currentLobbyId, deserter);
                        ws.send(`You left ${lobbyLeader}'s lobby`);
                        //changeLobbyLeader(lobbyId,deserter);
                        //addPlayerToLobby(lobbyId, deserter);
                    }
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
            }, null, 2));
            if (!result.error) {
                const reciever = Object.values(connectedUsers).find(user => user.username == to);
                if (reciever) {
                    reciever.ws.send(JSON.stringify({
                        type: 'RECEIVED_FRIEND_REQUEST',
                        from: from,
                        message: "You recieved a friend request"
                    }, null, 2))
                }
            }
        }

        if (parsedData.type == "FINALIZE_FRIEND_REQUEST") {
            const from = parsedData.playFabId;
            const to = parsedData.friendPlayFabId;
            const tag = parsedData.tag;
            const result = await setConfirmTags(from, to, tag);
            userSocket.send(JSON.stringify({
                type: 'FINALIZE_REQUEST_PROCESSED',
                success: result.success,
                error: result.error || null
            }, null, 2))

            if (!result.error) {
                const reciever = Object.values(connectedUsers).find(user => user.username == to);
                if (reciever) {
                    reciever.ws.send(JSON.stringify({
                        type: 'FRIEND_REQUEST_ACCEPTED',
                        from: from,
                        success: result.success,
                        error: result.error || null,
                        message: "Your friend request is accepted"
                    }, null, 2))
                }
            }
        }

        if (parsedData.type == "REMOVE_FRIEND") {
            const from = parsedData.playFabId;
            const to = parsedData.friendPlayFabId;
            const result = await removeFriend(from, to);

            userSocket.send(JSON.stringify({
                type: 'REMOVE_FRIEND_REQUEST_PROCESSED',
                success: result.success,
                error: result.error || null,
                message: result.success ? "Friend removed from you friend list" : "Request failed"
            }, null, 2))

            if (!result.error) {
                const reciever = Object.values(connectedUsers).find(user => user.username == to);
                if (reciever) {
                    reciever.ws.send(JSON.stringify({
                        type: 'REMOVE_FRIEND_REQUEST_PROCESSED',
                        from: from,
                        success: result.success,
                        error: result.error || null,
                        message: result.success ? "Friend removed from you friend list" : "Request failed"
                    }, null, 2))
                }
            }
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
                    const lobbyDetail = {
                        type: "LOBBY_DETAILS",
                        leader: lobby.leader,
                        matchType: lobby.matchType,
                        mapId: lobby.mapId,
                        filledSpots: lobby.filledSpots,
                        players: Array.from(lobby.players.values())
                    }
                    userSocket.send(JSON.stringify(lobbyDetail, null, 2));
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
                    const userLobbyId = connectedUsers[id].lobby || "";

                    if (playerName == lobbies[userLobbyId].leader) {
                        broadcastInLobby(JSON.stringify({ "type": "LOBBY_DESTROYED" }, null, 2), userLobbyId, playerName);
                    }
                    removePlayerFromLobby(playerName, userLobbyId);
                    if (playerName != lobbies[userLobbyId].leader) {
                        const lobbyUpdateResponse = {
                            type: "LOBBY_DETAILS",
                            leader: lobbies[userLobbyId].leader,
                            matchType: lobbies[userLobbyId].matchType,
                            mapId: lobbies[userLobbyId].mapId,
                            filledSpots: lobbies[userLobbyId].filledSpots,
                            players: Array.from(lobbies[userLobbyId].players.values())
                        }
                        broadcastInLobby(JSON.stringify(lobbyUpdateResponse, null, 2), userLobbyId, playerName);
                    }
                    //removePlayerFromDatabaseLobby(userLobbyId, playerName);
                    removePlayerOnDisconnect(playerName);
                    delete connectedUsers[id];
                    delete lobbies[lobbyId];
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
        const isPlayerLobbyMember = lobbies[lobbyId].players.has(username)
        if (isPlayerLobbyMember && ws.readyState == WebSocket.OPEN && username != broadcaster) {
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
        lobbies[lobbyId].players.forEach(async (playerData, playerUsername) => {
            if (playerUsername != lobbies[lobbyId].leader) {
                const newLobbyId = randomId();
                lobbies[newLobbyId] = {
                    leader: playerUsername,
                    filledSpots: new Set<number>([1]),
                    mapId: "map_1",
                    matchType: "unranked",
                    players: new Map<string, PlayerInLobby>().set(playerUsername, {
                        username: playerUsername,
                        ready: false,
                        spot: 1
                    }),
                };
                lobbies[lobbyId].players.delete(playerUsername);
                const playerSpot = lobbies[lobbyId].players.get(playerUsername)?.spot;
                if (playerSpot) {
                    lobbies[lobbyId].filledSpots.delete(playerSpot);
                }
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
        const playerSpot = lobbies[lobbyId].players.get(username)?.spot;
        if (playerSpot) {
            lobbies[lobbyId].filledSpots.delete(playerSpot);
        }
        //await removePlayerFromDatabaseLobby(lobbyId, username);
    }
}

