import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEvalTexturesMiddleware,
  evalTexturesPlugin,
} from "./vite-eval-textures";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "eval-textures-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function request(url: string, root = directory, method = "GET") {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => headers.set(name, value),
    end: vi.fn(),
  };
  const next = vi.fn();
  await createEvalTexturesMiddleware(root)(
    { url, method } as IncomingMessage,
    response as unknown as ServerResponse,
    next,
  );
  return { response, headers, next, body: response.end.mock.calls[0]?.[0] };
}

describe("evaluation texture middleware", () => {
  it("lists only supported image files, sorted by name", async () => {
    await Promise.all(
      [
        "b.jpg",
        "a.png",
        "c.jpeg",
        "d.webp",
        "e.PNG",
        "manifest.md",
        "f.gif",
        "bad..png",
      ].map((name) => writeFile(join(directory, name), "texture")),
    );
    await mkdir(join(directory, "folder.png"));
    const { body, headers } = await request("/eval-textures/");
    expect(JSON.parse(body)).toEqual([
      "a.png",
      "b.jpg",
      "c.jpeg",
      "d.webp",
      "e.PNG",
    ]);
    expect(headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it.each([
    "../secret.png",
    "%2e%2e%2fsecret.png",
    "paper..png",
    "sub/paper.png",
    "sub%2Fpaper.png",
    "sub%5Cpaper.png",
    "%00.png",
    "%ZZ.png",
  ])("returns 404 for unsafe name %s", async (name) => {
    const { response, next } = await request(`/eval-textures/${name}`);
    expect(response.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns an empty array when the directory is absent", async () => {
    const { response, body } = await request(
      "/eval-textures/",
      join(directory, "missing"),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(body)).toEqual([]);
  });

  it.each([
    ["paper.png", "image/png"],
    ["paper.jpg", "image/jpeg"],
    ["paper.jpeg", "image/jpeg"],
    ["紙 目.WEBP", "image/webp"],
  ])("serves %s with its content type", async (name, contentType) => {
    const bytes = Buffer.from([0, 1, 127, 255]);
    await writeFile(join(directory, name), bytes);
    const { body, headers, response } = await request(
      `/eval-textures/${encodeURIComponent(name)}?v=1`,
    );
    expect(response.statusCode).toBe(200);
    expect(headers.get("Content-Type")).toBe(contentType);
    expect(body).toEqual(bytes);
  });

  it("rejects missing files, non-images, directories and symlinks", async () => {
    await writeFile(join(directory, "manifest.md"), "private");
    await mkdir(join(directory, "folder.png"));
    await symlink(join(directory, "manifest.md"), join(directory, "link.png"));
    for (const name of [
      "missing.png",
      "manifest.md",
      "folder.png",
      "link.png",
    ]) {
      expect(
        (await request(`/eval-textures/${name}`)).response.statusCode,
      ).toBe(404);
    }
    expect(JSON.parse((await request("/eval-textures/")).body)).toEqual([]);
  });

  it("passes unrelated routes through and rejects non-GET requests", async () => {
    expect((await request("/app")).next).toHaveBeenCalledOnce();
    expect(
      (await request("/eval-textures/", directory, "POST")).response.statusCode,
    ).toBe(404);
  });

  it("registers only for the development server", () => {
    const plugin = evalTexturesPlugin();
    expect(plugin.apply).toBe("serve");
    expect(plugin.configureServer).toBeTypeOf("function");
    expect(plugin).not.toHaveProperty("configurePreviewServer");
    expect(plugin).not.toHaveProperty("generateBundle");
  });
});
