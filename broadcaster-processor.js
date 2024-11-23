class BroadcasterProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input && output) {
      for (let channel = 0; channel < input.length; ++channel) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];
        for (let i = 0; i < inputChannel.length; ++i) {
          outputChannel[i] = inputChannel[i];
        }
      }
    }
    return true; // Keep the processor alive
  }
}

registerProcessor('broadcaster-processor', BroadcasterProcessor);
