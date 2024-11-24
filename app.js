// app.js
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

let swarm;
let stationKey = crypto.randomBytes(32); // Default random key for the station
let currentDeviceId = null; // To store the selected audio input device ID
let isBroadcasting = false;
let localStream; // For broadcaster's audio stream
let peerConnections = {}; // Store WebRTC peer connections
let dataChannels = {}; // Store data channels for signaling
let conns = []; // Store Hyperswarm connections

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded and parsed");
  document.getElementById('create-station').addEventListener('click', () => {
    console.log("Create Station button clicked");
    const createStationModal = new bootstrap.Modal(document.getElementById('createStationModal'));
    createStationModal.show();
  });

  document.getElementById('generate-new-key').addEventListener('click', () => {
    stationKey = crypto.randomBytes(32);
    document.getElementById('existing-key').value = b4a.toString(stationKey, 'hex');
    console.log("New station key generated");
  });

  document.getElementById('create-station-button').addEventListener('click', () => {
    const existingKey = document.getElementById('existing-key').value.trim();
    stationKey = existingKey ? b4a.from(existingKey, 'hex') : stationKey;

    console.log("Creating station with key:", b4a.toString(stationKey, 'hex'));
    setupStation(stationKey);

    const createStationModal = bootstrap.Modal.getInstance(document.getElementById('createStationModal'));
    createStationModal.hide();
  });

  document.getElementById('leave-stream').addEventListener('click', () => {
    console.log("Leave Stream button clicked");
    leaveStation();
  });

  document.getElementById('join-station-button').addEventListener('click', () => {
    console.log("Join Station button clicked");
    joinStation();
    const joinModal = bootstrap.Modal.getInstance(document.getElementById('joinModal'));
    joinModal.hide();
  });

  document.getElementById('apply-audio-source').addEventListener('click', applyAudioSource);

  populateAudioInputSources();
});

