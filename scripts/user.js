#!/usr/bin/env node
/**
 *   npm run user:add -- anna            asks for a password
 *   npm run user:add -- anna "Anna K"   with a display name
 *   npm run user:remove -- anna
 *   npm run user:list
 */
import { createInterface } from "node:readline";
import { addUser, loadUsers, removeUser } from "../lib/users.js";

const [cmd, username, name] = process.argv.slice(2);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute echo so the password is not shown while typing.
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

try {
  if (cmd === "add") {
    if (!username) throw new Error("Usage: npm run user:add -- <username> [\"Display name\"]");
    const password = process.env.DASHBOARD_PASSWORD || (await askHidden("Password: "));
    if (!process.env.DASHBOARD_PASSWORD) {
      const again = await askHidden("Repeat password: ");
      if (again !== password) throw new Error("The passwords did not match.");
    }
    await addUser(username, password, name);
    console.log(`Saved user "${username.toLowerCase()}".`);
  } else if (cmd === "remove") {
    if (!username) throw new Error("Usage: npm run user:remove -- <username>");
    console.log(removeUser(username) ? `Removed "${username}".` : `No user "${username}".`);
  } else if (cmd === "list") {
    const users = loadUsers();
    if (!users.length) console.log("No users yet. Add one with: npm run user:add -- <username>");
    for (const u of users) console.log(`${u.username.padEnd(24)} ${u.name}  (added ${u.createdAt.slice(0, 10)})`);
  } else {
    throw new Error("Commands: add, remove, list");
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
