import { WebSocket, WebSocketServer } from "ws";
import { addUser, findPlayerById } from "./sql/sql_function";
import { cancelPlayerAllTickets, createMatchmakingTicket, findFreePort, getEntityToken, getMatchmakingStatus, getMatchMembers, removeFriend, setConfirmTags, twoWayAddFriend } from "./play-fab/playfab_function";
import sql from "./sql/database";
import { exec } from "child_process";
import bcrypt from 'bcrypt';


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

        if (parsedData.type === "SUBSCRIBE") {
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
                    spot: 0,
                    ping: MAX_COUNT
                }
                lobbies[lobbyId] = {
                    leader: parsedData.username,
                    mapId: "FFA",
                    matchType: "custom",
                    players: new Map<string, PlayerInLobby>([[parsedData.username, initPlayerInLobby]]),
                    filledSpots: new Set<number>([0])
                }
                //addLobby(lobbyId,"", new Set<string>());
                //addPlayerToLobby(lobbyId, parsedData.username );

                const player_data = {
                    id,
                    username: parsedData.username
                }

                // RECHECK : this may not be required after login function
                // const isStoredInDatabase = await findPlayerById(parsedData.username);
                // if (!isStoredInDatabase) {
                //     await addUser(player_data);
                // }
                broadcast(`${parsedData.username} is now online`, parsedData.username);
            }
        }

        if (parsedData.type === "MESSAGE") {
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

        if (parsedData.type === "LOBBY_INVITE_REQUEST") {
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

        if (parsedData.type === "LOBBY_REQUEST_RESPONSE") {
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

                        let firstAvailableSpot = MAX_COUNT;

                        try {
                            for (let i = 0; i <= MAX_LOBBY_SPOT; i++) {
                                if (!lobbies[joiningLobbyId].filledSpots.has(i)) {
                                    firstAvailableSpot = i;
                                    break;
                                }
                            }
                        } catch (error) {
                            console.log(error);
                        }


                        lobbies[joiningLobbyId] && lobbies[joiningLobbyId].players.set(accepter, {
                            username: accepter,
                            ready: false,
                            spot: firstAvailableSpot,
                            ping: MAX_COUNT
                        });

                        lobbies[joiningLobbyId].filledSpots.add(firstAvailableSpot)
                        //addPlayerToLobby(joiningLobbyId, accepter);
                        const lobbyUpdateResponse = {
                            type: "LOBBY_DETAILS",
                            data: {
                                lobbyId: joiningLobbyId,
                                leader: lobbies[joiningLobbyId].leader,
                                matchType: lobbies[joiningLobbyId].matchType,
                                mapId: lobbies[joiningLobbyId].mapId,
                                filledSpots: Array.from(lobbies[joiningLobbyId].filledSpots),
                                players: Array.from(lobbies[joiningLobbyId].players.values())
                            }
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

        if (parsedData.type === "SEND_MESSAGE_IN_LOBBY") {
            const message = parsedData.message;
            const lobbyId = parsedData.lobbyId;
            const from = parsedData.from;
            const data = {
                type: "RECEIVED_MESSSAGE",
                lobbyId: lobbyId,
                from: from,
                message: message
            }
            broadcastInLobby(JSON.stringify(data, null, 2), lobbyId, from);
            userSocket.send("message sent in the lobby");
        }

        if (parsedData.type === "LOBBY_START_GAME" || parsedData.type === "LOBBY_END_GAME") {
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
            console.log("reaching here for no fucking reason")
            userSocket.send("game start/end info shared in the lobby");
        }

        if (parsedData.type === "SHARE_GAME_IP_IN_LOBBY") {
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


        if (parsedData.type === "GET_MATCH") {
            const queueId = parsedData.queueId;
            const from = parsedData.from;

            const entityTokenData = await getEntityToken();

            const playerLobby = Object.values(lobbies).find((lobby) => lobby.leader === from);

            if (!playerLobby) {
                throw Error('error finding the lobby');
            }

            const lobbyMembers = Array.from(playerLobby?.players.values())
            console.log("LOBBY ",  JSON.stringify(lobbyMembers,null,2))

            const ticketId = await createMatchmakingTicket(queueId, lobbyMembers, entityTokenData.token);

            console.log("TICKET ID ",  JSON.stringify(ticketId,null,2))
            let matchId = '';

            while (true) {
                try {
                    const {Status, MatchId} = await getMatchmakingStatus(queueId, ticketId, entityTokenData.token);
                    if (Status === 'Matched') {
                        matchId = MatchId
                        break;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 6500));
                    }
                } catch (error) {
                    console.error('Error fetching matchmaking status:', error);
                    break;
                }
            }

            const finalMemberList: any[] = await getMatchMembers(queueId, matchId, entityTokenData.token);

            console.log("MEMBERS ",  JSON.stringify(finalMemberList,null,2))

            if(finalMemberList){
                try {
                    const port = await findFreePort();
                    const command = `../../WindowsServer/PanoverseServer.exe -server -log -port=${port}`; // Change server name
        
                    exec(command, (error, stdout, stderr) => {
                        if (error) {
                            console.error("Failed to start server:", error);
                            return;
                        }
                        console.log("Server started successfully on port:", port);
        
                        Object.values(connectedUsers).forEach((player) => {
                            finalMemberList.forEach((member) => {
                                if (player.username === member.Entity.Id) {
                                    player.ws.send(
                                        JSON.stringify({
                                            type: "MATCH_SERVER_START",
                                            message: "Server started",
                                            ip: "204.10.193.60",
                                            port: port,
                                        })
                                    );
                                }
                            });
                        });
                    });
                } catch (err) {
                    console.error("Error finding free port:", err);
                }
            }

        }

        if (parsedData.type === 'signup') {
            
            const {displayName, password, email , playfabId} = parsedData

            if (!displayName || !password || !email) {
              userSocket.send(JSON.stringify({ status: 'error', message: 'Username, password, and email are required.' }));
              return;
            }
    
            const userExists = await sql`SELECT * FROM player_data WHERE display_name = ${displayName} OR email = ${email}`;
            if (userExists.length > 0) {
                userSocket.send(JSON.stringify({ status: 'error', message: 'Username or email already exists.' }));
              return;
            }
    
            const passwordHash = await bcrypt.hash(password, 9);

            // setting inital rank to 1
            await sql`
              INSERT INTO player_data (playfab_id, display_name, email, password_hash, rank)
              VALUES (${playfabId}, ${displayName}, ${email}, ${passwordHash}, 1) 
            `;
            
            userSocket.send(JSON.stringify({ status: 'success', message: 'User signed up successfully.', customId: playfabId }));
          }

          if (parsedData.type === 'LOGIN') {
            
            const {displayName , password} = parsedData;

            if (!displayName || !password) {
              userSocket.send(JSON.stringify({ status: 'error', message: 'Username and password are required.' }));
              return;
            }
    
            const userResult = await sql`SELECT * FROM player_data WHERE display_name = ${displayName}`;
    
            if (userResult.length === 0) {
              userSocket.send(JSON.stringify({ status: 'error', message: 'User not found.' }));
              return;
            }
    
            const user = userResult[0];
            const passwordMatch = await bcrypt.compare(password, user.password_hash);
            if (!passwordMatch) {
              userSocket.send(JSON.stringify({ status: 'error', message: 'Invalid password.' }));
              return;
            }
    
            const sessionId = crypto.randomUUID();

            await sql`
              INSERT INTO sessions (session_id, player_id, expires_at)
              VALUES (${sessionId}, ${user.player_id}, NOW() + INTERVAL '12 hour')
            `;
    
            // Add player to active players
            // RECHECK: either add the player in active player list while login or while subscribing

            // activePlayers.set(user.playfab_id, { ws, rank: user.rank });

            userSocket.send(JSON.stringify({ status: 'success', message: 'Login successful.', sessionId }));
          }

        if (parsedData.type === "LOBBY_UPDATE") {
            const lobbyId = parsedData.lobbyId;
            const from = parsedData.from;
            const updateFields = parsedData.data as UpdateLobbyData;
            let singleFail = false;

            const lobbyUpdateResponse = {
                type: "LOBBY_DETAILS",
                data: {
                    lobbyId: lobbyId,
                    leader: lobbies[lobbyId].leader,
                    matchType: lobbies[lobbyId].matchType,
                    mapId: lobbies[lobbyId].mapId,
                    filledSpots: Array.from(lobbies[lobbyId].filledSpots),
                    players: Array.from(lobbies[lobbyId].players.values())
                }
            }

            const currentPlayerUpdateData = lobbyUpdateResponse.data.players.find((player) => player.username == from);
            const currentPlayerData = lobbies[lobbyId].players.get(from);

            if (!currentPlayerData || !currentPlayerUpdateData) {
                userSocket.send("could not find player or player is offline");
                throw new Error(`player ${from} does not exist`);
            }

            if (updateFields.newSpot !== undefined && updateFields.newSpot != currentPlayerData.spot) {
                if (lobbies[lobbyId].filledSpots.has(updateFields.newSpot)) {
                    singleFail = true;
                } else {
                    try {
                        const indexOfSpot = lobbyUpdateResponse.data.filledSpots.indexOf(currentPlayerData.spot);
                        lobbyUpdateResponse.data.filledSpots.splice(indexOfSpot, 1);
                        lobbyUpdateResponse.data.filledSpots.push(updateFields.newSpot);
                        currentPlayerUpdateData.spot = updateFields.newSpot;
                    } catch (error) {
                        console.log("error updating the player position in lobby", error);
                    }

                }
            }
            if (updateFields.ready !== undefined && updateFields.ready != currentPlayerData.ready) {
                try {
                    currentPlayerUpdateData.ready = updateFields.ready;
                } catch (error) {
                    singleFail = true;
                }
            }

            if (updateFields.ping !== undefined) {
                try {
                    currentPlayerUpdateData.ping = updateFields.ping;
                } catch (error) {
                    console.log("failed to update ping", error);
                    singleFail = true;
                }
            }

            if (from == lobbies[lobbyId].leader) {
                if (updateFields.newMatchType !== undefined && updateFields.newMatchType != lobbies[lobbyId].matchType) {
                    lobbyUpdateResponse.data.matchType = updateFields.newMatchType;
                }
                if (updateFields.newMapId !== undefined && updateFields.newMapId != lobbies[lobbyId].mapId) {
                    lobbyUpdateResponse.data.mapId = updateFields.newMapId;
                }
            } else {
                if (updateFields.newMatchType !== undefined || updateFields.newMapId !== undefined) {
                    singleFail = true;
                    userSocket.send("Only leader can update match type or map ID");
                }
            }

            if (!singleFail) {

                // if no error then update lobby data
                lobbies[lobbyId].leader = lobbyUpdateResponse.data.leader;
                lobbies[lobbyId].mapId = lobbyUpdateResponse.data.mapId;
                lobbies[lobbyId].matchType = lobbyUpdateResponse.data.matchType;
                lobbies[lobbyId].filledSpots.delete(currentPlayerData.spot);
                lobbies[lobbyId].filledSpots.add(currentPlayerUpdateData.spot);
                currentPlayerData.spot = currentPlayerUpdateData.spot;

                broadcastInLobby(JSON.stringify(lobbyUpdateResponse, null, 2), lobbyId, "0");
            } else {
                const failedLobbyUpdateResponse = {
                    type: "LOBBY_DETAILS",
                    data: {
                        lobbyId: lobbyId,
                        leader: lobbies[lobbyId].leader,
                        matchType: lobbies[lobbyId].matchType,
                        mapId: lobbies[lobbyId].mapId,
                        filledSpots: Array.from(lobbies[lobbyId].filledSpots),
                        players: Array.from(lobbies[lobbyId].players.values())
                    }
                }

                userSocket.send(JSON.stringify(failedLobbyUpdateResponse));
                console.log("Update lobby fields error");
            }
        }



        if (parsedData.type === "EXIT_LOBBY") {
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
                            filledSpots: new Set<number>([0]),
                            mapId: "FFA",
                            matchType: "custom",
                            players: new Map<string, PlayerInLobby>([[deserter, {
                                username: deserter,
                                ready: false,
                                spot: 0
                            }]])
                        }

                        const lobbyUpdateResponse = {
                            type: "LOBBY_DETAILS",
                            data: {
                                lobbyId: currentLobbyId,
                                leader: lobbies[currentLobbyId].leader,
                                matchType: lobbies[currentLobbyId].matchType,
                                mapId: lobbies[currentLobbyId].mapId,
                                filledSpots: Array.from(lobbies[currentLobbyId].filledSpots),
                                players: Array.from(lobbies[currentLobbyId].players.values())
                            }
                        }
                        broadcastInLobby(JSON.stringify(lobbyUpdateResponse, null, 2), currentLobbyId, deserter);
                        ws.send(`You left ${lobbyLeader}'s lobby`);
                        //changeLobbyLeader(lobbyId,deserter);
                        //addPlayerToLobby(lobbyId, deserter);
                    }
                }
            })
        }

        if (parsedData.type === "SEND_FRIEND_REQUEST") {
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

        if (parsedData.type === "FINALIZE_FRIEND_REQUEST") {
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

        if (parsedData.type === "REMOVE_FRIEND") {
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

        if (parsedData.type === "RETRIEVE_LOBBY") {
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
                        data: {
                            lobbyId: lobbyId,
                            leader: lobby.leader,
                            matchType: lobby.matchType,
                            mapId: lobby.mapId,
                            filledSpots: Array.from(lobby.filledSpots),
                            players: Array.from(lobby.players.values())
                        }
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

    userSocket.on('close', async () => {
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
                            data: {
                                lobbyId: userLobbyId,
                                leader: lobbies[userLobbyId].leader,
                                matchType: lobbies[userLobbyId].matchType,
                                mapId: lobbies[userLobbyId].mapId,
                                filledSpots: Array.from(lobbies[userLobbyId].filledSpots),
                                players: Array.from(lobbies[userLobbyId].players.values())
                            }
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
                    filledSpots: new Set<number>([0]),
                    mapId: "FFA",
                    matchType: "custom",
                    players: new Map<string, PlayerInLobby>().set(playerUsername, {
                        username: playerUsername,
                        ready: false,
                        spot: 0
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

