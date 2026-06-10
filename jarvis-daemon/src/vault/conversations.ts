import { getDb, generateId, now } from "./schema.ts";

export type Role = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  agent_id?: string | null;
  tokens_used: number;
  cost_usd: number;
  created_at: number;
}

export interface Conversation {
  id: string;
  title: string | null;
  mode: "basic" | "enterprise";
  agent_id: string | null;
  created_at: number;
  updated_at: number;
}

export function createConversation(mode: "basic" | "enterprise" = "basic"): Conversation {
  const db = getDb();
  const conv: Conversation = {
    id: generateId(), title: null, mode, agent_id: null,
    created_at: now(), updated_at: now(),
  };
  db.run(
    `INSERT INTO conversations(id,title,mode,agent_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
    [conv.id, conv.title, conv.mode, conv.agent_id, conv.created_at, conv.updated_at]
  );
  return conv;
}

export function getConversation(id: string): Conversation | null {
  return getDb().query<Conversation, [string]>(
    `SELECT * FROM conversations WHERE id = ?`
  ).get(id) ?? null;
}

export function addMessage(msg: Omit<Message, "id" | "created_at">): Message {
  const db = getDb();
  const full: Message = { ...msg, id: generateId(), created_at: now() };
  db.run(
    `INSERT INTO messages(id,conversation_id,role,content,agent_id,tokens_used,cost_usd,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [full.id, full.conversation_id, full.role, full.content,
     full.agent_id ?? null, full.tokens_used, full.cost_usd, full.created_at]
  );
  db.run(`UPDATE conversations SET updated_at=? WHERE id=?`, [now(), msg.conversation_id]);
  return full;
}

export function getMessages(conversationId: string, limit = 50): Message[] {
  return getDb().query<Message, [string, number]>(
    `SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT ?`
  ).all(conversationId, limit);
}

export function getRecentConversations(limit = 20): Conversation[] {
  return getDb().query<Conversation, [number]>(
    `SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?`
  ).all(limit);
}
