/**
 * Free neural text-to-speech via Microsoft Edge's online voices.
 * No API key, no cost. Gives JARVIS a human British-male voice ("Ryan")
 * instead of the robotic built-in Windows voices (David/Zira).
 */

// msedge-tts ships its own types, but the stream shape varies by version — cast as needed.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const DEFAULT_VOICE = "en-GB-RyanNeural"; // calm British male — the JARVIS feel

export async function synthesizeSpeech(text: string, voice: string = DEFAULT_VOICE): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const res = tts.toStream(text) as { audioStream?: NodeJS.ReadableStream } | NodeJS.ReadableStream;
  const stream = ((res as { audioStream?: NodeJS.ReadableStream }).audioStream ?? res) as NodeJS.ReadableStream;

  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    const done = () => resolve(Buffer.concat(chunks));
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", done);
    stream.on("error", (e: Error) => (chunks.length ? done() : reject(e)));
    // Safety: never hang the request more than 15s
    setTimeout(done, 15000);
  });
}
