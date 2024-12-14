import axios from "axios"
require('dotenv').config();
import net from "net";

type TagType = 'SentPending' | 'RecievePending' | 'Confirm' | 'Decline';

// code repetion
type PlayerInLobby = {
  username: string,
  spot: number,
  ping?: number,
  ready: boolean
}

const addFriendUrl = `https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Server/AddFriend`;
const setTagUrl = `https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/SetFriendTags`;
const removeFriendUrl = `https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Server/RemoveFriend`;
const secret = process.env.PLAYFAB_SECRET || "";

const tags = {
  SentPending: ["SentPending"],
  RecievePending: ["RecievePending"],
  Confirm: ["Confirm"],
  Decline: ["Decline"]
};

const setTagPayload = (from: string, to: string, tag: string[]) => ({
  PlayFabId: from,
  FriendPlayFabId: to,
  Tags: tag,
});


async function sendRequest(url: string, payload: any, entityToken?: string) {
  const headers = {
    'Content-Type': 'application/json',
    'X-SecretKey': secret,
    'X-EntityToken': entityToken ? entityToken : undefined
  }

  try {
    const response = await axios.post(url, payload, {
      headers
    });
    console.log('Response:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('Error:', error.response.data);
    throw error.response.data;
  }
}

// async function getEntityToken(playfabId: string){
//   const payload = {
//     CustomId: playfabId,
//     "CreateAccount": false,
//     TitleId: process.env.PLAYFAB_TITLE_ID
//   }
//   const response = await sendRequest(`https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Client/LoginWithCustomID`, payload)
// }

export async function getEntityToken() {

  const response = await sendRequest(`https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Authentication/GetEntityToken`, {})

  if (response.status === 'OK') {

    return {
      success: true,
      token: response.data?.EntityToken,
      message: ''
    }
  } else {
    return {
      success: false,
      token: null,
      message: response.errorMessage
    }
  }
}


export async function twoWayAddFriend(PlayFabId: string, FriendPlayFabId: string) {

  // Payloads
  const firstFriendRequestPayload = {
    PlayFabId,
    FriendPlayFabId
  };
  const secondFriendRequestPayload = {
    PlayFabId: FriendPlayFabId,
    FriendPlayFabId: PlayFabId,
  };

  try {
    // First friend request and setting tags
    await sendRequest(addFriendUrl, firstFriendRequestPayload);
    await sendRequest(addFriendUrl, secondFriendRequestPayload);
    await Promise.all([
      sendRequest(
        setTagUrl,
        setTagPayload(PlayFabId, FriendPlayFabId, tags.SentPending),
      ),
      sendRequest(
        setTagUrl,
        setTagPayload(FriendPlayFabId, PlayFabId, tags.RecievePending),
      ),
    ]);

    console.log("Friend requests and tags set successfully");
    return { success: true };
  } catch (error: any) {
    console.error(
      "Error in processing friend requests and tags:",
      error.message,
    );
    return { success: false, error: error.message };
  }
}

export async function setConfirmTags(PlayFabId: string, FriendPlayFabId: string, tag: TagType) {
  try {
    if (tag == 'Confirm') {
      await Promise.all([
        sendRequest(
          setTagUrl,
          setTagPayload(PlayFabId, FriendPlayFabId, tags.Confirm),
        ),
        sendRequest(
          setTagUrl,
          setTagPayload(FriendPlayFabId, PlayFabId, tags.Confirm),
        ),
      ]);

      console.log(`Confirm tags set successfully`);
    }
    if (tag == 'Decline') {
      await Promise.all([
        sendRequest(
          removeFriendUrl,
          {
            PlayFabId: PlayFabId,
            FriendPlayFabId: FriendPlayFabId,
          }
        ),
        sendRequest(
          removeFriendUrl,
          {
            PlayFabId: FriendPlayFabId,
            FriendPlayFabId: PlayFabId,
          }
        ),
      ]);
      console.log(`Friend request decline  successfully`);
    }
    return { success: true };
  } catch (error: any) {
    console.error(
      `Error in declining friend request :`,
      error.message,
    );
    return { success: false, error: error };
  }
}

export async function removeFriend(PlayFabId: string, FriendPlayFabId: string) {

  const firstRemoveFriendPayload = {
    PlayFabId,
    FriendPlayFabId
  };
  const secondRemoveFriendPayload = {
    PlayFabId: FriendPlayFabId,
    FriendPlayFabId: PlayFabId,
  };
  try {
    await sendRequest(removeFriendUrl, firstRemoveFriendPayload);
    await sendRequest(removeFriendUrl, secondRemoveFriendPayload);
    return { success: true };
  } catch (error) {
    console.log("error in removing friends");
    return {
      success: false,
      error: error
    }
  }
}



export async function createMatchmakingTicket(queueId: string, members: PlayerInLobby[], entityToken: string) {

  const matchmakingPlayer = members.map((player) => {
    return {
      Attributes: {
        DataObject: {
          Latencies: [
            {
              region: "NorthEurope",
              latency: "150"
            }
          ],
          SkillRate: 0.5
        }
      },
      Entity: {
        Id: player.username,
        Type: "master_player_account"
      }
    }
  })

  const payload = {
    GiveUpAfterSeconds: 3598,
    QueueName: queueId,
    Members: matchmakingPlayer
  }

  // POST https://titleId.playfabapi.com/Match/GetMatch
  const response = await sendRequest(`https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Match/CreateServerMatchmakingTicket`, payload, entityToken);
  const ticketId = response.data.TicketId;
  return ticketId;
}

export async function cancelPlayerAllTickets(playerId: string, queueId: string, entityToken: string) {
  const payload = {
    QueueName: queueId,
    Entity: {
      Id: playerId,
      Type: "master_player_account"
    }
  }

  const response = await sendRequest(`https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Match/CancelAllMatchmakingTicketsForPlayer`, payload, entityToken);

  if (response.status === 'OK') {
    return {
      success: true,
      data: response.data?.id,
      message: ''
    }
  } else {
    return {
      success: false,
      data: null,
      message: 'Error cancelling the user tickets'
    }
  }
}

export async function getMatchmakingStatus(queueId: string, ticketId: string, entityToken: string) {

  const payload = {
    EscapeObject: false,
    QueueName: queueId,
    TicketId: ticketId
  }

  const response = await sendRequest(`https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Match/GetMatchmakingTicket`, payload, entityToken);
  const { Status, MatchId } = response;
  return { Status, MatchId }
}

export async function getMatchMembers(queueId: string, matchId: string, entityToken: string) {

  const payload = {
    EscapeObject: false,
    MatchId: matchId,
    QueueName: queueId,
    ReturnMemberAttributes: true
  }

  const response = await sendRequest(`https://${process.env.PLAYFAB_TITLE_ID}.playfabapi.com/Match/GetMatch`, payload, entityToken);
  const members = response.Members;
  return members

}

export async function findFreePort(startPort = 7777) {

  let port = startPort;

  while (port < 7810) {
    const isFree = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      })
    })

    if (isFree) {
      return port;
    }

    port++;
  }

  throw new Error("No free ports available.");
}
