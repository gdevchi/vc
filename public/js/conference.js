const conferenceEl = document.querySelector(".conference");
const audioContainer = document.querySelector(".audio-container");
const form = document.querySelector("form");
const messageContainer = document.querySelector(".message-container");

const socket = io.connect("/"); //make connection with socket server

const state = {
  username: new URLSearchParams(window.location.search).get("username"),
  peers: {}, //store connected users
  audioTrack: null,
  audioStream: null,
  rtcConfig: {
    //simple third party server to retrieve network details
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "turn:159.203.22.190:5500",
        username: "abdullah",
        credential: "qwerty123",
      },
    ],
  },
};

function showLogs(message) {
  insertMessage({ text: message, username: "System" });
}

function getRandomColor() {
  const randomHex = Math.floor(Math.random() * 16777215).toString(16);
  return "#" + randomHex.padStart(6, "0");
}

function getRandomPosition(circle) {
  const childRect = circle.getBoundingClientRect();
  const maxX = conferenceEl.clientWidth - childRect.width - 150;
  const maxY = conferenceEl.clientHeight - childRect.height - 150;
  const randomX = Math.floor(Math.random() * maxX);
  const randomY = Math.floor(Math.random() * maxY);
  return { x: randomX, y: randomY };
}

function createCircle(user) {
  const circle = document.createElement("div");
  circle.id = `ID_${user.userId}`;
  circle.className = "circle";
  circle.style.display = "flex";
  circle.style.backgroundColor = getRandomColor();
  const { x, y } = getRandomPosition(circle);
  circle.style.left = x + "px";
  circle.style.top = y + "px";
  circle.innerHTML = `<label>${user.username}</label>`;
  conferenceEl.appendChild(circle);
}

function removeCircle(userId) {
  const circle = document.querySelector(`#ID_${userId}`);
  if (!circle) return;
  conferenceEl.removeChild(circle);
}

function chanegMicStatus(message, active) {
  const micEl = document.querySelector(".mic");
  //show message related to micrphone access
  micEl.children[0].textContent = message;
  //change microphone access
  micEl.children[1].innerHTML = `<i class="fas ${
    active ? "fa-microphone" : "fa-microphone-slash"
  }"></i>`;
}

function setRemoteAudioTrack(event, userId) {
  const [remoteStream] = event.streams;
  const div = document.createElement("div");
  div.id = `DA_${userId}`;
  const audio = document.createElement("audio");
  audio.id = `A_${userId}`;
  audio.srcObject = remoteStream;
  audio.play();
  div.appendChild(audio);
  audioContainer.appendChild(div);
}

function removeRemoteAudioTrack(userId) {
  const child = document.querySelector(`#DA_${userId}`);
  audioContainer.removeChild(child);
}

function insertMessage(message) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("msg-wrapper");
  if (state.username === message.username) wrapper.classList.add("owner"); //add owner class to align message right side

  const sender = document.createElement("span");
  sender.classList.add("sender");
  sender.innerText = message.username;
  wrapper.appendChild(sender);

  const msg = document.createElement("span");
  msg.classList.add("message");
  msg.innerText = message.text;
  wrapper.appendChild(msg);

  messageContainer.appendChild(wrapper);
  //scroll top to see latest message
  messageContainer.scrollTop = messageContainer.scrollHeight;
}

//ask for microphone access
function getAudioStreamAccess() {
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      state.audioTrack = stream.getAudioTracks()[0];
      state.audioStream = new MediaStream([state.audioTrack]);
      state.audioTrack.addEventListener("mute", () => {
        chanegMicStatus("Your mic is muted", false);
      });
      state.audioTrack.addEventListener("unmute", () => {
        chanegMicStatus("Your mic is unmuted", true);
      });
      state.audioTrack.addEventListener("ended", (e) => {
        chanegMicStatus("Mic stopped", true);
      });
      if (state.audioTrack.muted) {
        chanegMicStatus("Your mic is muted", false);
      } else {
        chanegMicStatus("You mic is unmuted", true);
      }
      socket.emit("user-joined", state.username).on("user", createCircle);
    })
    .catch((err) => {
      chanegMicStatus(err.message);
    });
}

