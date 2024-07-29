import axios from "axios"
require('dotenv').config();

const addFriendUrl = process.env.PLAYFAB_ADD_FRIEND_URL || "";
const setTagUrl = process.env.PLAYFAB_SET_TAG_URL || "";
const secret = process.env.PLAYFAB_SECRET || "";

const tags = {
  SentPending: ["SentPending"],
  RecievePending: ["RecievePending"],
  Confirm: ["Confirm"],
};

const setTagPayload = (from: string, to: string, tag: string[]) => ({
  PlayFabId: from,
  FriendPlayFabId: to,
  Tags: tag,
});


async function sendRequest(url: string, payload: any) {
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-SecretKey': secret
      }
    });
    console.log('Response:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('Error:', error.response ? error.response.data : error.message);
    throw error;
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

export async function setConfirmTags(PlayFabId: string, FriendPlayFabId: string) {

  try {
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

    console.log("Confirm tags set successfully");
    return { success: true };
  } catch (error: any) {
    console.error(
      "Error in confirming friend request :",
      error.message,
    );
    return { success: false, error: error.message };
  }
}
