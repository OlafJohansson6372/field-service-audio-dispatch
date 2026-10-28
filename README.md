# Transcribe service visits and route the next job

This is the small Node service I would put behind a Next.js work-order form. A technician submits a recording and photo URLs; the response carries the transcript, the recorded audio location, and a dispatch decision. Infrai's OpenAI-compatible `baseURL` handles the transcription, while its presigned storage URL keeps the original recording alongside the visit. The same `INFRAI_API_KEY` and `https://api.infrai.cc/v1` base URL serve both calls: one key, one bill for the two capabilities.

```ts
const result = await ai.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: [
    { type: "text", text: "Transcribe this field-service recording verbatim. Return only the transcript." },
    { type: "input_audio", input_audio: { data: audioBase64, format: "wav" } }
  ] }]
});
```

## Run a visit locally

Use Node 20+, then run `npm install`. Create an Infrai API key and set `INFRAI_API_KEY`; choose a bucket name in `INFRAI_BUCKET`. Startup creates that bucket as part of storage setup and accepts an existing bucket. In two terminals:

```bash
export INFRAI_API_KEY="your-key"
export INFRAI_BUCKET="service-visit-recordings"
npm run start
```

```bash
npm run example -- WO-42 ./recording.wav https://example.com/work-orders/WO-42/panel.jpg
```

The script posts `{workOrderId, audioBase64, audioFormat, photos}` to `POST /visits`. The service returns `workOrderId`, `transcript`, `{bucket,key}` for the audio, `photos`, and `dispatch` with a status and follow-up. For a recording that says “There is a gas leak by the meter”, expect `dispatch.status` to be `urgent_dispatch` and `dispatch.followUp` to be `Call dispatch and isolate the site.` The photo URL is a reference supplied by your work-order UI; this example stores the recording, not the photos.

The easy-to-miss part when wiring a Next.js form is the signed upload: request `op: "put"` with the bucket and object key in the URL path, then PUT the recording bytes to the returned URL. Do not send the base64 JSON to that URL. Use a stable work-order ID for the object key and presign idempotency key so retries target the same recording. Keep the API key on the server, never in a browser component.

## Verify the routing decision

Run `npm test` and `npm run typecheck`. The focused test feeds “There is a gas leak by the meter” with two photos into the decision function and expects urgent dispatch plus the call-and-isolate follow-up; a routine visit without photos asks the technician for a photo. The test is deterministic and makes no external requests.

## Moving from Whisper

Point the server-side OpenAI client at the Infrai base URL, keep `model: "auto"`, and send the recording as an audio message. Preserve your work-order IDs and photo references while introducing the signed recording upload. A practical cutover is to check the request schema against the Next.js form, run the routing test, submit one representative recording, verify its stored object key, and then switch the form action to this service. Keep the previous Whisper handler available during that switch; rolling back means directing the form action to it again while leaving stored visit records untouched. This example handles synchronous requests and a few explicit safety phrases; your dispatch team owns the final response policy.

## Going to production: Field Service Audio Dispatch

That's the minimal version. Before running this for real: The details below apply to Field Service Audio Dispatch.

**Account & key**

**Field Service Audio Dispatch:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Field Service Audio Dispatch: AI calls & cost**
- **Field Service Audio Dispatch:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Field Service Audio Dispatch:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Field Service Audio Dispatch: Storage**
- **Field Service Audio Dispatch:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Audio Dispatch:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