//start a webrtc call with new user
socket.on("user-joined", async ({ user }) => {
  try {
    //create new connection
    const peerConnection = new RTCPeerConnection(state.rtcConfig);
    //add local track in remote user connection
    peerConnection.addTrack(state.audioTrack, state.audioStream);
    //create offer for new user
    //offer: contains system config like: type of media format being send, ip address and port of caller
    const offer = await peerConnection.createOffer();
    //set offer description in local connection
    peerConnection.setLocalDescription(offer);
    //receive network details from third party server and send details to new user
    peerConnection.addEventListener("icecandidate", function (event) {
      //send network details to new user
      //if (event.candidate) {
        socket.emit("ICE-Candidate", {
          receiver: user.userId,
          candidate: event.candidate,
        });
      //}
    });
    peerConnection.addEventListener(
      "icegatheringstatechange",
      function (event) {
        //check gathering status
        showLogs(
          `${user.username} ICE Candidate Gathering State ${event.target.iceGatheringState} | ${peerConnection.iceConnectionState}`
        );
      }
    );
    peerConnection.addEventListener("icecandidateerror", function (event) {
      const { errorCode, errorText, url } = event;
      showLogs(`ICE candidate error:', ${errorCode}, ${errorText}, ${url}`);
    });
    //when new user get chance to speak, this listener will trigger and set the remote stream on dom
    peerConnection.addEventListener("track", (event) => {
      //create new user circle
      createCircle(user);
      setRemoteAudioTrack(event, user.userId);
      showLogs(`${user.username} Connected!`);
    });
    //send offer (system config) to new user
    socket.emit("call", { userId: user.userId, offer });
    //store peer connection
    state.peers[user.userId] = { peerConnection };
  } catch (err) {
    console.log(err);
    showLogs(
      `Error occured on joined user socket: ${err.message}, please check console for more details!`
    );
  }
});

//receive answer from new user
socket.on("answer", async ({ responder, answer }) => {
  try {
    //get responder connection
    const peerConnection = state.peers[responder].peerConnection;
    //set responder answer (system config) in connection
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  } catch (err) {
    console.log(err);
    showLogs(
      `Error occured while answering call: ${err.message}, please check console for more details!`
    );
  }
});

//recieve network details (ICE-Candidate) of user
socket.on("ICE-Candidate", async ({ sender, candidate }) => {
  try {
    if (!state.peers[sender]) return;
    //find sender peer connection in list of peers
    const peerConnection = state.peers[sender].peerConnection;
    //store network details in connection
    await peerConnection.addIceCandidate(candidate);
  } catch (err) {
    console.log(err);
    showLogs(
      `Error occured on ice-candiate socket: ${err.message}, please check console for more details!`
    );
  }
});

//receive call (offer) from users and respond to call by sharing their system details
socket.on("call", async ({ caller, callerName, offer }) => {
  try {
    //create new webrtc peer connection
    const peerConnection = new RTCPeerConnection(state.rtcConfig);
    //add local stream to caller connection
    peerConnection.addTrack(state.audioTrack, state.audioStream);
    //receive network details from third party server and send it to caller
    peerConnection.addEventListener("icecandidate", function (event) {
      //send network details to caller
      //if (event.candidate) {
        socket.emit("ICE-Candidate", {
          receiver: caller,
          candidate: event.candidate,
        });
      //}
    });

    peerConnection.addEventListener(
      "icegatheringstatechange",
      function (event) {
        //check gathering status
        showLogs(
          `${callerName} ICE Candidate Gathering State ${event.target.iceGatheringState} | ${peerConnection.iceConnectionState}`
        );
      }
    );
    peerConnection.addEventListener("icecandidateerror", function (event) {
      const { errorCode, errorText, url } = event;
      showLogs(`ICE candidate error:', ${errorCode}, ${errorText}, ${url}`);
    });
    peerConnection.addEventListener("track", (event) => {
      //show caller circle
      createCircle({ userId: caller, username: callerName });
      setRemoteAudioTrack(event, caller);
      showLogs(`${callerName} Connected!`);
    });
    //set received offer (caller system config) in connection
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    //create your system config as answer
    const answer = await peerConnection.createAnswer();
    //set answer in connection
    await peerConnection.setLocalDescription(answer);
    //send call response (system config) to caller
    socket.emit("answer", { caller, answer });
    //store caller peer connection
    state.peers[caller] = { peerConnection };
  } catch (err) {
    console.log(err);
    showLogs(
      `Error occured while calling: ${err.message}, please check console for more details!`
    );
  }
});

socket.on("message", insertMessage);

socket.on("user-disconnect", ({ userId }) => {
  //close and delete user connection from list connected users peer
  if (!state.peers[userId]) return;
  state.peers[userId].peerConnection.close();
  delete state.peers[userId];
  removeCircle(userId);
  removeRemoteAudioTrack(userId);
  showLogs(`User disconnected`);
});

//handle form submission
form.addEventListener("submit", (e) => {
  e.preventDefault(); //prevent page from reloading
  const message = e.target.elements.message.value;
  if (!message) return;
  //send message to other users in room
  const payload = {
    username: state.username,
    text: message,
  };
  socket.emit("message", payload);
  //display message in your chat box
  insertMessage(payload);
  //clear form input
  e.target.elements.message.value = "";
  e.target.elements.message.focus();
});

window.addEventListener("DOMContentLoaded", () => getAudioStreamAccess());
