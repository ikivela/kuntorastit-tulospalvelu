/** Whether a results page should keep refreshing: only while the event is on
 * (an hour before its start until six hours after its end, as the last cards
 * are often read after the official end) and not yet marked finished. */
export function isLiveEvent(event: { startsAt: string; endsAt?: string; status?: string }, now = Date.now()) {
  if (event.status === "FINISHED") return false;
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt ?? event.startsAt).getTime();
  return now >= startsAt - 60 * 60 * 1000 && now <= endsAt + 6 * 60 * 60 * 1000;
}
