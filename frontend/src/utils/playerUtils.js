import { players, playerKnowledgeBase } from "../data/mockData.js";

export function playerNames(event) {
  return event.playerIds.map((id) => players.find((player) => player.id === id)?.name).filter(Boolean).join(", ");
}

export function findPlayerKnowledge(prompt) {
  const normalized = prompt.toLowerCase().replace(/\s/g, "");
  return Object.values(playerKnowledgeBase).find((profile) =>
    profile.aliases.some((alias) => normalized.includes(alias.toLowerCase().replace(/\s/g, ""))),
  );
}