async function populateAudioInputSources() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputSelect = document.getElementById('audio-input-select');
    audioInputSelect.innerHTML = '';
    devices.forEach((device) => {
      if (device.kind === 'audioinput') {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${audioInputSelect.length + 1}`;
        audioInputSelect.appendChild(option);
      }
    });
    currentDeviceId = audioInputSelect.value;
    console.log("Audio input devices populated");
  } catch (err) {
    console.error("Error enumerating devices:", err);
  }
}

async function applyAudioSource() {
  const selectedDeviceId = document.getElementById('audio-input-select').value;
  if (selectedDeviceId !== currentDeviceId) {
    currentDeviceId = selectedDeviceId;
    if (isBroadcasting) {
      console.log("Applying new audio source:", selectedDeviceId);
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined },
        });
        console.log("New audio stream obtained");

        // Replace tracks in existing peer connections
        for (const remoteKey in peerConnections) {
          const peerConnection = peerConnections[remoteKey];
          const senders = peerConnection.getSenders();
          for (const sender of senders) {
            if (sender.track && sender.track.kind === 'audio') {
              const newTrack = newStream.getAudioTracks()[0];
              await sender.replaceTrack(newTrack);
              console.log(`Replaced audio track for peer ${remoteKey}`);
            }
          }
        }

        // Stop the old audio tracks
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
          console.log("Old audio tracks stopped");
        }

        // Update the localStream
        localStream = newStream;
        console.log("localStream updated with new audio stream");
      } catch (err) {
        console.error("Error applying new audio source:", err);
        alert("Failed to apply new audio source. Please try again.");
      }
    }
  }
}

function updatePeerCount() {
  const peerCount = conns.length;
  const stationInfoElement = document.getElementById('station-info');
  if (isBroadcasting) {
    stationInfoElement.textContent = `Station ID: ${b4a.toString(stationKey, 'hex')}\nConnected Peers: ${peerCount}`;
  } else {
    stationInfoElement.textContent = `Connected Peers: ${peerCount}`;
  }
  console.log(`Peer count updated: ${peerCount}`);
}

async function setupStation(key) {
  try {
    console.log("Setting up station...");
    // Initialize Hyperswarm
    swarm = new Hyperswarm();
    swarm.join(key, { client: false, server: true });

    // Get user media (audio input)
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined },
    });
    console.log("Local audio stream obtained");

    isBroadcasting = true;

    swarm.on('connection', (conn) => {
      console.log("New connection established");
      conns.push(conn);
      updatePeerCount(); // Update peer count when a new connection is established

      const remoteKey = conn.remotePublicKey.toString('hex');

      // Use the Hyperswarm connection as a data channel for signaling
      dataChannels[remoteKey] = conn;

      // Set up WebRTC peer connection
      setupBroadcasterPeerConnection(conn, remoteKey);

      conn.on('close', () => {
        console.log("Connection closed with peer");
        if (peerConnections[remoteKey]) {
          peerConnections[remoteKey].close();
          delete peerConnections[remoteKey];
        }
        delete dataChannels[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count when a connection is closed
      });

      conn.on('error', (err) => {
        console.error("Connection error with peer:", err);
        if (peerConnections[remoteKey]) {
          peerConnections[remoteKey].close();
          delete peerConnections[remoteKey];
        }
        delete dataChannels[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count on error
      });
    });

    document.getElementById('broadcaster-controls').classList.remove('d-none');
    document.getElementById('setup').classList.add('d-none');
    document.getElementById('controls').classList.remove('d-none');
    document.getElementById('station-info').textContent = `Station ID: ${b4a.toString(key, 'hex')}`;

    console.log("Station setup complete");
  } catch (err) {
    console.error("Error setting up station:", err);
    alert("Failed to set up station. Please try again.");
  }
}

function setupBroadcasterPeerConnection(conn, remoteKey) {
  const configuration = {
    iceServers: [], // Empty array since we are not using external STUN/TURN servers
  };
  const peerConnection = new RTCPeerConnection(configuration);
  peerConnections[remoteKey] = peerConnection;

  // Add local stream tracks to peer connection
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
    console.log("Added track to peer connection:", track);
  });

  // Handle ICE candidates
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      console.log("Sending ICE candidate to peer");
      conn.write(JSON.stringify({ type: 'candidate', candidate }));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("Broadcaster ICE connection state changed to:", peerConnection.iceConnectionState);
  };

  // Handle incoming signaling data
  conn.on('data', async (data) => {
    const message = JSON.parse(data.toString());
    await handleBroadcasterSignalingData(conn, message, remoteKey);
  });
}

async function handleBroadcasterSignalingData(conn, message, remoteKey) {
  const peerConnection = peerConnections[remoteKey];
  if (message.type === 'offer') {
    console.log("Received offer from peer");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
    console.log("Set remote description with offer from peer");

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log("Created and set local description with answer");

    // Send the answer back to the listener
    conn.write(JSON.stringify({ type: 'answer', answer }));
    console.log("Sent answer to peer");
  } else if (message.type === 'candidate') {
    console.log("Received ICE candidate from peer");
    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
  }
}

async function joinStation() {
  try {
    const stationId = document.getElementById('station-id').value;
    if (!stationId) {
      alert("Please enter a station ID.");
      return;
    }

    console.log("Joining station with ID:", stationId);
    const topicBuffer = b4a.from(stationId, 'hex');
    swarm = new Hyperswarm();
    swarm.join(topicBuffer, { client: true, server: false });

    swarm.on('connection', (conn) => {
      console.log("Connected to broadcaster");
      conns.push(conn);
      updatePeerCount(); // Update peer count when a new connection is established

      const remoteKey = conn.remotePublicKey.toString('hex');

      // Use the Hyperswarm connection as a data channel for signaling
      dataChannels[remoteKey] = conn;

      // Set up WebRTC peer connection
      setupListenerPeerConnection(conn, remoteKey);

      conn.on('close', () => {
        console.log("Connection closed with broadcaster");
        if (peerConnections[remoteKey]) {
          peerConnections[remoteKey].close();
          delete peerConnections[remoteKey];
        }
        delete dataChannels[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count when a connection is closed
      });

      conn.on('error', (err) => {
        console.error("Connection error with broadcaster:", err);
        if (peerConnections[remoteKey]) {
          peerConnections[remoteKey].close();
          delete peerConnections[remoteKey];
        }
        delete dataChannels[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count on error
      });

      updatePeerCount();
    });

    document.getElementById('station-info').textContent = `Connected to Station: ${stationId}`;
    document.getElementById('setup').classList.add('d-none');
    document.getElementById('controls').classList.remove('d-none');
    document.getElementById('listener-controls').classList.remove('d-none');

    console.log("Joined station successfully");
  } catch (err) {
    console.error("Error joining station:", err);
    alert("Failed to join station. Please try again.");
  }
}

function setupListenerPeerConnection(conn, remoteKey) {
  const configuration = {
    iceServers: [], // Empty array since we are not using external STUN/TURN servers
  };
  const peerConnection = new RTCPeerConnection(configuration);
  peerConnections[remoteKey] = peerConnection;

  // Handle incoming tracks (audio streams)
  peerConnection.ontrack = (event) => {
    console.log("Received remote track");
    const [remoteStream] = event.streams;
    // Play the remote audio stream
    const audioElement = document.createElement('audio');
    audioElement.srcObject = remoteStream;
    audioElement.autoplay = true;
    document.body.appendChild(audioElement);
    console.log("Audio element created and playback started");
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      console.log("Sending ICE candidate to broadcaster");
      conn.write(JSON.stringify({ type: 'candidate', candidate }));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("Listener ICE connection state changed to:", peerConnection.iceConnectionState);
  };

  // Handle signaling data from broadcaster
  conn.on('data', async (data) => {
    const message = JSON.parse(data.toString());
    await handleListenerSignalingData(conn, message, remoteKey);
  });

  initiateOffer(conn, peerConnection);
}

async function handleListenerSignalingData(conn, message, remoteKey) {
  const peerConnection = peerConnections[remoteKey];
  if (message.type === 'answer') {
    console.log("Received answer from broadcaster");
    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
    console.log("Set remote description with answer from broadcaster");
  } else if (message.type === 'candidate') {
    console.log("Received ICE candidate from broadcaster");
    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
  }
}

async function initiateOffer(conn, peerConnection) {
  try {
    console.log("Initiating offer to broadcaster");

    // Add transceiver to receive audio
    peerConnection.addTransceiver('audio', { direction: 'recvonly' });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("Created and set local description with offer");

    // Send offer to broadcaster
    conn.write(JSON.stringify({ type: 'offer', offer }));
    console.log("Sent offer to broadcaster");
  } catch (err) {
    console.error("Error initiating offer:", err);
  }
}

function leaveStation() {
  console.log("Leaving station...");
  if (swarm) {
    swarm.destroy();
    console.log("Swarm destroyed");
  }

  // Close all peer connections
  Object.values(peerConnections).forEach((pc) => pc.close());
  peerConnections = {};

  // Close all Hyperswarm connections
  conns.forEach((conn) => conn.destroy());
  conns = [];

  // Stop local media tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    console.log("Local media tracks stopped");
  }

  isBroadcasting = false;

  document.getElementById('setup').classList.remove('d-none');
  document.getElementById('controls').classList.add('d-none');
  document.getElementById('broadcaster-controls').classList.add('d-none');
  document.getElementById('listener-controls').classList.add('d-none');
  document.getElementById('station-info').textContent = '';

  console.log("Left the station.");
}
