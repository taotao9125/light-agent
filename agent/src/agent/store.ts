
import path from 'node:path';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { AgentEvent } from '../protocol/events';



export interface SessionStoreInterface {
  load: (sessionId: string) => Promise<AgentEvent[]>;
  append: (sessionId: string, event: AgentEvent) => Promise<void>;
}

export type Config = {
  rootDir: string;
}


export default class SessionStore implements SessionStoreInterface {
  private rootDir: string;
  constructor(config: Config) {
    this.rootDir = config.rootDir;
  }

  private getFilePath(sessionId: string) {
    return path.join(this.rootDir, `${sessionId}.jsonl`);
  }

  async load(sessionId: string): Promise<AgentEvent[]> {
    try {
      const content = await readFile(this.getFilePath(sessionId), 'utf-8');
      return content
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as AgentEvent)
    } catch (e) {
      throw e;
    }
  }

  // to do 队列 append
  async append(sessionId: string, event: AgentEvent): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await appendFile(
      this.getFilePath(sessionId),
      `${JSON.stringify(event)}\n`,
      'utf-8'
    )
  }
}