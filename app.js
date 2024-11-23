import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

let swarm;
let micStream;
let audioContext;
let isBroadcasting = false;
let conns = [];
let currentDeviceId = null; // To store the selected audio input device ID
let accumulatedBuffer = b4a.alloc(0); // Buffer for accumulating received audio data
let stationKey = crypto.randomBytes(32); // Default random key for the station

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById('create-station').addEventListener('click', () => {
    const createStationModal = new bootstrap.Modal(document.getElementById('createStationModal'));
    createStationModal.show();
  });

  document.getElementById('generate-new-key').addEventListener('click', () => {
    stationKey = crypto.randomBytes(32);
    document.getElementById('existing-key').value = b4a.toString(stationKey, 'hex');
  });

  document.getElementById('create-station-button').addEventListener('click', () => {
    const existingKey = document.getElementById('existing-key').value.trim();
    stationKey = existingKey ? b4a.from(existingKey, 'hex') : stationKey;

    setupStation(stationKey);

    const createStationModal = bootstrap.Modal.getInstance(document.getElementById('createStationModal'));
    createStationModal.hide();
  });

  document.getElementById('leave-stream').addEventListener('click', () => {
    stopBroadcast();
    leaveStation();
  });

  document.getElementById('join-station-button').addEventListener('click', joinStation);
  document.getElementById('apply-audio-source').addEventListener('click', applyAudioSource);
  // document.getElementById('apply-output-device').addEventListener('click', applyOutputDevice);

  populateAudioInputSources();
  populateAudioOutputSources();
});

// Update peer count in the UI
function updatePeerCount() {
  const peerCount = conns.length;
  const stationInfoElement = document.getElementById('station-info');
  if (isBroadcasting) {
    stationInfoElement.textContent = `Station ID: ${b4a.toString(stationKey, 'hex')}\nConnected Peers: ${peerCount}`;
  } else {
    stationInfoElement.textContent = `Station ID: ${b4a.toString(stationKey, 'hex')}\nConnected Peers: ${peerCount}`;
  }
  console.log(`Peer count updated: ${peerCount}`);
}

// Populate audio input sources
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
  } catch (err) {
    console.error("Error enumerating devices:", err);
  }
}

// Populate audio output sources
async function populateAudioOutputSources() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputSelect = document.getElementById('audio-output-select');
    audioOutputSelect.innerHTML = '';
    devices.forEach((device) => {
      if (device.kind === 'audiooutput') {
        // const option = document.createElement('option');
        // option.value = device.deviceId;
        // option.textContent = device.label || `Speaker ${audioOutputSelect.length + 1}`;
        // audioOutputSelect.appendChild(option);
      }
    });
  } catch (err) {
    console.error("Error enumerating output devices:", err);
  }
}

// Apply the selected audio output device
// Apply the selected audio output device
async function applyOutputDevice() {
  const selectedDeviceId = document.getElementById('audio-output-select').value;
  try {
    if (!selectedDeviceId) {
      console.warn("No output device selected.");
      return;
    }

    // Ensure there is a valid audio element
    const audioElement = document.createElement('audio');
    audioElement.autoplay = true; // Play automatically when data is received
    audioElement.controls = true; // Debugging purposes (can be removed)
    document.body.appendChild(audioElement); // Add temporarily for testing

    // Set the audio sink to the selected device
    if (typeof audioElement.setSinkId === 'function') {
      await audioElement.setSinkId(selectedDeviceId);
      console.log(`Audio output device applied: ${selectedDeviceId}`);
    } else {
      console.error("setSinkId is not supported in this browser.");
    }
  } catch (err) {
    console.error("Error applying audio output device:", err);
  }
}

// Apply the selected audio input source
async function applyAudioSource() {
  const selectedDeviceId = document.getElementById('audio-input-select').value;
  if (selectedDeviceId !== currentDeviceId) {
    currentDeviceId = selectedDeviceId;
    stopBroadcast();
    startBroadcast();
  }
}

// Start broadcasting from the microphone
async function startBroadcast() {
  if (isBroadcasting) stopBroadcast();

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined },
    });
    const source = audioContext.createMediaStreamSource(micStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (event) => {
      const audioData = event.inputBuffer.getChannelData(0);
      const buffer = b4a.from(new Float32Array(audioData).buffer);
      for (const conn of conns) {
        conn.write(buffer);
      }
    };

    isBroadcasting = true;
    console.log("Broadcasting started.");
  } catch (err) {
    console.error("Error starting broadcast:", err);
  }
}

