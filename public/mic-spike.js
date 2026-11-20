// Throwaway spike. Records from the microphone, plays clips back, and
// saves the clips and a JSON report through the spike_save command.
(async () => {
  const report = { ua: navigator.userAgent, started: new Date().toISOString(), steps: {} };
  const logEl = document.getElementById("log");
  const log = (...a) => { logEl.textContent += a.join(" ") + "\n"; };
  const params = new URLSearchParams(location.search);
  const seconds = Number(params.get("seconds") || 60);
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  const save = async (name, data, last = false) => {
    const bytes = Array.from(new Uint8Array(data));
    if (invoke) return invoke("spike_save", { name, bytes, last });
  };
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms))]);
  const step = async (name, fn) => {
    const t0 = performance.now();
    try { const r = await fn(); report.steps[name] = { ok: true, ms: Math.round(performance.now() - t0), ...r }; }
    catch (e) { report.steps[name] = { ok: false, ms: Math.round(performance.now() - t0), error: `${e && e.name}: ${e && e.message}` }; }
    log(name, JSON.stringify(report.steps[name]));
  };

  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/mp4;codecs=opus", "audio/aac"];
  await step("isTypeSupported", async () => ({ types: Object.fromEntries(types.map((t) => [t, typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)])) }));
  const playTypes = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mpeg", "audio/wav"];
  await step("canPlayType", async () => ({ types: Object.fromEntries(playTypes.map((t) => [t, document.createElement("audio").canPlayType(t)])) }));

  let stream;
  await step("getUserMedia", async () => {
    stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } }), 30000, "getUserMedia");
    const track = stream.getAudioTracks()[0];
    return { label: track.label, settings: track.getSettings() };
  });
  await step("enumerateDevices", async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    return { inputs: all.filter((d) => d.kind === "audioinput").map((d) => ({ id: d.deviceId.slice(0, 8), label: d.label })) };
  });

  const record = async (mimeType, secs) => {
    const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(1000);
    await new Promise((res) => setTimeout(res, secs * 1000));
    rec.stop();
    await withTimeout(stopped, 10000, "stop");
    const blob = new Blob(chunks, { type: rec.mimeType || mimeType });
    return { blob, chunks: chunks.length, mime: rec.mimeType, bytes: blob.size, bytesPerMinute: Math.round(blob.size / secs * 60) };
  };

  const ext = (mime) => (mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : "m4a");
  const os = /Windows/.test(navigator.userAgent) ? "windows" : /Mac/.test(navigator.userAgent) ? "mac" : "linux";
  const clips = [];
  if (stream) {
    for (const [mime, secs] of [["audio/webm;codecs=opus", seconds], ["audio/mp4", Math.min(seconds, 15)]]) {
      if (!MediaRecorder.isTypeSupported(mime)) { report.steps["record " + mime] = { ok: false, error: "not supported" }; continue; }
      let result;
      await step("record " + mime, async () => { result = await record(mime, secs); const { blob, ...rest } = result; return rest; });
      if (result && result.blob.size) {
        const name = `${os}-${secs}s.${ext(result.mime || mime)}`;
        clips.push({ name, blob: result.blob });
        await save(name, await result.blob.arrayBuffer());
      }
    }
    stream.getTracks().forEach((t) => t.stop());
  }

  const playCheck = async (label, getBuffer, url) => {
    await step("play " + label, async () => {
      const out = {};
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await withTimeout(ctx.decodeAudioData(await getBuffer()), 15000, "decode");
        out.decodedSeconds = Math.round(decoded.duration * 10) / 10;
        ctx.close();
      } catch (e) { out.decodeError = `${e && e.name}: ${e && e.message}`; }
      const audio = new Audio();
      audio.preload = "metadata";
      audio.muted = true;
      audio.src = url;
      out.element = await withTimeout(new Promise((res) => {
        audio.onerror = () => res({ error: audio.error && audio.error.code, message: audio.error && audio.error.message });
        audio.onloadedmetadata = async () => {
          const meta = audio.duration;
          try { await audio.play(); } catch (e) { return res({ metaDuration: meta, playError: e.name }); }
          audio.ontimeupdate = () => { if (audio.currentTime > 1) { audio.pause(); res({ metaDuration: String(meta), advanced: audio.currentTime }); } };
        };
      }), 15000, "element").catch((e) => ({ error: e.message }));
      if (out.element.error || out.decodeError) throw Object.assign(new Error(JSON.stringify(out)), { name: "PlayFailed" });
      return out;
    });
  };
  for (const clip of clips) {
    await playCheck("own " + clip.name, () => clip.blob.arrayBuffer(), URL.createObjectURL(clip.blob));
  }
  let fixtures = [];
  try { fixtures = await (await fetch("/spike-fixtures/index.json")).json(); } catch {}
  for (const f of fixtures) {
    await playCheck("fixture " + f, async () => (await fetch("/spike-fixtures/" + f)).arrayBuffer(), "/spike-fixtures/" + f);
  }

  report.finished = new Date().toISOString();
  window.__spikeReport = JSON.stringify(report);
  log("DONE");
  await save(`${os}-report.json`, new TextEncoder().encode(JSON.stringify(report, null, 2)), true);
})();
