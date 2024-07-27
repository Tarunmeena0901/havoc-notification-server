import sql from "./database"

export async function addUser({ id, username }: {
  id: string,
  username: string
}) {
  try {
    await sql`INSERT INTO player_data(id , username) VALUES (${id}, ${username})`;
    console.log("player added succesfully");
  } catch (error) {
    console.log(error);
  }

}

export async function deleteUser(id: string) {
  try {
    await sql`DELETE FROM player_data WHERE id=${id}`;
    console.log("player data deleted succesfully");
  } catch (error) {
    console.log(error);
  }
}

export async function findPlayerById(username: string) {
  try {
    const result = await sql`
        SELECT * FROM player_data
        WHERE username = ${username};
      `;
    if (result.length === 0) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error fetching player by ID:', error);
    return false;
  }
}

export async function addLobby(id: string, leader: string, players: Set<string>) {
  const playersArray = Array.from(players);
  try {
    await sql`INSERT INTO lobbies(id, leader, players) VALUES (${id}, ${leader}, ${playersArray})`;
    console.log("lobby added succesfully");
  } catch (error) {
    console.log(error);
  }
}

export async function addPlayerToLobby(id: string, username: string) {
  try {
    await sql`UPDATE lobbies SET players = array_append(players, ${username}) WHERE id = ${id}`;
    console.log("Player added to the lobby ", id);
  } catch (error) {
    console.log(error);
  }
}

export async function changeLobbyLeader(id: string, username: string) {
  try {
    await sql`UPDATE lobbies SET leader = ${username} WHERE id = ${id}`;
    console.log("Leader changed succesfully ", id);
  } catch (error) {
    console.log(error);
  }
}

export async function deleteLobby(id: string) {
  try {
    await sql`DELETE FROM lobbies WHERE id = ${id}`;
    console.log(` lobby deleted succesfully, id : ${id}`)
  } catch (error) {
    console.log(error);
  }
}

export async function removePlayerFromDatabaseLobby(id: string, username: string) {
  try {
    await sql`UPDATE lobbies SET players = array_remove(players, ${username}) WHERE id = ${id}`;
    console.log(`${username} removed from the lobby ${id}`);
  } catch (error) {
    console.log(error);
  }
}

export async function rebuildLobbies(
  lobbies: {
    [key: string]: {
      leader: string,
      players: Set<string>
    }
  }) {
    try {
      const rows: { id: string, leader: string, players: string[] }[] = await sql`SELECT * FROM lobbies `;
  if (rows.length > 0) {  
    rows.forEach((lobbyData) => {
      lobbies[lobbyData.id] = {
        leader: lobbyData.leader,
        players: new Set<string>(lobbyData.players)
      }
    })
  }
    } catch (error) {
      console.log("something bad happened while rebuilding the lobbies: \n", error);
    }
  
}
