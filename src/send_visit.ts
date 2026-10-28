import { readFile } from "node:fs/promises";

const [workOrderId, audioPath, photoUrl] = process.argv.slice(2);
if (!workOrderId || !audioPath) throw new Error("Usage: npm run example -- WO-42 recording.wav [photo-url]");
const audioFormat = audioPath.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
const response = await fetch(`http://localhost:${process.env.PORT ?? 3000}/visits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ workOrderId, audioFormat, audioBase64: (await readFile(audioPath)).toString("base64"),
    photos: photoUrl ? [{ url: photoUrl }] : [] })
});
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
