import { lstat, readFile, readdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const PREFIX = "/eval-textures/";
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function isImageName(name: string): boolean {
  return (
    name === basename(name) &&
    !name.includes("..") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    Object.hasOwn(CONTENT_TYPES, extname(name).toLowerCase())
  );
}

export function createEvalTexturesMiddleware(directory: string) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    // Do not normalize the URL: that would hide traversal attempts.
    const path = (req.url ?? "").split("?")[0];
    if (!path.startsWith(PREFIX)) {
      next();
      return;
    }
    const notFound = () => {
      res.statusCode = 404;
      res.end("Not found");
    };
    if (req.method !== "GET") {
      notFound();
      return;
    }
    let name: string;
    try {
      name = decodeURIComponent(path.slice(PREFIX.length));
    } catch {
      notFound();
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      if (name === "") {
        const entries = await readdir(directory, { withFileTypes: true }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        );
        const names = entries
          .filter((entry) => entry.isFile() && isImageName(entry.name))
          .map((entry) => entry.name)
          .sort();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(names));
        return;
      }
      if (!isImageName(name)) {
        notFound();
        return;
      }
      const file = join(directory, name);
      // Symlinks are not evaluation files and must not expose outside files.
      if (!(await lstat(file)).isFile()) {
        notFound();
        return;
      }
      const data = await readFile(file);
      res.setHeader("Content-Type", CONTENT_TYPES[extname(name).toLowerCase()]);
      res.end(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        notFound();
      } else {
        next(error);
      }
    }
  };
}

export function evalTexturesPlugin(): Plugin {
  return {
    name: "eval-textures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        createEvalTexturesMiddleware(
          fileURLToPath(
            new URL("../../work.local/paper-textures/height/", import.meta.url),
          ),
        ),
      );
    },
  };
}
