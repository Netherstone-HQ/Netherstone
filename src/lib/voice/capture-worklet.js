// Runs on the audio thread: mixes the microphone down to one channel, passes
// it on, and posts it in blocks with the block's loudest sample for the
// level meter.

class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.blockFrames = options.processorOptions.blockFrames;
    this.block = new Float32Array(this.blockFrames);
    this.filled = 0;
    this.peak = 0;
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const out = outputs[0]?.[0];
    const frames = channels[0].length;
    for (let i = 0; i < frames; i += 1) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      const sample = sum / channels.length;
      if (out) out[i] = sample;
      this.block[this.filled] = sample;
      this.filled += 1;
      const loudness = Math.abs(sample);
      if (loudness > this.peak) this.peak = loudness;
      if (this.filled === this.blockFrames) {
        this.port.postMessage({ samples: this.block, peak: this.peak }, [
          this.block.buffer,
        ]);
        this.block = new Float32Array(this.blockFrames);
        this.filled = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCapture);
