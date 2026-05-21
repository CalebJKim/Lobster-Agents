import type { ChatMessage } from "../types";

const LAND_OFFICE_IDLE_TERMS = [
  "coffee",
  "espresso",
  "oat milk",
  "fridge",
  "lunch",
  "keyboard",
  "keyboards",
  "mechanical",
  "switches",
  "typing",
  "cat",
  "dog",
  "pet",
  "pets",
  "monitor",
  "hard drive",
  "desk",
  "office",
  "thermostat",
  "video call",
  "zoom",
  "standup",
  "meeting",
  "slack",
  "email",
  "work from home",
  "wfh",
];

export function isLandOfficeIdleMessage(msg: Pick<ChatMessage, "agent" | "target" | "message" | "type">): boolean {
  if (msg.agent === "You" || msg.agent === "User") return false;
  if (msg.type !== "speak" && msg.type !== "announce") return false;
  if (msg.target === "all" || msg.target === "self" || msg.target === "user") return false;
  if (msg.message.startsWith("Searching: ") || msg.message.startsWith("Searched: ")) return false;

  const text = msg.message.toLowerCase();
  return LAND_OFFICE_IDLE_TERMS.some((term) => text.includes(term));
}

export function withoutLandOfficeIdleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((msg) => !isLandOfficeIdleMessage(msg));
}
