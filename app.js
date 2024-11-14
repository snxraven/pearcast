import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

let swarm;
let micStream;
let audioContext;
let isBroadcasting = false;
let conns = [];
let currentDeviceId = null; // To store the selected audio device ID
let accumulatedBuffer = b4a.alloc(0); // Buffer for accumulating received audio data
let stationKey = crypto.randomBytes(32); // Default random key for the station

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById('create-station').addEventListener('click', () => {
    // Show the Create Station modal when clicking "Create Station" button
    const createStationModal = new bootstrap.Modal(document.getElementById('createStationModal'));
    createStationModal.show();
  });

  document.getElementById('generate-new-key').addEventListener('click', () => {
    // Generate a new station key automatically
    stationKey = crypto.randomBytes(32);
    document.getElementById('existing-key').value = b4a.toString(stationKey, 'hex'); // Display the new key in the text box
  });

  document.getElementById('create-station-button').addEventListener('click', () => {
    // Check if the user provided an existing key or use the generated one
    const existingKey = document.getElementById('existing-key').value.trim();
    stationKey = existingKey ? b4a.from(existingKey, 'hex') : stationKey;

    // Set up the station with the chosen key
    setupStation(stationKey);
    
    // Hide the modal after setting up the station
    const createStationModal = bootstrap.Modal.getInstance(document.getElementById('createStationModal'));
    createStationModal.hide();
  });

  document.getElementById('leave-stream').addEventListener('click', () => {
    stopBroadcast();
    leaveStation();
  });

  document.getElementById('join-station-button').addEventListener('click', joinStation);
  document.getElementById('apply-audio-source').addEventListener('click', applyAudioSource);

  // Populate the audio input source dropdown for the broadcaster
  populateAudioInputSources();
});

// Function to populate audio input sources
async function populateAudioInputSources() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputSelect = document.getElementById('audio-input-select');
    audioInputSelect.innerHTML = ''; // Clear existing options
    devices.forEach((device) => {
      if (device.kind === 'audioinput') {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${audioInputSelect.length + 1}`;
        audioInputSelect.appendChild(option);
      }
    });
    // Set default device ID to the first option
    currentDeviceId = audioInputSelect.value;
  } catch (err) {
    console.error("Error enumerating devices:", err);
  }
}

// Function to apply selected audio source
async function applyAudioSource() {
  const selectedDeviceId = document.getElementById('audio-input-select').value;
  if (selectedDeviceId !== currentDeviceId) {
    currentDeviceId = selectedDeviceId;
    stopBroadcast();  // Stop current stream
    startBroadcast(); // Restart stream with new device
  }
}

// Function to start broadcasting from the microphone
async function startBroadcast() {
  if (isBroadcasting) stopBroadcast(); // Stop any existing broadcast

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

      // Send audio data to all connections
      for (const conn of conns) {
        conn.write(buffer);
      }
    };

    isBroadcasting = true;
    console.log("Broadcasting started.");
  } catch (err) {
    console.error("Error accessing microphone:", err);
  }
}

// Function to stop broadcasting and clean up resources
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
  accumulatedBuffer = b4a.alloc(0); // Reset accumulated buffer
  isBroadcasting = false;
  console.log("Broadcasting stopped.");
}

// Broadcast a stop signal to all peers
function broadcastStopSignal() {
  for (const conn of conns) {
    conn.write(Buffer.alloc(0)); // Send an empty buffer as a stop signal
  }
}

// Function to create a broadcasting station
async function setupStation(key) {
  swarm = new Hyperswarm();
  swarm.join(key, { client: false, server: true });
  
  // Show broadcaster controls
  document.getElementById('broadcaster-controls').classList.remove('d-none');

  // Update UI
  document.getElementById('station-info').textContent = `Station ID: ${b4a.toString(key, 'hex')}`;
  document.getElementById('setup').classList.add('d-none');
  document.getElementById('controls').classList.remove('d-none');

  // Start broadcasting as soon as the station is created
  startBroadcast();

  // Listen for incoming connections
  swarm.on('connection', (conn) => {
    conns.push(conn);
    conn.once('close', () => {
      conns.splice(conns.indexOf(conn), 1);
      console.log("Peer disconnected.");
    });
    conn.on('data', handleData);

    // Add error handler to log disconnects and suppress crashes
    conn.on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        console.log("Peer connection reset by remote peer.");
      } else {
        console.error("Connection error:", err);
      }
    });
  });
}

// Function to leave the station and stop broadcasting
function leaveStation() {
  if (swarm) swarm.destroy();
  document.getElementById('setup').classList.remove('d-none');
  document.getElementById('controls').classList.add('d-none');
  
  // Hide broadcaster controls
  document.getElementById('broadcaster-controls').classList.add('d-none');
  
  stopBroadcast();
  console.log("Left the station.");
}

// Function to handle incoming data from peers
function handleData(data) {
  if (data.length === 0) {
    console.log("Received stop command from peer");
    stopBroadcast();
  } else {
    processIncomingAudioData(data);
  }
}

// Function to process and play incoming audio data
function processIncomingAudioData(data) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  accumulatedBuffer = b4a.concat([accumulatedBuffer, data]);

  while (accumulatedBuffer.byteLength >= 4) {
    const chunkSize = accumulatedBuffer.byteLength;
    const audioData = new Float32Array(accumulatedBuffer.slice(0, chunkSize).buffer);
    accumulatedBuffer = accumulatedBuffer.slice(chunkSize);

    const buffer = audioContext.createBuffer(1, audioData.length, audioContext.sampleRate);
    buffer.copyToChannel(audioData, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  }
}

// Function to join an existing station
async function joinStation() {
  const stationId = document.getElementById('station-id').value;
  if (!stationId) {
    alert("Please enter a station ID.");
    return;
  }

  // Convert the station ID to a topic buffer
  const topicBuffer = b4a.from(stationId, 'hex');
  swarm = new Hyperswarm();
  swarm.join(topicBuffer, { client: true, server: false });

  document.getElementById('station-info').textContent = `Connected to Station: ${stationId}`;
  document.getElementById('setup').classList.add('d-none');
  document.getElementById('controls').classList.remove('d-none');

  // Hide broadcaster controls for listener
  document.getElementById('broadcaster-controls').classList.add('d-none');

  swarm.on('connection', (conn) => {
    conn.on('data', (data) => {
      processIncomingAudioData(data);
    });
    
    // Add error handler for listener connections
    conn.on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        console.log("Peer connection reset by remote peer.");
      } else {
        console.error("Connection error:", err);
      }
    });
  });

  // Hide the modal after joining
  const joinModal = document.getElementById('joinModal');
  const modalInstance = bootstrap.Modal.getInstance(joinModal);
  if (modalInstance) {
    modalInstance.hide();
  }
}
