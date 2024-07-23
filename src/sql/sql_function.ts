import sql from "./database"

export async function addUser({id, username} : {
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

export async function deleteUser(id: string){
    try {
        await sql`DELETE FROM player_data WHERE id=${id}`;
        console.log("player data deleted succesfully");
    } catch (error) {
        console.log(error);
    }
}

export async function findPlayerById(playerId : string) {
    try {
      const result = await sql`
        SELECT * FROM player_data
        WHERE id = ${playerId};
      `;
  
      if (result.length === 0) {
        console.log(`Player with ID ${playerId} not found.`);
        return false;
      }
  
      return true; // Assuming ID is unique and returns only one row
    } catch (error) {
      console.error('Error fetching player by ID:', error);
      return false;
    }
  }