import axios from "axios"
require('dotenv').config();

type TagType = 'SentPending' | 'RecievePending' | 'Confirm' | 'Decline';

const addFriendUrl = process.env.PLAYFAB_ADD_FRIEND_URL || "";
const setTagUrl = process.env.PLAYFAB_SET_TAG_URL || "";
const removeFriendUrl = process.env.PLAYFAB_REMOVE_FRIEND_URL || "";
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
