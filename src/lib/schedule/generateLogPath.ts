import fs from "fs";
import path from "path";

const CANDIDATES = [
  () => path.join(process.cwd(), "generate-logs"),
  () => {
    const isWin = process.platform === "win32";
    return isWin
      ? path.join(process.env.TEMP ?? "C:\\Temp", "schichtmeister-logs")
      : "/tmp/schichtmeister-logs";
  },
];

function logFileName(month: string): string {
  return `generate-${month}.log`;
}

export function writeGenerateLog(month: string, content: string): void {
  for (const dirFn of CANDIDATES) {
    try {
      const dir = dirFn();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, logFileName(month)), content, "utf-8");
      return;
    } catch {
      /* try next candidate */
    }
  }
}

export function readGenerateLog(month: string): string | null {
  for (const dirFn of CANDIDATES) {
    try {
      const filePath = path.join(dirFn(), logFileName(month));
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export function deleteGenerateLog(month: string): void {
  for (const dirFn of CANDIDATES) {
    try {
      const filePath = path.join(dirFn(), logFileName(month));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* ignore */
    }
  }
}
