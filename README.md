# pearCast - A Peer-to-Peer Audio Broadcasting App

`pearCast` is a decentralized, peer-to-peer (P2P) audio broadcasting application that enables users to broadcast and listen to live audio streams directly from their web browser without relying on centralized servers. Using Hyperswarm for P2P networking and the Web Audio API for audio capture and playback, `pearCast` allows users to create and join audio broadcast stations effortlessly.

Run the app on pear!

pear run pear://q3rutpfbtdsr7ikdpntpojcxy5u356qfczzgqomxqk3jdxn6ao8y

## Key Features

- **Create or Join a Station**: Host a broadcast or tune into an existing one.
- **Microphone Selection**: Broadcasters can select and switch between available audio input devices.
- **Real-time Audio Streaming**: Capture and stream live audio to all connected listeners.
- **Decentralized Networking**: Peer-to-peer connections using Hyperswarm, eliminating the need for a centralized server.
- **Error Handling**: Logs peer disconnections and connection resets without crashing.

## Technologies Used

- **[Hyperswarm](https://github.com/hyperswarm/hyperswarm)**: For discovering and connecting peers based on a shared "topic" key, ensuring direct connections without the need for central servers.
- **Web Audio API**: A powerful API for capturing and processing live audio in the browser, allowing real-time audio streaming.
- **Bootstrap**: For responsive and user-friendly UI elements.
- **JavaScript & Node.js**: Application logic, error handling, and P2P networking.
- **Pear CLI**: (Optional) If you want to run this as a P2P desktop app using [Pear CLI](https://github.com/pearjs/pear).

---

## Table of Contents

- [Getting Started](#getting-started)
- [User Guide](#user-guide)
  - [Creating a Broadcast Station](#creating-a-broadcast-station)
  - [Joining a Broadcast Station](#joining-a-broadcast-station)
  - [Changing Audio Input](#changing-audio-input)
- [Technical Details](#technical-details)
  - [How P2P Connections are Handled](#how-p2p-connections-are-handled)
  - [Audio Capture and Streaming](#audio-capture-and-streaming)
  - [Error Handling and Disconnection Logging](#error-handling-and-disconnection-logging)
- [Code Structure](#code-structure)
- [Example Screenshots](#example-screenshots)
- [Troubleshooting](#troubleshooting)
---

## Getting Started

### Prerequisites

- **Node.js**: Required to install dependencies and run the app.
- **Pear CLI**: (Optional) Use the [Pear CLI](https://github.com/pearjs/pear) if working with a P2P or desktop runtime.

### Installation

1. **Clone the Repository**:
   ```bash
   git clone https://git.ssh.surf/snxraven/pearCast.git
   cd pearCast
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run the App**:
   ```bash
   pear run --dev .
   ```

> Note: If you’re not using the Pear CLI, you can serve `index.html` through a local web server (e.g., using `Live Server` extension in VSCode or a simple HTTP server).

---

## User Guide

### Creating a Broadcast Station

1. **Click "Create Station"**: Initiates a new station and begins capturing audio from the microphone.
2. **View Station ID**: Once created, the station will display a unique ID (based on a cryptographic key), which can be shared with others to join.
3. **Audio Input Selection**: Choose the desired microphone input from a dropdown menu, then click "Apply" to switch.
4. **Leaving the Broadcast**: Click "Leave Broadcast" to end the session, which will also disconnect all connected peers.

### Joining a Broadcast Station

1. **Click "Join Station"**: Opens a modal window.
2. **Enter Station ID**: Input the ID shared by the broadcaster and click "Join" to connect.
3. **Listen to Broadcast**: Audio from the broadcast will begin streaming in real-time.
4. **Leaving the Broadcast**: The listener can leave the broadcast by closing the connection in the browser or stopping playback.

### Changing Audio Input

**For Broadcasters Only**: Broadcasters can change their microphone input while streaming. Simply select a different device in the "Audio Input Source" dropdown and click "Apply" to switch. The broadcast will automatically start using the newly selected device.

## Technical Details

### How P2P Connections are Handled

The core networking functionality uses **Hyperswarm**. Each station (both broadcaster and listener) connects to a unique "topic" based on a cryptographic key. Hyperswarm manages discovery and connection setup without central servers by joining a Distributed Hash Table (DHT). Key components include:

1. **Generating a Station ID**: When a station is created, `crypto.randomBytes(32)` generates a 32-byte cryptographic key that uniquely identifies the broadcast. Hyperswarm joins this topic in "server mode" for the broadcaster and "client mode" for listeners.
   
2. **Peer Connections**: Both broadcaster and listener connections are managed by Hyperswarm's `swarm.on('connection')` event, which initiates a stream for sending or receiving audio data.

3. **Handling Disconnects**: Each connection includes error handling and disconnect logging. A connection reset (ECONNRESET) or manual disconnect is logged without crashing the app.

### Audio Capture and Streaming

Using the **Web Audio API**, `pearCast` captures and processes audio from the microphone and streams it to connected peers.

1. **Audio Context Setup**: When a station is created, an `AudioContext` is initialized. This manages audio data flow, including selecting the appropriate microphone input.

2. **Real-time Audio Processing**: Audio is captured as raw data in `Float32Array` format, then buffered and streamed in chunks. The broadcaster's `processor.onaudioprocess` event transmits audio data to all connected peers.

3. **Playback for Listeners**: When a listener receives audio data, it’s buffered and played via an `AudioBufferSourceNode` connected to the `AudioContext`, enabling real-time audio streaming without delays.

### Error Handling and Disconnection Logging

- **Graceful Peer Disconnects**: Each connection uses an `on('error')` handler that logs disconnect events, preventing crashes from unexpected disconnects (e.g., `ECONNRESET`).
- **Empty Buffer Signal**: To notify listeners that a broadcast has ended, the broadcaster sends an empty buffer to all connected peers before stopping the stream. Listeners handle this signal by stopping playback.


## Code Structure

### HTML (index.html)

`index.html` contains the core layout and UI components:

- **Station Controls**: Create or join a station and leave the broadcast.
- **Audio Input Selection**: Available to broadcasters only, allowing them to change input sources.
- **Bootstrap Modal**: Provides a user-friendly modal interface for joining a station with a specific ID.

### JavaScript (app.js)

`app.js` contains the main application logic:

- **Station Management**: Functions to create or join stations, handle connections, and manage disconnects.
- **Audio Capture & Processing**: Configures audio context, captures microphone data, and processes audio buffers.
- **Error Handling**: Includes connection reset handling and graceful disconnect logging.
- **Audio Source Selection**: Enables broadcasters to choose from available audio input devices.

---

## Example Screenshots

| Feature                | Screenshot                                 |
|------------------------|--------------------------------------------|
| **Create Station**     | ![Create Station](./screenshots/create.png)|
| **Join Station Modal** | ![Join Station](./screenshots/join.png)    |
| **Audio Input Control**| ![Audio Input](./screenshots/input.png)    |

---

## Troubleshooting

1. **Connection Reset Errors**:
   - If you encounter `ECONNRESET` errors, they are logged as peer disconnections. Check if a peer has disconnected unexpectedly.

2. **No Audio Device Detected**:
   - Ensure your browser has permission to access the microphone, and refresh the device list if necessary.

3. **Audio Source Changes Not Applying**:
   - If changing the audio input source doesn't take effect, ensure you click "Apply" after selecting the device.
