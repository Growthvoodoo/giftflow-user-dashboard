/**
 * Staff accounts, kept in data/users.json with bcrypt-hashed passwords.
 *
 * A file rather than a database: a print station has a handful of users, and
 * this keeps the dashboard to one process with nothing else to run.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "users.json");

export function loadUsers() {
  if (!existsSync(FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    console.error(`[dashboard] ${FILE} is not valid JSON`);
    return [];
  }
}

function saveUsers(users) {
  mkdirSync(dirname(FILE), { recursive: true });
  // Write-then-rename, so a crash mid-write never leaves a half file.
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

const normalise = (u) => String(u || "").trim().toLowerCase();

export async function addUser(username, password, name) {
  const id = normalise(username);
  if (!/^[a-z0-9._@-]{2,64}$/.test(id)) throw new Error("Username: 2–64 letters, digits, . _ @ -");
  if (String(password).length < 8) throw new Error("Password must be at least 8 characters.");
  const users = loadUsers().filter((u) => u.username !== id);
  users.push({
    username: id,
    name: name || username,
    hash: await bcrypt.hash(String(password), 12),
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);
}

export function removeUser(username) {
  const id = normalise(username);
  const users = loadUsers();
  const left = users.filter((u) => u.username !== id);
  saveUsers(left);
  return users.length !== left.length;
}

// Compared even for an unknown user, so response time does not reveal which
// usernames exist.
const DUMMY = bcrypt.hashSync("not-a-real-password", 12);

export async function verify(username, password) {
  const user = loadUsers().find((u) => u.username === normalise(username));
  const ok = await bcrypt.compare(String(password || ""), user ? user.hash : DUMMY);
  return ok && user ? { username: user.username, name: user.name } : null;
}