// Stop broadcasting
function stopBroadcast() {
  if (!isBroadcasting) return;

  broadcastStopSignal();
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  accumulatedBuffer = b4a.alloc(0);
  isBroadcasting = false;
  console.log("Broadcasting stopped.");
}

// Broadcast a stop signal to all peers
function broadcastStopSignal() {
  for (const conn of conns) {
    conn.write(Buffer.alloc(0));
  }
}

function processIncomingAudioData(data) {
  // Ensure audioContext is initialized
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log("AudioContext initialized.");
  }

  // Accumulate incoming data
  accumulatedBuffer = b4a.concat([accumulatedBuffer, data]);

  // Debug log for accumulated buffer size
  console.log("Accumulated buffer size:", accumulatedBuffer.byteLength);

  // Process audio data in chunks
  while (accumulatedBuffer.byteLength >= 4096) {
    try {
      const chunkSize = 4096; // Process fixed-size chunks
      const audioData = new Float32Array(accumulatedBuffer.slice(0, chunkSize).buffer);
      accumulatedBuffer = accumulatedBuffer.slice(chunkSize); // Remove processed data

      const sampleRate = audioContext.sampleRate || 44100; // Use context sample rate or default
      const buffer = audioContext.createBuffer(1, audioData.length, sampleRate);

      // Copy data to the audio buffer
      buffer.copyToChannel(audioData, 0);

      // Create and configure audio buffer source
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();

      // Debug log for processed audio chunk
      console.log("Audio chunk processed and played. Chunk size:", chunkSize);
    } catch (err) {
      console.error("Error processing audio data:", err);
      break; // Stop processing on error to prevent cascading issues
    }
  }
}

// Setup a broadcasting station
async function setupStation(key) {
  swarm = new Hyperswarm();
  swarm.join(key, { client: false, server: true });

  document.getElementById('broadcaster-controls').classList.remove('d-none');
  document.getElementById('setup').classList.add('d-none');
  document.getElementById('controls').classList.remove('d-none');

  startBroadcast();
  updatePeerCount();

  swarm.on('connection', (conn) => {
    conns.push(conn);
    console.log("Peer connected. Total peers:", conns.length);
    updatePeerCount();

    conn.once('close', () => {
      conns.splice(conns.indexOf(conn), 1);
      console.log("Peer disconnected. Total peers:", conns.length);
      updatePeerCount();
    });

    conn.on('data', handleData);

    conn.on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        console.log("Peer connection reset by remote peer.");
      } else {
        console.error("Connection error:", err);
      }
      conns.splice(conns.indexOf(conn), 1);
      updatePeerCount();
    });
  });
}

// Leave the station
function leaveStation() {
  if (swarm) swarm.destroy();
  document.getElementById('setup').classList.remove('d-none');
  document.getElementById('controls').classList.add('d-none');
  document.getElementById('broadcaster-controls').classList.add('d-none');
  stopBroadcast();
  console.log("Left the station.");
}

// Handle incoming data from peers
function handleData(data) {
  if (data.length === 0) {
    stopBroadcast();
  } else {
    processIncomingAudioData(data);
  }
}

// Join an existing station
async function joinStation() {
  const stationId = document.getElementById('station-id').value;
  if (!stationId) {
    alert("Please enter a station ID.");
    return;
  }

  const topicBuffer = b4a.from(stationId, 'hex');
  swarm = new Hyperswarm();
  swarm.join(topicBuffer, { client: true, server: false });

  document.getElementById('station-info').textContent = `Connected to Station: ${stationId}`;
  document.getElementById('setup').classList.add('d-none');
  document.getElementById('controls').classList.remove('d-none');
  document.getElementById('broadcaster-controls').classList.add('d-none');
 // document.getElementById('listener-controls').classList.remove('d-none'); // Ensure listener controls are visible

  // Populate audio output devices
  await populateAudioOutputSources();

  swarm.on('connection', (conn) => {
    conns.push(conn);
    console.log("Peer connected. Total peers:", conns.length);
    updatePeerCount();

    conn.on('data', (data) => processIncomingAudioData(data));

    conn.once('close', () => {
      conns.splice(conns.indexOf(conn), 1);
      console.log("Peer disconnected. Total peers:", conns.length);
      updatePeerCount();
    });

    conn.on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        console.log("Peer connection reset by remote peer.");
      } else {
        console.error("Connection error:", err);
      }
      conns.splice(conns.indexOf(conn), 1);
      updatePeerCount();
    });
  });

  const joinModal = bootstrap.Modal.getInstance(document.getElementById('joinModal'));
  if (joinModal) joinModal.hide();

  updatePeerCount();
}

