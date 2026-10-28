export type Dispatch = {
  status: "urgent_dispatch" | "technician_follow_up";
  followUp: string;
};

export function decideDispatch(transcript: string, photoCount: number): Dispatch {
  const urgent = /\b(gas leak|sparks|smoke|flooding|exposed wire)\b/i.test(transcript);
  if (urgent) return { status: "urgent_dispatch", followUp: "Call dispatch and isolate the site." };
  if (photoCount === 0) return { status: "technician_follow_up", followUp: "Ask the technician for a work-order photo." };
  return { status: "technician_follow_up", followUp: "Review the photos and schedule the next visit." };
}
