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
let iceCandidateQueues = {}; // Store ICE candidate queues
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

// Updated applyAudioSource function
async function applyAudioSource() {
  const selectedDeviceId = document.getElementById('audio-input-select').value;
  if (selectedDeviceId !== currentDeviceId) {
    currentDeviceId = selectedDeviceId;
    if (isBroadcasting) {
      console.log("Applying new audio source:", selectedDeviceId);
      try {
        // Get the new audio stream
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

// Update peer count using conns.length
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
      console.log("Remote key:", remoteKey);

      // Initialize ICE candidate queue
      iceCandidateQueues[remoteKey] = [];

      // Handle incoming signaling data
      conn.on('data', async (data) => {
        console.log("Received data from peer:", data.toString());
        const message = JSON.parse(data.toString());
        await handleSignalingData(conn, message);
      });

      conn.on('close', () => {
        console.log("Connection closed with peer:", remoteKey);
        // Clean up peer connection when connection closes
        if (peerConnections[remoteKey]) {
          peerConnections[remoteKey].close();
          delete peerConnections[remoteKey];
        }
        delete iceCandidateQueues[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count when a connection is closed
      });

      conn.on('error', (err) => {
        console.error("Connection error with peer:", remoteKey, err);
        if (peerConnections[remoteKey]) {
          peerConnections[remoteKey].close();
          delete peerConnections[remoteKey];
        }
        delete iceCandidateQueues[remoteKey];
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

function stopBroadcast() {
  console.log("Broadcast stopped");
  // Close all peer connections
  Object.values(peerConnections).forEach((pc) => pc.close());
  peerConnections = {};

  // Stop local media tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    console.log("Local media tracks stopped");
  }

  isBroadcasting = false;
}

async function handleSignalingData(conn, message, peerConnection = null) {
  try {
    const remoteKey = conn.remotePublicKey.toString('hex');
    console.log("Handling signaling data:", message.type, "from", remoteKey);

    if (!peerConnection) {
      peerConnection = peerConnections[remoteKey];
    }

    if (message.type === 'offer') {
      // Received an offer from a listener (only for broadcaster)
      console.log("Creating new RTCPeerConnection for remote key:", remoteKey);
      const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      };
      peerConnection = new RTCPeerConnection(configuration);
      peerConnections[remoteKey] = peerConnection;

      // Add local stream tracks to peer connection
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
        console.log("Added track to peer connection:", track);
      });

      // Handle ICE candidates
      peerConnection.onicecandidate = ({ candidate }) => {
        if (candidate) {
          console.log("Sending ICE candidate to peer:", candidate);
          conn.write(JSON.stringify({ type: 'candidate', candidate }));
        } else {
          console.log("All ICE candidates have been sent to peer");
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log("Broadcaster ICE connection state changed to:", peerConnection.iceConnectionState);
      };

      // Set remote description
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
      console.log("Set remote description with offer from peer");

      // Process any queued ICE candidates
      if (iceCandidateQueues[remoteKey]) {
        console.log("Processing queued ICE candidates");
        for (const candidate of iceCandidateQueues[remoteKey]) {
          await peerConnection.addIceCandidate(candidate);
          console.log("Added queued ICE candidate");
        }
        iceCandidateQueues[remoteKey] = [];
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log("Created and set local description with answer");

      // Send the answer back to the listener
      conn.write(JSON.stringify({ type: 'answer', answer }));
      console.log("Sent answer to peer");

    } else if (message.type === 'candidate') {
      // Received an ICE candidate
      const candidate = new RTCIceCandidate(message.candidate);
      console.log("Received ICE candidate from peer:", candidate);

      if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        await peerConnection.addIceCandidate(candidate);
        console.log("Added ICE candidate to peer connection");
      } else {
        console.log("Remote description not set yet, queuing ICE candidate");
        if (!iceCandidateQueues[remoteKey]) {
          iceCandidateQueues[remoteKey] = [];
        }
        iceCandidateQueues[remoteKey].push(candidate);
      }

    } else if (message.type === 'answer') {
      // Received an answer from the broadcaster (only for listener)
      console.log("Received answer from broadcaster");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
      console.log("Set remote description with answer from broadcaster");

      // Process any queued ICE candidates
      if (iceCandidateQueues[remoteKey]) {
        console.log("Processing queued ICE candidates");
        for (const candidate of iceCandidateQueues[remoteKey]) {
          await peerConnection.addIceCandidate(candidate);
          console.log("Added queued ICE candidate");
        }
        iceCandidateQueues[remoteKey] = [];
      }
    }
  } catch (err) {
    console.error("Error handling signaling data:", err);
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
      console.log("Remote key:", remoteKey);

      // Initialize ICE candidate queue
      iceCandidateQueues[remoteKey] = [];

      const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      };
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnections[remoteKey] = peerConnection;

      // Add transceiver to receive audio
      peerConnection.addTransceiver('audio', { direction: 'recvonly' });

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
          console.log("Sending ICE candidate to broadcaster:", candidate);
          conn.write(JSON.stringify({ type: 'candidate', candidate }));
        } else {
          console.log("All ICE candidates have been sent to broadcaster");
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log("Listener ICE connection state changed to:", peerConnection.iceConnectionState);
      };

      // Handle signaling data from broadcaster
      conn.on('data', async (data) => {
        console.log("Received data from broadcaster:", data.toString());
        const message = JSON.parse(data.toString());
        await handleSignalingData(conn, message, peerConnection);
      });

      conn.on('close', () => {
        console.log("Connection closed with broadcaster");
        peerConnection.close();
        delete peerConnections[remoteKey];
        delete iceCandidateQueues[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count when a connection is closed
      });

      conn.on('error', (err) => {
        console.error("Connection error with broadcaster:", err);
        peerConnection.close();
        delete peerConnections[remoteKey];
        delete iceCandidateQueues[remoteKey];
        conns.splice(conns.indexOf(conn), 1);
        updatePeerCount(); // Update peer count on error
      });

      // Start signaling process
      initiateOffer(conn, peerConnection, remoteKey);

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

async function initiateOffer(conn, peerConnection, remoteKey) {
  try {
    console.log("Initiating offer to broadcaster");

    // Handle ICE candidates
    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("Sending ICE candidate to broadcaster:", candidate);
        conn.write(JSON.stringify({ type: 'candidate', candidate }));
      } else {
        console.log("All ICE candidates have been sent to broadcaster");
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log("Listener ICE connection state changed to:", peerConnection.iceConnectionState);
    };

    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("Created and set local description with offer");

    // Send offer to broadcaster
    conn.write(JSON.stringify({ type: 'offer', offer }));
    console.log("Sent offer to broadcaster");

    // Process any queued ICE candidates
    if (iceCandidateQueues[remoteKey]) {
      console.log("Processing queued ICE candidates");
      for (const candidate of iceCandidateQueues[remoteKey]) {
        await peerConnection.addIceCandidate(candidate);
        console.log("Added queued ICE candidate");
      }
      iceCandidateQueues[remoteKey] = [];
    }
  } catch (err) {
    console.error("Error initiating offer:", err);
  }
}
