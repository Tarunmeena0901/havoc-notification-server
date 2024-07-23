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

export async function findPlayerById(username : string) {
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