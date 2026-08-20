const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const MEDIA_DIR = path.join(__dirname, "../../data/media");

async function playMusic(query) {
  if (!query || !query.trim()) {
    throw new Error("Tell me what song to play.");
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const id = `music-${Date.now()}`;
  const output = path.join(MEDIA_DIR, `${id}.mp3`);

  await execFileAsync(
    "yt-dlp",
    [
      "--extractor-args",
      "youtube:player_client=default,-android_sdkless",
      "--no-playlist",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "128K",
      "--no-warnings",
      "--quiet",
      "--output",
      output,
      `ytsearch1:${query.trim()}`
    ],
    {
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (!fs.existsSync(output)) {
    throw new Error("The song could not be downloaded.");
  }

  return {
    path: output,
    filename: path.basename(output)
  };
}

module.exports = { playMusic };
