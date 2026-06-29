import os from "node:os";
import path from "node:path";

export interface OkfyHomeOptions {
  okfyHome?: string;
  env?: {
    OKFY_HOME?: string;
  };
}

export function resolveOkfyHome(options: OkfyHomeOptions = {}): string {
  const configured = options.okfyHome ?? options.env?.OKFY_HOME ?? process.env.OKFY_HOME;
  if (configured && configured.trim() !== "") return path.resolve(configured);
  return path.join(os.homedir(), ".okfy");
}
