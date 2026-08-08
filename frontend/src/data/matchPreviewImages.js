import matchKoreaCzechUrl from "../assets/match-korea-czech.png";
import matchKoreaHuddleUrl from "../assets/match-korea-huddle.png";

export const matchPreviewImages = [matchKoreaCzechUrl, matchKoreaHuddleUrl];

export function matchPreviewImageFor(matchId, fallbackIndex = 0) {
  if (matchId === "kor-jpn-2026") return matchKoreaCzechUrl;
  if (matchId === "tot-ars-2026") return matchKoreaHuddleUrl;
  return matchPreviewImages[fallbackIndex % matchPreviewImages.length];
}
