const mineflayer = require("mineflayer");
const express = require("express");

const host = process.env.MC_HOST ?? "survivalpvebongabeo.aternos.me";
const port = Number.parseInt(process.env.MC_PORT ?? "62503", 10);
const username = process.env.MC_USERNAME ?? "Bop";
const auth = process.env.MC_AUTH ?? "offline";
const version = process.env.MC_VERSION?.trim() || false;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("MC_PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

if (auth !== "offline" && auth !== "microsoft") {
  console.error('MC_AUTH must be either "offline" or "microsoft".');
  process.exit(1);
}

let bot;
let antiAfkTimer;
let reconnectTimer;
let isClosing = false;

const keepAliveApp = express();
keepAliveApp.get("/", (_request, response) => {
  response.status(200).send("Mineflayer bot is running");
});
keepAliveApp.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    minecraftConnected: Boolean(bot?.entity),
    username,
  });
});

const keepAlivePort = Number.parseInt(process.env.KEEP_ALIVE_PORT ?? "8099", 10);
const keepAliveServer = keepAliveApp.listen(keepAlivePort, "0.0.0.0", () => {
  console.info(`Express keep-alive server listening on port ${keepAlivePort}.`);
});

keepAliveServer.on("error", (error) => {
  console.error("Express keep-alive server error:", error.message);
  process.exit(1);
});

function connect() {
  if (isClosing) return;

  console.info(`Connecting to ${host}:${port} as ${username}.`);
  bot = mineflayer.createBot({
    host,
    port,
    username,
    auth,
    ...(version ? { version } : {}),
  });

  bot.once("login", () => {
    console.info(`Connected to ${host}:${port} as ${bot.username}.`);
  });

  bot.once("spawn", () => {
    console.info("Bot spawned in the world. Anti-AFK jump is enabled every 30 seconds.");
    antiAfkTimer = setInterval(() => {
      if (!bot?.entity) return;

      bot.setControlState("jump", true);
      setTimeout(() => bot?.setControlState("jump", false), 250);
    }, 30_000);
  });

  bot.on("chat", (sender, message) => {
    if (sender === bot.username || !message.startsWith("!")) return;

    const [command] = message.trim().split(/\s+/, 1);

    if (command.toLowerCase() === "!ping") {
      bot.chat("Pong!");
    }
  });

  bot.on("kicked", (reason) => {
    console.warn("Bot was kicked:", reason);
  });

  bot.on("error", (error) => {
    console.error("Mineflayer error:", error.message);
  });

  bot.once("end", () => {
    if (antiAfkTimer) clearInterval(antiAfkTimer);
    antiAfkTimer = undefined;

    if (isClosing) return;
    console.info("Disconnected. Retrying in 30 seconds.");
    reconnectTimer = setTimeout(connect, 30_000);
  });
}

function shutDown(signal) {
  if (isClosing) return;
  isClosing = true;
  if (antiAfkTimer) clearInterval(antiAfkTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);

  console.info(`Received ${signal}; disconnecting bot.`);
  bot?.quit("Bot shutting down");

  const timeout = setTimeout(() => process.exit(0), 2_000);
  keepAliveServer.close(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));

connect();
